import { Component, TFile, TFolder, normalizePath, type App, type TAbstractFile } from 'obsidian'
import type Questline from '../main'
import {
    blockedByThis,
    compareQuests,
    isBlocked,
    isReady,
    resolvePriority,
    type Quest,
    type QuestLookup,
    type ResolvedPriority,
} from './Quest'
import { looksLikeQuest, parseQuest, toPriority, type HeadingRef } from './QuestParser'

/**
 * Watches the quest folder, parses one file at a time, and keeps the project
 * priority table alongside it so inheritance can resolve without a second pass.
 *
 * Re-parses only the file that changed, debounced so a typing burst doesn't
 * thrash the board.
 */
export class QuestIndex extends Component {
    private app: App
    private plugin: Questline
    private byPath = new Map<string, Quest>()
    private projectPriority = new Map<string, number>()
    private areaNames: string[] = []
    private subscribers = new Set<() => void>()
    private flushTimer: number | null = null

    constructor(app: App, plugin: Questline) {
        super()
        this.app = app
        this.plugin = plugin
    }

    onload(): void {
        this.registerEvent(this.app.metadataCache.on('changed', file => void this.onFileChanged(file)))
        this.registerEvent(this.app.vault.on('create', file => void this.onFileChanged(file)))
        this.registerEvent(this.app.vault.on('delete', file => this.onFileDeleted(file)))
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => void this.onFileRenamed(file, oldPath)))
        this.app.workspace.onLayoutReady(() => void this.rebuild())
    }

    onunload(): void {
        this.byPath.clear()
        this.projectPriority.clear()
        this.subscribers.clear()
        if (this.flushTimer !== null) window.clearTimeout(this.flushTimer)
    }

    /** Views re-render on this. Returns an unsubscribe. */
    subscribe(callback: () => void): () => void {
        this.subscribers.add(callback)
        return () => this.subscribers.delete(callback)
    }

    notify(): void {
        for (const callback of this.subscribers) callback()
    }

    private scheduleNotify(): void {
        if (this.flushTimer !== null) window.clearTimeout(this.flushTimer)
        this.flushTimer = window.setTimeout(() => {
            this.flushTimer = null
            this.notify()
        }, 120)
    }

    /* -------------------------------------------------------------- reading */

    all(): Quest[] {
        return Array.from(this.byPath.values())
    }

    get(path: string): Quest | undefined {
        return this.byPath.get(path)
    }

    /** `blocked-by` addresses quests by note name, so that is the lookup key. */
    lookup: QuestLookup = (title: string) => {
        for (const quest of this.byPath.values()) if (quest.title === title) return quest
        return undefined
    }

    /**
     * Life areas come from their own folder, not from the quests, so an area
     * with nothing pointing at it can still be flagged as neglected.
     */
    areas(): string[] {
        if (this.areaNames.length > 0) return this.areaNames
        const seen = new Set<string>()
        for (const quest of this.byPath.values()) for (const area of quest.areas) seen.add(area)
        return Array.from(seen).sort((a, b) => a.localeCompare(b))
    }

    questsInArea(area: string): Quest[] {
        return this.all().filter(quest => quest.areas.includes(area))
    }

    /**
     * Days since an area last had movement, or null when something is active.
     * The vault has no history, so the most recent completed-or-accepted date
     * across the area's quests is the honest approximation.
     */
    areaIdleDays(area: string, todayISO: string): number | null {
        const quests = this.questsInArea(area)
        if (quests.some(quest => quest.status === 'active')) return null

        let latest: string | null = null
        for (const quest of quests) {
            for (const date of [quest.completed, quest.accepted]) {
                if (date && (latest === null || date > latest)) latest = date
            }
        }
        if (latest === null) return null

        const then = Date.parse(latest + 'T00:00:00')
        const now = Date.parse(todayISO + 'T00:00:00')
        if (Number.isNaN(then) || Number.isNaN(now)) return null
        return Math.max(0, Math.round((now - then) / 86400000))
    }

    priorityOf(quest: Quest): ResolvedPriority {
        return resolvePriority(
            quest,
            project => this.projectPriority.get(project) ?? null,
            this.plugin.settings.inheritPriority,
        )
    }

    sorted(quests: Quest[]): Quest[] {
        if (!this.plugin.settings.sortByPriority) return quests
        return quests.slice().sort((a, b) => compareQuests(a, b, quest => this.priorityOf(quest).value))
    }

    isBlocked(quest: Quest): boolean {
        return isBlocked(quest, this.lookup)
    }

    isReady(quest: Quest): boolean {
        return this.plugin.settings.onUnblock === 'flag' && isReady(quest, this.lookup)
    }

    readyQuests(): Quest[] {
        return this.all().filter(quest => this.isReady(quest))
    }

    blockedByThis(quest: Quest): Quest[] {
        return blockedByThis(quest, this.all())
    }

    /* ------------------------------------------------------------ indexing */

    async rebuild(): Promise<void> {
        this.byPath.clear()
        this.projectPriority.clear()
        this.areaNames = []

        await Promise.all([
            this.indexFolder(this.plugin.settings.projectFolder, file => this.indexProject(file)),
            this.indexFolder(this.plugin.settings.areaFolder, file => { this.areaNames.push(file.basename) }),
            this.indexFolder(this.plugin.settings.questFolder, file => this.indexQuest(file)),
        ])
        this.areaNames.sort((a, b) => a.localeCompare(b))
        this.notify()
    }

    private async indexFolder(root: string, index: (file: TFile) => Promise<void> | void): Promise<void> {
        const folder = root ? this.app.vault.getFolderByPath(normalizePath(root)) : null
        if (!folder) return

        const files: TFile[] = []
        const collect = (source: TFolder): void => {
            for (const child of source.children) {
                if (child instanceof TFile && child.extension === 'md') files.push(child)
                else if (child instanceof TFolder) collect(child)
            }
        }
        collect(folder)
        await Promise.all(files.map(file => index(file)))
    }

    private inFolder(path: string, root: string): boolean {
        if (!root) return false
        const folder = normalizePath(root)
        return path === folder || path.startsWith(folder + '/')
    }

    private async indexQuest(file: TFile): Promise<void> {
        const { settings } = this.plugin
        const cache = this.app.metadataCache.getFileCache(file)
        const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined

        if (!looksLikeQuest(frontmatter, settings.keys, settings.typeValue)) {
            this.byPath.delete(file.path)
            return
        }

        const content = await this.app.vault.cachedRead(file)
        const headings: HeadingRef[] = (cache?.headings ?? []).map(heading => ({
            text: heading.heading,
            level: heading.level,
            line: heading.position.start.line,
        }))

        this.byPath.set(file.path, parseQuest(
            { path: file.path, title: file.basename, frontmatter, lines: content.split('\n'), headings },
            { keys: settings.keys, objectivesHeading: settings.objectivesHeading || null },
        ))
    }

    private indexProject(file: TFile): void {
        const cache = this.app.metadataCache.getFileCache(file)
        const raw = (cache?.frontmatter as Record<string, unknown> | undefined)?.[this.plugin.settings.projectPriorityKey]
        const priority = toPriority(raw)
        if (priority === null) this.projectPriority.delete(file.basename)
        else this.projectPriority.set(file.basename, priority)
    }

    /* -------------------------------------------------------------- events */

    private async onFileChanged(file: TAbstractFile): Promise<void> {
        if (!(file instanceof TFile) || file.extension !== 'md') return
        const { settings } = this.plugin

        if (this.inFolder(file.path, settings.questFolder)) await this.indexQuest(file)
        else if (this.inFolder(file.path, settings.projectFolder)) this.indexProject(file)
        else if (this.inFolder(file.path, settings.areaFolder)) {
            if (!this.areaNames.includes(file.basename)) {
                this.areaNames.push(file.basename)
                this.areaNames.sort((a, b) => a.localeCompare(b))
            }
        }
        else return

        this.scheduleNotify()
    }

    private onFileDeleted(file: TAbstractFile): void {
        if (!(file instanceof TFile)) return
        let touched = this.byPath.delete(file.path)
        if (this.projectPriority.delete(file.basename)) touched = true
        if (touched) this.scheduleNotify()
    }

    private async onFileRenamed(file: TAbstractFile, oldPath: string): Promise<void> {
        this.byPath.delete(oldPath)
        // A renamed quest changes the name every `blocked-by` addresses it by,
        // and a renamed project changes what quests inherit from, so rescan.
        await this.rebuild()
        await this.onFileChanged(file)
    }
}
