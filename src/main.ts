import { Notice, Plugin, TFile, normalizePath } from 'obsidian'
import { QuestIndex } from './quests/QuestIndex'
import { BlockerModal, DueModal } from './views/modals'
import { QuestCreateModal } from './views/QuestCreateModal'
import {
    buildQuestNote,
    setQuestStatus,
    toggleObjective,
    type NewQuestFields,
} from './quests/QuestWriter'
import { progressOf, type Objective, type Quest } from './quests/Quest'
import { addDays } from './quests/periods'
import { DEFAULT_SETTINGS, QuestlineSettingTab, type QuestlineSettings } from './settings'
import { BoardView, VIEW_TYPE_BOARD } from './views/BoardView'
import { registerCodeblock } from './views/codeblock'

export default class Questline extends Plugin {
    settings!: QuestlineSettings
    index!: QuestIndex

    async onload(): Promise<void> {
        await this.loadSettings()

        this.index = new QuestIndex(this.app, this)
        this.addChild(this.index)

        this.registerView(VIEW_TYPE_BOARD, leaf => new BoardView(leaf, this))
        registerCodeblock(this)
        this.addSettingTab(new QuestlineSettingTab(this.app, this))

        this.addRibbonIcon('flag', 'Open quest board', () => void this.activateBoard())

        this.addCommand({
            id: 'open-board',
            name: 'Open quest board',
            callback: () => void this.activateBoard(),
        })
        this.addCommand({
            id: 'new-quest',
            name: 'New quest',
            callback: () => void this.createQuest(),
        })
        this.addCommand({
            id: 'set-quest-due',
            name: 'Set due date for this quest',
            checkCallback: (checking: boolean) => {
                const found = this.activeQuest()
                if (!found) return false
                if (!checking) new DueModal(this, found.quest, found.file).open()
                return true
            },
        })
        this.addCommand({
            id: 'set-quest-blockers',
            name: 'Set blockers for this quest',
            checkCallback: (checking: boolean) => {
                const found = this.activeQuest()
                if (!found) return false
                if (!checking) new BlockerModal(this, found.quest, found.file).open()
                return true
            },
        })
        this.addCommand({
            id: 'new-quest-for-note',
            name: 'New quest for the current project',
            checkCallback: (checking: boolean) => {
                const file = this.app.workspace.getActiveFile()
                const eligible = !!file && this.isProjectNote(file)
                if (eligible && !checking) void this.createQuest(file)
                return eligible
            },
        })
    }

    onunload(): void {
        // Leaves are left in place on purpose: Obsidian restores them on reload,
        // and detaching here would lose the user's layout on every update.
    }

    async loadSettings(): Promise<void> {
        const saved = (await this.loadData()) as Partial<QuestlineSettings> | null
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...saved,
            keys: { ...DEFAULT_SETTINGS.keys, ...saved?.keys },
        }
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings)
    }

    /* ----------------------------------------------------------------- dates */

    todayISO(): string {
        const now = new Date()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        return `${now.getFullYear()}-${month}-${day}`
    }

    /** Negative when the date has passed. Null when it does not parse. */
    daysUntil(iso: string): number | null {
        const then = Date.parse(iso + 'T00:00:00')
        const now = Date.parse(this.todayISO() + 'T00:00:00')
        if (Number.isNaN(then) || Number.isNaN(now)) return null
        return Math.round((then - now) / 86400000)
    }

    /* ------------------------------------------------------------------ view */

    async activateBoard(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)
        if (existing.length > 0) {
            await this.app.workspace.revealLeaf(existing[0])
            return
        }
        const leaf = this.app.workspace.getLeaf('tab')
        await leaf.setViewState({ type: VIEW_TYPE_BOARD, active: true })
        await this.app.workspace.revealLeaf(leaf)
    }

    /* --------------------------------------------------------------- actions */

    async toggleObjective(quest: Quest, objective: Objective): Promise<void> {
        const file = this.app.vault.getFileByPath(quest.path)
        if (!file) {
            new Notice(`${quest.title} is no longer in the vault.`)
            return
        }

        await toggleObjective(this.app.vault, file, objective.line, !objective.done)
        if (!this.settings.autoComplete) return

        // Work from the toggle we just made rather than the index, which has
        // not been re-parsed yet.
        const progress = progressOf(quest)
        const done = objective.done ? progress.done - 1 : progress.done

        if (done === progress.total && progress.total > 0 && quest.status === 'active') {
            await setQuestStatus(this.app.fileManager, file, 'complete', this.settings.keys, this.todayISO())
            new Notice(`${quest.title} complete — all ${progress.total} objectives sealed.`)
            await this.handleUnblocks(quest)
        } else if (done < progress.total && quest.status === 'complete') {
            await setQuestStatus(this.app.fileManager, file, 'active', this.settings.keys, this.todayISO())
            new Notice(`${quest.title} reopened.`)
        }
    }

    async startQuest(quest: Quest): Promise<void> {
        const file = this.app.vault.getFileByPath(quest.path)
        if (!file) return
        await setQuestStatus(this.app.fileManager, file, 'active', this.settings.keys, this.todayISO())
        new Notice(`${quest.title} accepted — now active.`)
    }

    /**
     * Called when a quest seals. Whether anything happens to the quests it was
     * blocking is the user's choice, so this only ever does what the setting says.
     */
    private async handleUnblocks(sealed: Quest): Promise<void> {
        if (this.settings.onUnblock === 'quiet') return

        const freed = this.index.blockedByThis(sealed).filter(quest => {
            const stillBlocked = quest.blockedBy.some(title => {
                if (title === sealed.title) return false
                const blocker = this.index.lookup(title)
                return !blocker || blocker.status !== 'complete'
            })
            return !stillBlocked
        })
        if (freed.length === 0) return

        const names = freed.map(quest => quest.title).join(', ')

        if (this.settings.onUnblock === 'activate') {
            for (const quest of freed) {
                if (quest.status !== 'held' && quest.status !== 'available') continue
                const file = this.app.vault.getFileByPath(quest.path)
                if (file) await setQuestStatus(this.app.fileManager, file, 'active', this.settings.keys, this.todayISO())
            }
            new Notice(`${names} unblocked and set to active.`)
            return
        }

        new Notice(`${names} ready to start — now at the top of the board.`)
    }

    /* -------------------------------------------------------------- creation */

    /** The quest note in the active tab, when there is one and it is indexed. */
    activeQuest(): { quest: Quest; file: TFile } | null {
        const file = this.app.workspace.getActiveFile()
        if (!file) return null
        const quest = this.index.get(file.path)
        return quest ? { quest, file } : null
    }

    private isProjectNote(file: TFile): boolean {
        const folder = normalizePath(this.settings.projectFolder)
        return !!folder && (file.path === folder || file.path.startsWith(folder + '/'))
    }

    /**
     * Creates the note and opens it. The note itself is the form — no modal
     * stands between a thought and a file.
     */
    async createQuest(project?: TFile): Promise<void> {
        const folder = normalizePath(this.settings.questFolder || 'Quests')
        if (!this.app.vault.getFolderByPath(folder)) {
            await this.app.vault.createFolder(folder)
        }

        const base = project ? `${project.basename} — ` : ''
        let title = `${base}New quest`
        let suffix = 2
        while (this.app.vault.getAbstractFileByPath(`${folder}/${title}.md`)) {
            title = `${base}New quest ${suffix++}`
        }

        const seed: NewQuestFields = {
            title,
            status: 'available',
            areas: project ? this.areasOfProject(project) : [],
            projects: project ? [project.basename] : [],
            priority: null,
            // Pre-dated rather than empty: an undated quest tends to stay undated.
            due: this.settings.defaultDueDays > 0
                ? addDays(this.todayISO(), this.settings.defaultDueDays)
                : null,
            accepted: null,
            blockedBy: [],
            objectives: [],
            brief: '',
        }

        new QuestCreateModal(this, seed, fields => void this.writeQuest(folder, fields)).open()
    }

    /** Creates the note the modal described, keeping the filename unique. */
    private async writeQuest(folder: string, fields: NewQuestFields): Promise<void> {
        let title = fields.title
        let suffix = 2
        while (this.app.vault.getAbstractFileByPath(`${folder}/${title}.md`)) {
            title = `${fields.title} ${suffix++}`
        }

        const file = await this.app.vault.create(
            `${folder}/${title}.md`,
            buildQuestNote({ ...fields, title }, this.settings.keys, this.settings.typeValue, this.settings.objectivesHeading || 'Objectives'),
        )
        await this.app.workspace.getLeaf(false).openFile(file)
        new Notice(`Created ${file.path}`)
    }

    /** A new quest starts out serving whatever its project serves. */
    private areasOfProject(project: TFile): string[] {
        const frontmatter = this.app.metadataCache.getFileCache(project)?.frontmatter as Record<string, unknown> | undefined
        if (!frontmatter) return []
        // Foundry capitalises this on projects; accept either spelling.
        const raw = frontmatter['Life Areas'] ?? frontmatter[this.settings.keys.areas]
        if (raw === null || raw === undefined) return []
        const list = Array.isArray(raw) ? raw : [raw]
        return list
            .map(entry => String(entry).replace(/^"|"$/g, '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim())
            .filter(name => name.length > 0)
    }
}
