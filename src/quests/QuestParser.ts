/**
 * Turns a quest note into a `Quest`.
 *
 * Takes a structural description of the file rather than Obsidian's
 * `CachedMetadata` so the parser stays testable in node. QuestIndex does the
 * adapting.
 */

import { isQuestStatus, type Objective, type Quest, type QuestStatus } from './Quest'

/** Frontmatter keys, all renameable in settings. */
export interface FrontmatterKeys {
    type: string
    status: string
    priority: string
    due: string
    accepted: string
    completed: string
    areas: string
    projects: string
    blockedBy: string
}

export const DEFAULT_KEYS: FrontmatterKeys = {
    type: 'type',
    status: 'status',
    priority: 'priority',
    due: 'due',
    accepted: 'accepted',
    completed: 'completed',
    areas: 'life-areas',
    projects: 'projects',
    blockedBy: 'blocked-by',
}

export interface HeadingRef {
    text: string
    level: number
    /** 0-indexed. */
    line: number
}

export interface ParseInput {
    path: string
    /** File basename, without the extension. */
    title: string
    frontmatter: Record<string, unknown> | undefined
    lines: string[]
    headings: HeadingRef[]
}

export interface ParseOptions {
    keys: FrontmatterKeys
    /**
     * When set, only tasks under a heading with this text count as objectives.
     * Keeps a Log or Review section from inflating the progress meter.
     * Falls back to every task in the note when the heading is absent.
     */
    objectivesHeading: string | null
}

// Group 1: indent + list marker + "[", 2: status char, 3: the text after "] ".
const TASK_RE = /^(\s*[-*+]\s+\[)(.)\]\s?(.*)$/

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** `"[[Note|Alias]]"` and friends all reduce to `Note`. */
export function linkName(raw: string): string {
    let value = raw.trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) value = value.slice(1, -1)
    if (value.startsWith("'") && value.endsWith("'") && value.length > 1) value = value.slice(1, -1)
    value = value.trim()
    const match = value.match(/^\[\[([^\]]+)\]\]$/)
    if (match) value = match[1]
    // Drop an alias, then a heading/block subpath.
    value = value.split('|')[0]
    value = value.split('#')[0]
    return value.trim()
}

/** Frontmatter values arrive as a scalar, a list, or nothing. Normalise to names. */
export function toNames(value: unknown): string[] {
    if (value === null || value === undefined) return []
    const raw = Array.isArray(value) ? value : [value]
    const names: string[] = []
    for (const entry of raw) {
        if (entry === null || entry === undefined) continue
        const name = linkName(String(entry))
        if (name) names.push(name)
    }
    return names
}

export function toDate(value: unknown): string | null {
    if (value === null || value === undefined) return null
    const text = String(value).trim()
    if (!text) return null
    // Obsidian hands back a full timestamp when the YAML value is a date.
    const date = text.slice(0, 10)
    return ISO_DATE_RE.test(date) ? date : null
}

export function toPriority(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

/**
 * The line range a heading owns: everything until the next heading at the
 * same level or shallower. Returns null when the heading is absent.
 */
export function sectionRange(
    headings: HeadingRef[],
    heading: string,
    totalLines: number,
): { start: number; end: number } | null {
    const wanted = heading.trim().toLowerCase()
    const index = headings.findIndex(h => h.text.trim().toLowerCase() === wanted)
    if (index === -1) return null

    const start = headings[index].line + 1
    const level = headings[index].level
    for (let i = index + 1; i < headings.length; i++) {
        if (headings[i].level <= level) return { start, end: headings[i].line }
    }
    return { start, end: totalLines }
}

export function parseObjectives(
    lines: string[],
    headings: HeadingRef[],
    objectivesHeading: string | null,
): Objective[] {
    let start = 0
    let end = lines.length
    if (objectivesHeading) {
        const range = sectionRange(headings, objectivesHeading, lines.length)
        if (range) {
            start = range.start
            end = range.end
        }
    }

    const objectives: Objective[] = []
    for (let line = start; line < end; line++) {
        const match = lines[line].match(TASK_RE)
        if (!match) continue
        objectives.push({
            text: match[3].trim(),
            done: match[2].toLowerCase() === 'x',
            line,
        })
    }
    return objectives
}

/**
 * A note in the quest folder is a quest unless it declares some other `type`.
 * Untyped notes are included so an existing folder doesn't need migrating.
 */
export function looksLikeQuest(
    frontmatter: Record<string, unknown> | undefined,
    keys: FrontmatterKeys,
    typeValue: string,
): boolean {
    const declared = frontmatter?.[keys.type]
    if (declared === null || declared === undefined || declared === '') return true
    return String(declared).trim().toLowerCase() === typeValue.trim().toLowerCase()
}

export function parseQuest(input: ParseInput, options: ParseOptions): Quest {
    const { keys } = options
    const fm = input.frontmatter

    const rawStatus = fm?.[keys.status]
    const status: QuestStatus = isQuestStatus(rawStatus) ? rawStatus : 'available'

    return {
        path: input.path,
        title: input.title,
        status,
        areas: toNames(fm?.[keys.areas]),
        projects: toNames(fm?.[keys.projects]),
        priority: toPriority(fm?.[keys.priority]),
        blockedBy: toNames(fm?.[keys.blockedBy]),
        due: toDate(fm?.[keys.due]),
        accepted: toDate(fm?.[keys.accepted]),
        completed: toDate(fm?.[keys.completed]),
        objectives: parseObjectives(input.lines, input.headings, options.objectivesHeading),
    }
}
