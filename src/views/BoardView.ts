import { ItemView, type WorkspaceLeaf } from 'obsidian'
import type Questline from '../main'
import { BOARD_STATUS_LABELS, type BoardStatus, type Quest } from '../quests/Quest'
import type { GroupBy } from '../settings'
import { renderAreaStrip, renderQuestRow, renderReadyStrip, type RenderContext } from './render'

export const VIEW_TYPE_BOARD = 'questline-board'

type StatusFilter = BoardStatus | 'all' | 'ready'

/** Blocked sits directly after Active: both answer "can I pick this up?" */
const BOARD_ORDER: BoardStatus[] = ['active', 'blocked', 'held', 'available', 'complete']

interface Group {
    label: string
    quests: Quest[]
}

export class BoardView extends ItemView {
    private plugin: Questline
    private unsubscribe: (() => void) | null = null

    private query = ''
    private statusFilter: StatusFilter = 'all'
    private group: GroupBy
    /** Which quests show their objectives. Survives re-renders, not reloads. */
    private expanded = new Set<string>()

    constructor(leaf: WorkspaceLeaf, plugin: Questline) {
        super(leaf)
        this.plugin = plugin
        this.group = plugin.settings.defaultGroup
    }

    getViewType(): string { return VIEW_TYPE_BOARD }
    getDisplayText(): string { return 'Quest Board' }
    getIcon(): string { return 'flag' }

    async onOpen(): Promise<void> {
        this.unsubscribe = this.plugin.index.subscribe(() => this.render())
        this.render()
    }

    async onClose(): Promise<void> {
        this.unsubscribe?.()
        this.unsubscribe = null
    }

    private get ctx(): RenderContext {
        return {
            plugin: this.plugin,
            app: this.app,
            sourcePath: '',
            expanded: this.expanded,
            refresh: () => this.render(),
        }
    }

    /* ------------------------------------------------------------ filtering */

    private matches(quest: Quest): boolean {
        const { settings, index } = this.plugin

        // Blocked outranks the frontmatter status everywhere on the board, so a
        // blocked quest is reachable through the Blocked pill and nowhere else.
        const effective = index.effectiveStatus(quest)

        if (this.statusFilter === 'ready') {
            if (!index.isReady(quest)) return false
        } else if (this.statusFilter !== 'all' && effective !== this.statusFilter) {
            return false
        }

        if (!settings.showComplete && effective === 'complete' && this.statusFilter !== 'complete') return false
        // Asking for Blocked outranks the setting that hides them, the same way
        // asking for Complete outranks the setting that hides those.
        if (settings.hideBlocked && effective === 'blocked' && this.statusFilter !== 'blocked') return false

        if (!this.query) return true
        const haystack = [
            quest.title,
            quest.areas.join(' '),
            quest.projects.join(' '),
            quest.objectives.map(objective => objective.text).join(' '),
        ].join(' ').toLowerCase()
        return haystack.includes(this.query.toLowerCase())
    }

    private groupQuests(quests: Quest[]): Group[] {
        const { index } = this.plugin
        if (this.group === 'none') return [{ label: 'All quests', quests }]

        if (this.group === 'status') {
            return BOARD_ORDER
                .map(status => ({
                    label: BOARD_STATUS_LABELS[status],
                    quests: quests.filter(quest => index.effectiveStatus(quest) === status),
                }))
                .filter(group => group.quests.length > 0)
        }

        if (this.group === 'project') {
            const labels = new Set<string>()
            for (const quest of quests) labels.add(quest.projects[0] ?? 'No linked project')
            return Array.from(labels).sort((a, b) => a.localeCompare(b)).map(label => ({
                label,
                quests: quests.filter(quest => (quest.projects[0] ?? 'No linked project') === label),
            }))
        }

        // Grouped by resolved priority, so a quest sits under the priority it
        // actually has — inherited from its project unless it overrides one.
        const buckets = new Map<number, Quest[]>()
        const unranked: Quest[] = []
        for (const quest of quests) {
            const { value } = index.priorityOf(quest)
            if (value === null) unranked.push(quest)
            else {
                const bucket = buckets.get(value)
                if (bucket) bucket.push(quest)
                else buckets.set(value, [quest])
            }
        }

        const groups: Group[] = Array.from(buckets.keys())
            .sort((a, b) => a - b)
            .map(value => ({ label: `Priority ${value}`, quests: buckets.get(value) as Quest[] }))
        if (unranked.length > 0) groups.push({ label: 'No priority', quests: unranked })
        return groups
    }

    /* -------------------------------------------------------------- render */

    private render(): void {
        const root = this.containerEl.children[1] as HTMLElement
        root.empty()
        root.addClass('questline-board')

        const inner = root.createDiv('ql-inner')
        const all = this.plugin.index.all()

        if (all.length === 0) {
            this.renderEmpty(inner)
            return
        }

        renderAreaStrip(inner, this.ctx)
        renderReadyStrip(inner, this.ctx)
        this.renderControls(inner, all)

        const visible = this.plugin.index.sorted(all.filter(quest => this.matches(quest)))
        if (visible.length === 0) {
            inner.createDiv({ cls: 'ql-empty', text: 'No quests match this filter.' })
            return
        }

        for (const group of this.groupQuests(visible)) {
            const section = inner.createDiv('ql-group')
            const head = section.createDiv('ql-group-head')
            head.createEl('h3', { text: group.label })
            head.createSpan({ cls: 'ql-group-n', text: String(group.quests.length) })

            const list = section.createDiv('ql-list')
            for (const quest of group.quests) {
                renderQuestRow(list, quest, this.ctx, { objectives: true })
            }
        }
    }

    private renderEmpty(parent: HTMLElement): void {
        const box = parent.createDiv('ql-empty ql-empty-first')
        box.createEl('h3', { text: 'No quests yet' })
        box.createEl('p', {
            text: `Questline reads notes in ${this.plugin.settings.questFolder}/. A quest links to the projects it serves and lists its objectives as ordinary tasks.`,
        })
        const button = box.createEl('button', { text: 'Create the first quest', cls: 'mod-cta' })
        button.addEventListener('click', () => void this.plugin.createQuest())
    }

    private renderControls(parent: HTMLElement, all: Quest[]): void {
        const controls = parent.createDiv('ql-controls')

        const search = controls.createEl('input', {
            type: 'search',
            cls: 'ql-search',
            attr: { placeholder: 'Search quests, projects, objectives' },
        })
        search.value = this.query
        search.addEventListener('input', () => {
            this.query = search.value.trim()
            this.render()
        })

        const select = controls.createEl('select', 'ql-select')
        for (const [value, label] of Object.entries({
            priority: 'Group by priority',
            status: 'Group by status',
            project: 'Group by project',
            none: 'No grouping',
        })) {
            select.createEl('option', { value, text: label })
        }
        select.value = this.group
        select.addEventListener('change', () => {
            this.group = select.value as GroupBy
            this.render()
        })

        const pills = parent.createDiv('ql-pills')
        const tally: Record<string, number> = { all: all.length }
        for (const quest of all) {
            const effective = this.plugin.index.effectiveStatus(quest)
            tally[effective] = (tally[effective] ?? 0) + 1
        }
        tally.ready = this.plugin.index.readyQuests().length

        const options: { key: StatusFilter; label: string }[] = [
            { key: 'all', label: 'All' },
            ...BOARD_ORDER.map(status => ({ key: status as StatusFilter, label: BOARD_STATUS_LABELS[status] })),
        ]
        if (this.plugin.settings.onUnblock === 'flag') options.push({ key: 'ready', label: 'Ready' })

        for (const option of options) {
            const pill = pills.createEl('button', { cls: 'ql-pill', text: option.label })
            pill.createSpan({ cls: 'ql-pill-n', text: String(tally[option.key] ?? 0) })
            pill.toggleClass('is-on', this.statusFilter === option.key)
            pill.setAttribute('aria-pressed', String(this.statusFilter === option.key))
            pill.addEventListener('click', () => {
                this.statusFilter = option.key
                this.render()
            })
        }
    }
}
