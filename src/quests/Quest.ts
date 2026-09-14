/**
 * The quest model and every derivation the views need.
 *
 * Everything here is pure — plain data in, plain data out — so
 * `scripts/logic-test.ts` can exercise it in node with no Obsidian app.
 * Anything that touches the vault lives in QuestIndex or QuestWriter.
 */

export type QuestStatus = 'active' | 'held' | 'available' | 'complete'

export const QUEST_STATUSES: QuestStatus[] = ['active', 'held', 'available', 'complete']

export const STATUS_LABELS: Record<QuestStatus, string> = {
    active: 'Active',
    held: 'On hold',
    available: 'Available',
    complete: 'Complete',
}

export function isQuestStatus(value: unknown): value is QuestStatus {
    return typeof value === 'string' && (QUEST_STATUSES as string[]).includes(value)
}

export interface Objective {
    /** Objective text with the `- [ ] ` marker stripped. */
    text: string
    done: boolean
    /** 0-indexed line in the quest note, so the writer can toggle it in place. */
    line: number
}

export interface Quest {
    path: string
    /** File basename. Also how other notes address it in `blocked-by`. */
    title: string
    status: QuestStatus
    /** Life area note names, in declaration order. The first is the primary. */
    areas: string[]
    projects: string[]
    /** Set on the quest itself. `null` means "inherit from the project". */
    priority: number | null
    blockedBy: string[]
    due: string | null
    accepted: string | null
    completed: string | null
    objectives: Objective[]
}

export interface Progress {
    done: number
    total: number
}

export function progressOf(quest: Quest): Progress {
    let done = 0
    for (const objective of quest.objectives) if (objective.done) done++
    return { done, total: quest.objectives.length }
}

export function isSealed(quest: Quest): boolean {
    return quest.status === 'complete'
}

/* ---------------------------------------------------------------- priority */

export interface ResolvedPriority {
    value: number | null
    inherited: boolean
    /** Which project it came from, when inherited. */
    from: string | null
}

/**
 * A quest's own `priority` always wins. Otherwise it takes the first linked
 * project that has one — which is why an inherited value is never written
 * back to the quest file. Only an override lives in frontmatter.
 */
export function resolvePriority(
    quest: Quest,
    projectPriority: (project: string) => number | null,
    inherit = true,
): ResolvedPriority {
    if (quest.priority !== null) return { value: quest.priority, inherited: false, from: null }
    if (!inherit) return { value: null, inherited: false, from: null }
    for (const project of quest.projects) {
        const value = projectPriority(project)
        if (value !== null) return { value, inherited: true, from: project }
    }
    return { value: null, inherited: false, from: null }
}

/**
 * Lower priority sorts first. No priority sinks to the bottom, then earliest
 * due date, then title so the order is stable between renders.
 */
export function compareQuests(
    a: Quest,
    b: Quest,
    priority: (quest: Quest) => number | null,
): number {
    const pa = priority(a)
    const pb = priority(b)
    if (pa === null && pb !== null) return 1
    if (pb === null && pa !== null) return -1
    if (pa !== null && pb !== null && pa !== pb) return pa - pb

    const da = a.due ?? '9999-12-31'
    const db = b.due ?? '9999-12-31'
    if (da !== db) return da < db ? -1 : 1
    return a.title.localeCompare(b.title)
}

/* ---------------------------------------------------------------- blocking */

/** Resolves a `blocked-by` entry to the quest it names, if that quest exists. */
export type QuestLookup = (title: string) => Quest | undefined

export function blockersOf(quest: Quest, lookup: QuestLookup): Quest[] {
    const found: Quest[] = []
    for (const title of quest.blockedBy) {
        const blocker = lookup(title)
        if (blocker) found.push(blocker)
    }
    return found
}

/**
 * Names in `blocked-by` that resolve to no quest at all — a typo, or a quest
 * not written yet. These keep blocking: the user declared a dependency, and
 * failing to find it must never be read as permission to start.
 */
export function unresolvedBlockers(quest: Quest, lookup: QuestLookup): string[] {
    return quest.blockedBy.filter(title => lookup(title) === undefined)
}

/** A blocker only blocks while it is unfinished, so this resolves live. */
export function openBlockers(quest: Quest, lookup: QuestLookup): Quest[] {
    return blockersOf(quest, lookup).filter(blocker => !isSealed(blocker))
}

export function isBlocked(quest: Quest, lookup: QuestLookup): boolean {
    return openBlockers(quest, lookup).length > 0 || unresolvedBlockers(quest, lookup).length > 0
}

/**
 * Derived, never stored: every blocker is finished but nobody has picked the
 * quest up. Deliberately does not change status — surfacing it is the
 * plugin's job, starting it is the user's.
 */
export function isReady(quest: Quest, lookup: QuestLookup): boolean {
    if (quest.status !== 'held' && quest.status !== 'available') return false
    if (quest.blockedBy.length === 0) return false
    return !isBlocked(quest, lookup)
}

export interface AreaSummary {
    /** Everything unfinished. The honest headline number for an area. */
    live: number
    active: number
    done: number
    total: number
}

/**
 * What a life area actually holds.
 *
 * `live` leads rather than `active` on purpose: `available` is the status every
 * quest starts in, so counting only `active` reports a freshly-filled area as
 * empty and reads as though the area were never linked at all.
 */
export function summariseArea(quests: Quest[]): AreaSummary {
    let live = 0
    let active = 0
    let done = 0
    let total = 0
    for (const quest of quests) {
        if (isSealed(quest)) continue
        live++
        if (quest.status === 'active') active++
        const progress = progressOf(quest)
        done += progress.done
        total += progress.total
    }
    return { live, active, done, total }
}

/** The reciprocal of `blocked-by`: what is stacked behind this quest. */
export function blockedByThis(quest: Quest, all: Quest[]): Quest[] {
    return all.filter(other => other.blockedBy.includes(quest.title))
}

/**
 * Would making `blockerTitle` block `questTitle` create a loop?
 *
 * Every derivation here is single-level, so a cycle does not hang anything —
 * it does something worse and quieter: both quests wait on each other and
 * neither is ever ready, with nothing on screen saying why.
 */
export function wouldCycle(questTitle: string, blockerTitle: string, lookup: QuestLookup): boolean {
    if (questTitle === blockerTitle) return true

    const seen = new Set<string>()
    const stack = [blockerTitle]
    while (stack.length > 0) {
        const current = stack.pop() as string
        if (current === questTitle) return true
        if (seen.has(current)) continue
        seen.add(current)
        const quest = lookup(current)
        if (quest) stack.push(...quest.blockedBy)
    }
    return false
}

export type BoardStatus = QuestStatus | 'blocked'

export const BOARD_STATUSES: BoardStatus[] = [...QUEST_STATUSES, 'blocked']

export const BOARD_STATUS_LABELS: Record<BoardStatus, string> = {
    ...STATUS_LABELS,
    blocked: 'Blocked',
}

/**
 * What the board files a quest under, which is not always what its frontmatter
 * says.
 *
 * Blocking outranks the declared status. A quest marked `active` that is still
 * waiting on something is not work you can pick up, and listing it under Active
 * beside things you can actually start makes the board lie about what is
 * available to do — the one question the board exists to answer.
 *
 * Sealing outranks blocking, because a finished quest is finished whatever it
 * once waited on. Without that, completing a quest whose blocker is still open
 * would file it under Blocked forever.
 */
export function effectiveStatus(quest: Quest, lookup: QuestLookup): BoardStatus {
    if (isSealed(quest)) return 'complete'
    if (isBlocked(quest, lookup)) return 'blocked'
    return quest.status
}
