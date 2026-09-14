/**
 * The `questline` codeblock.
 *
 * Scoped to a project (`project: this`) or to a stretch of time
 * (`period: this`, resolved from the host note's own name). A block is a live
 * render of the same index the board reads, so checking an objective inside a
 * project note updates the board, the life-area meters and every other block.
 */

import { MarkdownRenderChild, setIcon, type MarkdownPostProcessorContext } from 'obsidian'
import type Questline from '../main'
import { progressOf, type Quest, type BoardStatus } from '../quests/Quest'
import {
    MONTHS_SHORT,
    addDays,
    daysBetween,
    inPeriod,
    monthsOfYear,
    parsePeriodName,
    type Period,
} from '../quests/periods'
import { defaultSections, parseQuery, type QuestQuery, type Section } from './query'
import {
    questLink,
    renderQuestRow,
    renderReadyStrip,
    startButton,
    statusChip,
    type RenderContext,
} from './render'

/**
 * `blocked` is in the default on purpose. A block that does not name statuses
 * should keep showing everything it showed before blocking became a status of
 * its own — dropping quests out of a project note silently is worse than
 * listing one you cannot start yet. Naming statuses explicitly excludes it.
 */
const EMBED_STATUSES: BoardStatus[] = ['active', 'held', 'available', 'blocked']

export function registerCodeblock(plugin: Questline): void {
    plugin.registerMarkdownCodeBlockProcessor('questline', (source, el, ctx) => {
        ctx.addChild(new QuestlineBlock(el, plugin, source, ctx))
    })
}

class QuestlineBlock extends MarkdownRenderChild {
    private plugin: Questline
    private query: QuestQuery
    private sourcePath: string
    private expanded = new Set<string>()
    private unsubscribe: (() => void) | null = null

    constructor(containerEl: HTMLElement, plugin: Questline, source: string, ctx: MarkdownPostProcessorContext) {
        super(containerEl)
        this.plugin = plugin
        this.query = parseQuery(source)
        this.sourcePath = ctx.sourcePath
    }

    onload(): void {
        this.unsubscribe = this.plugin.index.subscribe(() => this.render())
        this.render()
    }

    onunload(): void {
        this.unsubscribe?.()
        this.unsubscribe = null
    }

    private get ctx(): RenderContext {
        return {
            plugin: this.plugin,
            app: this.plugin.app,
            sourcePath: this.sourcePath,
            expanded: this.expanded,
            refresh: () => this.render(),
        }
    }

    /** The host note's basename, which is what `this` means. */
    private hostName(): string {
        const name = this.sourcePath.split('/').pop() ?? ''
        return name.replace(/\.md$/i, '')
    }

    private render(): void {
        const root = this.containerEl
        root.empty()
        root.addClass('questline-block')

        const query = this.query
        const project = query.project === 'this' ? this.hostName() : query.project
        const periodName = query.period === 'this' ? this.hostName() : query.period
        const period = periodName ? parsePeriodName(periodName) : null

        if (query.period && !period) {
            this.renderHead(root, 'not a periodic note')
            this.renderErrors(root, [
                `"${periodName}" is not a periodic note name. Questline reads 2026, Sep-2026, 2026-09 and 2026-W37.`,
            ])
            return
        }

        const sections = query.show ?? defaultSections(
            period ? period.kind : (project ? 'project' : 'vault'),
        )

        if (period) this.renderPeriod(root, period, sections)
        else this.renderProject(root, project, sections)

        this.renderErrors(root, query.errors)
    }

    /* ----------------------------------------------------------------- head */

    private renderHead(parent: HTMLElement, right: string): void {
        const head = parent.createDiv('ql-block-head')
        setIcon(head.createSpan('ql-block-icon'), 'flag')
        head.createSpan({ cls: 'ql-block-name', text: 'Questline' })
        head.createSpan({ cls: 'ql-block-query', text: this.queryLine() })
        head.createSpan({ cls: 'ql-block-count', text: right })
    }

    private queryLine(): string {
        const parts: string[] = []
        if (this.query.project) parts.push(`project: ${this.query.project}`)
        if (this.query.period) parts.push(`period: ${this.query.period}`)
        if (this.query.horizon > 0) parts.push(`horizon: ${this.query.horizon}d`)
        if (this.query.statuses) parts.push(`status: ${this.query.statuses.join(', ')}`)
        if (this.query.blocking) parts.push(`blocking: ${this.query.blockingScope}`)
        return parts.join(' · ')
    }

    private renderErrors(parent: HTMLElement, errors: string[]): void {
        if (errors.length === 0) return
        const box = parent.createDiv('ql-block-errors')
        for (const error of errors) box.createDiv({ cls: 'ql-block-error', text: error })
    }

    private section(parent: HTMLElement, label: string, count?: number): HTMLElement {
        const section = parent.createDiv('ql-block-section')
        const heading = section.createEl('p', { cls: 'ql-block-h', text: label })
        if (count !== undefined) heading.createSpan({ cls: 'ql-block-n', text: String(count) })
        return section
    }

    private empty(parent: HTMLElement, text: string): void {
        parent.createDiv({ cls: 'ql-block-empty', text })
    }

    /* -------------------------------------------------------------- project */

    private renderProject(parent: HTMLElement, project: string | null, sections: Section[]): void {
        const { index } = this.plugin
        const statuses = this.query.statuses ?? EMBED_STATUSES

        let quests = index.all().filter(quest => statuses.includes(index.effectiveStatus(quest)))
        if (project) quests = quests.filter(quest => quest.projects.includes(project))
        // Asking for blocked outranks the setting that hides them, as on the board.
        if (this.plugin.settings.hideBlocked && !statuses.includes('blocked')) {
            quests = quests.filter(quest => !index.isBlocked(quest))
        }
        quests = index.sorted(quests)
        if (this.query.limit) quests = quests.slice(0, this.query.limit)

        const active = quests.filter(quest => index.effectiveStatus(quest) === 'active').length
        this.renderHead(parent, `${quests.length} ${quests.length === 1 ? 'quest' : 'quests'} · ${active} active`)

        if (quests.length === 0) {
            this.empty(parent, project
                ? 'No quests point at this project yet.'
                : 'No quests match this block.')
        } else {
            const list = parent.createDiv('ql-list')
            for (const quest of quests) {
                renderQuestRow(list, quest, this.ctx, { objectives: sections.includes('objectives'), compact: !!project })
            }
        }

        if (this.query.blocking) this.renderWaiting(parent, quests, project)
    }

    /**
     * Quests elsewhere that cannot start until something in this block finishes.
     * Without this a project note can never see what it is holding up, because
     * the blocked quest links to a different project.
     */
    private renderWaiting(parent: HTMLElement, listed: Quest[], project: string | null): void {
        const { index } = this.plugin
        const listedTitles = new Set(listed.map(quest => quest.title))

        const waiting = index.all().filter(quest => {
            if (listedTitles.has(quest.title)) return false
            if (this.query.blockingScope === 'project' && project && !quest.projects.includes(project)) return false
            return quest.blockedBy.some(title => listedTitles.has(title))
        })
        if (waiting.length === 0) return

        const section = this.section(parent, 'Waiting on this project', waiting.length)
        const rows = section.createDiv('ql-waiting')
        for (const quest of waiting) {
            const row = rows.createDiv('ql-waiting-row')
            statusChip(row, quest)
            questLink(row, quest, this.ctx, 'ql-ready-name')

            const open = quest.blockedBy.filter(title => {
                const blocker = index.lookup(title)
                return !blocker || blocker.status !== 'complete'
            })
            if (open.length > 0) {
                row.createSpan({ cls: 'ql-waiting-why', text: `blocked by ${open.join(', ')}` })
            } else {
                row.createSpan({ cls: 'ql-waiting-why is-clear', text: 'blocker cleared — ready to start' })
                startButton(row, quest, this.ctx)
            }
        }
    }

    /* --------------------------------------------------------------- period */

    private renderPeriod(parent: HTMLElement, period: Period, sections: Section[]): void {
        const { index } = this.plugin
        const sealed = index.all()
            .filter(quest => quest.status === 'complete' && inPeriod(quest.completed, period))
            .sort((a, b) => (a.completed ?? '').localeCompare(b.completed ?? ''))

        this.renderHead(parent, `${period.label} · ${sealed.length} sealed`)

        for (const section of sections) {
            switch (section) {
                case 'sealed': this.renderSealed(parent, sealed); break
                case 'due': this.renderDue(parent, period); break
                case 'ready': this.renderReady(parent); break
                case 'life-areas': this.renderPeriodAreas(parent, period, sealed); break
                case 'sealed-by-month': this.renderChart(parent, period); break
                case 'long-running': this.renderLongRunning(parent); break
                default: break
            }
        }
    }

    private renderSealed(parent: HTMLElement, sealed: Quest[]): void {
        const section = this.section(parent, 'Sealed', sealed.length)
        if (sealed.length === 0) {
            this.empty(section, 'Nothing sealed in this period.')
            return
        }
        const rows = section.createDiv('ql-rows')
        for (const quest of sealed) {
            const row = rows.createDiv('ql-row')
            row.createSpan({ cls: 'ql-row-date', text: quest.completed ?? '' })
            questLink(row, quest, this.ctx, 'ql-ready-name')
            for (const area of quest.areas) {
                row.createSpan({ cls: 'ql-area-chip', text: area }).dataset.area = area
            }
            row.createSpan({ cls: 'ql-row-meta', text: `${progressOf(quest).total} objectives` })
        }
    }

    /** The horizon is what stops a strict Mon–Sun window showing almost nothing. */
    private renderDue(parent: HTMLElement, period: Period): void {
        const until = addDays(period.end, this.query.horizon)
        const due = this.plugin.index.all()
            .filter(quest => quest.status !== 'complete' && quest.due !== null && quest.due <= until)
            .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))

        const label = this.query.horizon > 0 ? `Due by ${until}` : 'Due'
        const section = this.section(parent, label, due.length)
        if (due.length === 0) {
            this.empty(section, 'Nothing is due in this window.')
            return
        }

        const rows = section.createDiv('ql-rows')
        for (const quest of due) {
            const row = rows.createDiv('ql-row')
            row.createSpan({ cls: 'ql-row-date', text: quest.due ?? '' })
            questLink(row, quest, this.ctx, 'ql-ready-name')
            statusChip(row, quest)
            const progress = progressOf(quest)
            row.createSpan({ cls: 'ql-row-meta', text: `${progress.total - progress.done} left` })
        }
    }

    private renderReady(parent: HTMLElement): void {
        const ready = this.plugin.index.readyQuests()
        const section = this.section(parent, 'Ready to pick up', ready.length)
        if (ready.length === 0) {
            this.empty(section, 'Nothing is waiting to be picked up.')
            return
        }
        renderReadyStrip(section, this.ctx)
    }

    private renderPeriodAreas(parent: HTMLElement, period: Period, sealed: Quest[]): void {
        const { index } = this.plugin
        const section = this.section(parent, 'Life areas')

        if (period.kind === 'year') {
            // At a year's altitude the useful number is share of finished work.
            const counts = index.areas().map(area => ({
                area,
                sealed: sealed.filter(quest => quest.areas.includes(area)).length,
            }))
            const max = counts.reduce((most, entry) => Math.max(most, entry.sealed), 0)
            const rows = section.createDiv('ql-rows')
            for (const entry of counts) {
                const row = rows.createDiv('ql-row')
                row.dataset.area = entry.area
                row.createSpan({ cls: 'ql-area-chip', text: entry.area }).dataset.area = entry.area
                const bar = row.createDiv('ql-bar')
                bar.createDiv('ql-bar-fill').style.width = max > 0 ? `${Math.round((entry.sealed / max) * 100)}%` : '0%'
                row.createSpan({
                    cls: 'ql-row-meta',
                    text: `${entry.sealed} ${entry.sealed === 1 ? 'quest' : 'quests'}`,
                })
            }
            return
        }

        const strip = section.createDiv('ql-mini-areas')
        for (const area of index.areas()) {
            const sealedHere = sealed.filter(quest => quest.areas.includes(area)).length
            const open = index.questsInArea(area).filter(quest => quest.status !== 'complete').length
            const cell = strip.createDiv('ql-mini-area')
            cell.dataset.area = area
            cell.createDiv('ql-mini-top').createSpan({ cls: 'ql-mini-name', text: area })
            cell.createSpan({ cls: 'ql-mini-v', text: `${sealedHere} sealed · ${open} open` })
        }
    }

    private renderChart(parent: HTMLElement, period: Period): void {
        const { index } = this.plugin
        const months = monthsOfYear(period)
        const counts = months.map(month =>
            index.all().filter(quest => quest.status === 'complete' && inPeriod(quest.completed, month)).length)
        const max = counts.reduce((most, count) => Math.max(most, count), 0)
        const total = counts.reduce((sum, count) => sum + count, 0)
        const thisMonth = this.plugin.todayISO().slice(0, 7)

        const section = this.section(parent, 'Sealed by month', total)
        const wrap = section.createDiv('ql-chart-wrap')
        const chart = wrap.createDiv('ql-chart')

        counts.forEach((count, month) => {
            const column = chart.createDiv('ql-chart-col')
            if (count === 0) column.addClass('is-zero')
            if (months[month].start.slice(0, 7) === thisMonth) column.addClass('is-now')
            column.createSpan({ cls: 'ql-chart-v', text: String(count) })
            const track = column.createDiv('ql-chart-track')
            track.createDiv('ql-chart-bar').style.height = max > 0 ? `${Math.round((count / max) * 100)}%` : '0%'
            column.createSpan({ cls: 'ql-chart-x', text: MONTHS_SHORT[month] })
        })
    }

    private renderLongRunning(parent: HTMLElement): void {
        const today = this.plugin.todayISO()
        const open = this.plugin.index.all()
            .filter(quest => quest.status !== 'complete' && quest.accepted !== null)
            .map(quest => ({ quest, days: daysBetween(quest.accepted as string, today) ?? 0 }))
            .sort((a, b) => b.days - a.days)
            .slice(0, this.query.limit ?? 5)

        const section = this.section(parent, 'Open the longest', open.length)
        if (open.length === 0) {
            this.empty(section, 'Nothing has been open long enough to worry about.')
            return
        }

        const rows = section.createDiv('ql-rows')
        for (const entry of open) {
            const row = rows.createDiv('ql-row')
            row.createSpan({ cls: 'ql-row-date', text: `${entry.days}d` })
            questLink(row, entry.quest, this.ctx, 'ql-ready-name')
            statusChip(row, entry.quest)
            const progress = progressOf(entry.quest)
            row.createSpan({
                cls: 'ql-row-meta',
                text: `accepted ${entry.quest.accepted} · ${progress.done}/${progress.total}`,
            })
        }
    }
}
