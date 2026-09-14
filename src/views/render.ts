/**
 * The pieces the board and the `questline` codeblock both draw.
 *
 * Everything takes a RenderContext rather than reaching for a view, so a quest
 * row looks and behaves the same whether it is on the board or embedded in a
 * project note.
 */

import { Keymap, Notice, setIcon, type App } from 'obsidian'
import type Questline from '../main'
import { STATUS_LABELS, progressOf, summariseArea, type Quest } from '../quests/Quest'
import { parseInline } from '../quests/inline'
import { formatShortDate } from '../quests/periods'
import { DueModal } from './modals'

export interface RenderContext {
    plugin: Questline
    app: App
    /** The note or view drawing this, so links resolve relative to it. */
    sourcePath: string
    /** Which quests have their objectives open. Shared across a render pass. */
    expanded: Set<string>
    refresh: () => void
}

export interface DueChip {
    text: string
    cls: string
    icon: string
}

/**
 * The words and tone for the due pill.
 *
 * Dates are spelled `27 Oct` rather than `2026-10-27`: the pill is read at a
 * glance beside a dozen others, and the year is noise in all but the rare case
 * where it is not this one.
 */
export function dueChip(plugin: Questline, quest: Quest): DueChip | null {
    if (quest.status === 'complete') {
        if (!quest.completed) return null
        return { text: `sealed ${formatShortDate(quest.completed, plugin.todayISO())}`, cls: 'is-sealed', icon: 'check' }
    }

    if (!quest.due) return null
    const days = plugin.daysUntil(quest.due)
    if (days === null) return null

    if (days < 0) {
        const late = Math.abs(days)
        return { text: `${late} ${late === 1 ? 'day' : 'days'} overdue`, cls: 'is-late', icon: 'alert-circle' }
    }
    if (days === 0) return { text: 'due today', cls: 'is-late', icon: 'alert-circle' }
    if (days === 1) return { text: 'due tomorrow', cls: 'is-soon', icon: 'clock' }
    if (days <= 10) return { text: `due in ${days} days`, cls: 'is-soon', icon: 'clock' }
    return { text: `due ${formatShortDate(quest.due, plugin.todayISO())}`, cls: '', icon: 'calendar' }
}

export function questLink(parent: HTMLElement, quest: Quest, ctx: RenderContext, cls: string): HTMLElement {
    const link = parent.createEl('button', { cls, text: quest.title })
    link.addEventListener('click', () => {
        const file = ctx.app.vault.getFileByPath(quest.path)
        if (!file) {
            new Notice(`${quest.title} is no longer in the vault.`)
            return
        }
        void ctx.app.workspace.getLeaf(false).openFile(file)
    })
    return link
}

/**
 * Draws text that may contain `[[wikilinks]]`.
 *
 * Links are real anchors carrying `internal-link` and `data-href`, so themes
 * style them and Obsidian's own hover-preview sees them. The click is handled
 * here rather than left to the global handler so modifier-clicks still open in
 * a new tab, and so the toggle behind the text does not also fire.
 */
export function renderInline(parent: HTMLElement, text: string, ctx: RenderContext): void {
    for (const segment of parseInline(text)) {
        if (segment.kind === 'text') {
            parent.appendText(segment.text)
            continue
        }

        const link = parent.createEl('a', { cls: 'internal-link', text: segment.display })
        link.dataset.href = segment.target
        link.setAttribute('href', segment.target)

        const resolved = ctx.app.metadataCache.getFirstLinkpathDest(
            segment.target.split('#')[0],
            ctx.sourcePath,
        )
        if (!resolved) link.addClass('is-unresolved')

        link.addEventListener('click', event => {
            event.preventDefault()
            event.stopPropagation()
            void ctx.app.workspace.openLinkText(segment.target, ctx.sourcePath, Keymap.isModEvent(event))
        })
    }
}

export function noteLink(parent: HTMLElement, name: string, ctx: RenderContext, cls: string): void {
    const link = parent.createEl('button', { cls, text: name })
    link.addEventListener('click', () => {
        void ctx.app.workspace.openLinkText(name, ctx.sourcePath, false)
    })
}

export function statusChip(parent: HTMLElement, quest: Quest): void {
    parent.createSpan({ cls: `ql-chip is-${quest.status}`, text: STATUS_LABELS[quest.status] })
}

export function meter(parent: HTMLElement, fraction: number): HTMLElement {
    const track = parent.createDiv('ql-meter')
    track.createDiv('ql-meter-fill').style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`
    return track
}

export function startButton(parent: HTMLElement, quest: Quest, ctx: RenderContext): void {
    const button = parent.createEl('button', { cls: 'ql-start', text: 'Start' })
    button.addEventListener('click', () => void ctx.plugin.startQuest(quest))
}

export function renderBlockers(parent: HTMLElement, quest: Quest, ctx: RenderContext): void {
    const { index, settings } = { index: ctx.plugin.index, settings: ctx.plugin.settings }

    if (quest.blockedBy.length > 0) {
        // A name that resolves to nothing keeps blocking, so it is listed too.
        const open = quest.blockedBy.filter(title => {
            const blocker = index.lookup(title)
            return !blocker || blocker.status !== 'complete'
        })
        const line = parent.createDiv(open.length > 0 ? 'ql-blocked' : 'ql-blocked is-clear')
        setIcon(line.createSpan('ql-blocked-icon'), open.length > 0 ? 'circle-slash' : 'circle-check')
        line.createSpan({
            text: open.length > 0
                ? `Blocked by ${open.join(', ')}`
                : `Unblocked — ${quest.blockedBy.join(', ')} complete`,
        })
    }

    if (!settings.showBlocks || quest.status === 'complete') return
    const blocking = index.blockedByThis(quest)
    if (blocking.length === 0) return

    const line = parent.createDiv('ql-blocks')
    setIcon(line.createSpan('ql-blocked-icon'), 'circle-slash')
    line.createSpan({ text: `Blocks ${blocking.map(other => other.title).join(', ')}` })
}

export interface QuestRowOptions {
    /** Objectives can be expanded. Off, the disclosure is not drawn at all. */
    objectives: boolean
    /** Embedded rows drop the meta the host note already tells you. */
    compact?: boolean
}

export function renderQuestRow(
    parent: HTMLElement,
    quest: Quest,
    ctx: RenderContext,
    options: QuestRowOptions,
): void {
    const { index } = ctx.plugin
    const progress = progressOf(quest)
    const open = options.objectives && ctx.expanded.has(quest.path)

    const row = parent.createDiv('ql-quest')
    if (quest.areas[0]) row.dataset.area = quest.areas[0]
    if (quest.status === 'complete') row.addClass('is-sealed')
    if (options.compact) row.addClass('is-compact')

    if (options.objectives) {
        const disclosure = row.createEl('button', {
            cls: 'ql-disclosure',
            attr: { 'aria-expanded': String(open), 'aria-label': `Objectives for ${quest.title}` },
        })
        setIcon(disclosure, open ? 'chevron-down' : 'chevron-right')
        disclosure.addEventListener('click', () => {
            if (open) ctx.expanded.delete(quest.path)
            else ctx.expanded.add(quest.path)
            ctx.refresh()
        })
    } else {
        row.createDiv('ql-disclosure-spacer')
    }

    const main = row.createDiv('ql-main')
    questLink(main, quest, ctx, 'ql-title')

    const meta = main.createDiv('ql-meta')
    const priority = index.priorityOf(quest)
    if (priority.value !== null) {
        const badge = meta.createSpan({ cls: 'ql-priority', text: `P${priority.value}` })
        if (priority.inherited) {
            badge.addClass('is-inherited')
            badge.setAttribute('title', `Priority ${priority.value}, inherited from ${priority.from}`)
        } else {
            badge.setAttribute('title', `Priority ${priority.value}, set on this quest`)
        }
    }
    for (const area of quest.areas) {
        meta.createSpan({ cls: 'ql-area-chip', text: area }).dataset.area = area
    }
    if (!options.compact) {
        for (const project of quest.projects) noteLink(meta, project, ctx, 'ql-link')
    }

    renderBlockers(main, quest, ctx)

    if (open) {
        const list = main.createEl('ul', 'ql-objectives')
        for (const objective of quest.objectives) {
            // The row is a list item, not a button: objective text can contain
            // links, and an anchor inside a button is both invalid and unusable
            // — the click would always toggle instead of following the link.
            const item = list.createEl('li', 'ql-objective')
            item.toggleClass('is-done', objective.done)

            const box = item.createEl('button', {
                cls: 'ql-box',
                attr: { 'aria-pressed': String(objective.done), 'aria-label': objective.text },
            })
            if (objective.done) setIcon(box, 'check')
            box.addEventListener('click', () => void ctx.plugin.toggleObjective(quest, objective))

            const text = item.createSpan('ql-objective-text')
            renderInline(text, objective.text, ctx)
            // Clicking the text still toggles, which keeps the large hit target
            // the row had before. Links inside it stop the event first.
            text.addEventListener('click', () => void ctx.plugin.toggleObjective(quest, objective))
        }
    }

    const side = row.createDiv('ql-side')
    if (index.isReady(quest)) side.createSpan({ cls: 'ql-chip is-ready', text: 'Ready' })
    else if (index.isBlocked(quest)) side.createSpan({ cls: 'ql-chip is-blocked', text: 'Blocked' })
    statusChip(side, quest)

    const due = dueChip(ctx.plugin, quest)
    if (due) {
        const chip = side.createEl('button', { cls: `ql-due ${due.cls}` })
        setIcon(chip.createSpan('ql-due-icon'), due.icon)
        chip.createSpan({ cls: 'ql-due-text', text: due.text })
        chip.setAttribute('title', 'Change the due date')
        chip.addEventListener('click', event => {
            event.stopPropagation()
            const file = ctx.plugin.app.vault.getFileByPath(quest.path)
            if (file) new DueModal(ctx.plugin, quest, file).open()
        })
    }

    const progressEl = side.createDiv('ql-progress')
    meter(progressEl, progress.total > 0 ? progress.done / progress.total : 0)
    progressEl.createSpan({ cls: 'ql-progress-n', text: `${progress.done}/${progress.total}` })
}

/** The life-area strip: active count, objective progress, neglect warning. */
export function renderAreaStrip(parent: HTMLElement, ctx: RenderContext): void {
    const { index, settings } = ctx.plugin
    const areas = index.areas()
    if (areas.length === 0) return

    const strip = parent.createDiv('ql-areas')
    const today = ctx.plugin.todayISO()

    for (const area of areas) {
        const { live, active, done, total } = summariseArea(index.questsInArea(area))
        const open = total - done

        // Only an area with nothing unfinished can be neglected. Quests sitting
        // at `available` are work waiting, not an absence of work.
        const idleDays = live === 0 ? index.areaIdleDays(area, today) : null
        const neglected = settings.neglectWarn && idleDays !== null && idleDays >= settings.neglectDays

        const cell = strip.createDiv('ql-area')
        cell.dataset.area = area
        if (neglected) cell.addClass('is-neglected')

        cell.createDiv('ql-area-top').createSpan({ cls: 'ql-area-name', text: area })
        cell.createSpan({
            cls: 'ql-area-count',
            text: live === 0 ? 'nothing yet' : `${live} quest${live === 1 ? '' : 's'}`,
        })
        meter(cell, total > 0 ? done / total : 0)

        let sub: string
        if (live === 0) sub = idleDays !== null ? `nothing for ${idleDays} days` : 'no quests here'
        else if (total === 0) sub = active > 0 ? `${active} active` : 'none started'
        else if (active > 0) sub = `${active} active · ${open} open`
        else sub = `none started · ${open} open`

        cell.createSpan({ cls: 'ql-area-sub', text: sub })
    }
}

export function renderReadyStrip(parent: HTMLElement, ctx: RenderContext): void {
    const ready = ctx.plugin.index.readyQuests()
    if (ready.length === 0) return

    const box = parent.createDiv('ql-ready')
    const head = box.createDiv('ql-ready-head')
    setIcon(head.createSpan('ql-ready-icon'), 'circle-check')
    const text = head.createDiv()
    text.createEl('p', {
        cls: 'ql-ready-h',
        text: ready.length === 1 ? 'A quest is ready to start' : `${ready.length} quests are ready to start`,
    })
    text.createEl('p', {
        cls: 'ql-ready-sub',
        text: 'Everything blocking it is finished. Nothing starts on its own — pick it up when you want it.',
    })

    const list = box.createEl('ul', 'ql-ready-list')
    for (const quest of ready) {
        const row = list.createEl('li')
        statusChip(row, quest)
        questLink(row, quest, ctx, 'ql-ready-name')
        row.createSpan({
            cls: 'ql-ready-why',
            text: quest.blockedBy.length > 0 ? `${quest.blockedBy.join(', ')} complete` : 'blockers cleared',
        })
        startButton(row, quest, ctx)
    }
}
