/**
 * The pieces the board and the `questline` codeblock both draw.
 *
 * Everything takes a RenderContext rather than reaching for a view, so a quest
 * row looks and behaves the same whether it is on the board or embedded in a
 * project note.
 */

import { Notice, setIcon, type App } from 'obsidian'
import type Questline from '../main'
import { STATUS_LABELS, progressOf, type Quest } from '../quests/Quest'

export interface RenderContext {
    plugin: Questline
    app: App
    /** The note or view drawing this, so links resolve relative to it. */
    sourcePath: string
    /** Which quests have their objectives open. Shared across a render pass. */
    expanded: Set<string>
    refresh: () => void
}

export function dueText(plugin: Questline, quest: Quest): { text: string; cls: string } | null {
    if (quest.status === 'complete') {
        return quest.completed ? { text: `sealed ${quest.completed}`, cls: '' } : null
    }
    if (!quest.due) return null
    const days = plugin.daysUntil(quest.due)
    if (days === null) return null
    if (days < 0) return { text: `${Math.abs(days)} days overdue`, cls: 'is-late' }
    if (days === 0) return { text: 'due today', cls: 'is-late' }
    if (days <= 10) return { text: `due in ${days} days`, cls: 'is-soon' }
    return { text: `due ${quest.due}`, cls: '' }
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
            const button = list.createEl('li').createEl('button', {
                cls: 'ql-objective',
                attr: { 'aria-pressed': String(objective.done) },
            })
            button.toggleClass('is-done', objective.done)
            const box = button.createSpan('ql-box')
            if (objective.done) setIcon(box, 'check')
            button.createSpan({ cls: 'ql-objective-text', text: objective.text })
            button.addEventListener('click', () => void ctx.plugin.toggleObjective(quest, objective))
        }
    }

    const side = row.createDiv('ql-side')
    if (index.isReady(quest)) side.createSpan({ cls: 'ql-chip is-ready', text: 'Ready' })
    statusChip(side, quest)

    const due = dueText(ctx.plugin, quest)
    if (due) side.createSpan({ cls: `ql-due ${due.cls}`, text: due.text })

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
        const live = index.questsInArea(area).filter(quest => quest.status !== 'complete')
        const active = live.filter(quest => quest.status === 'active').length
        let done = 0
        let total = 0
        for (const quest of live) {
            const progress = progressOf(quest)
            done += progress.done
            total += progress.total
        }

        const idleDays = active === 0 ? index.areaIdleDays(area, today) : null
        const neglected = settings.neglectWarn && idleDays !== null && idleDays >= settings.neglectDays

        const cell = strip.createDiv('ql-area')
        cell.dataset.area = area
        if (neglected) cell.addClass('is-neglected')

        cell.createDiv('ql-area-top').createSpan({ cls: 'ql-area-name', text: area })
        cell.createSpan({ cls: 'ql-area-count', text: `${active} active` })
        meter(cell, total > 0 ? done / total : 0)
        cell.createSpan({
            cls: 'ql-area-sub',
            text: active === 0
                ? (idleDays !== null ? `no active quest · ${idleDays} days` : 'nothing active')
                : `${total - done} objectives open`,
        })
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
