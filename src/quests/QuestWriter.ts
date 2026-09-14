/**
 * Every write back to the vault.
 *
 * The line- and note-building logic is pure so it can be tested in node; the
 * vault calls at the bottom are thin wrappers around it.
 */

import type { FileManager, TFile, Vault } from 'obsidian'
import { addDays } from './periods'
import type { QuestStatus } from './Quest'
import type { FrontmatterKeys } from './QuestParser'

// Group 1: indent + list marker + "[", 2: status char, 3: everything after "]".
const CHECKBOX_RE = /^(\s*[-*+]\s+\[)(.)\](.*)$/

/**
 * Pure: toggle a single objective line open <-> done.
 *
 * Deliberately does not stamp a completion date on the objective. Quests carry
 * their own `completed` property, and a date on every line would fight
 * whatever the user's task plugin already does.
 */
export function applyToggleToLine(line: string, toComplete: boolean): string {
    const match = line.match(CHECKBOX_RE)
    if (!match) return line
    return `${match[1]}${toComplete ? 'x' : ' '}]${match[3]}`
}

/** True when the line is a task and already checked. */
export function lineIsDone(line: string): boolean {
    const match = line.match(CHECKBOX_RE)
    return match ? match[2].toLowerCase() === 'x' : false
}

export interface NewQuestFields {
    title: string
    status: QuestStatus
    areas: string[]
    projects: string[]
    /** Only written when set. An inherited priority stays out of the file. */
    priority: number | null
    due: string | null
    accepted: string | null
    blockedBy: string[]
    objectives: string[]
    brief: string
}

function yamlLinkList(key: string, names: string[]): string[] {
    if (names.length === 0) return []
    const lines = [`${key}:`]
    for (const name of names) lines.push(`  - "[[${name}]]"`)
    return lines
}

/**
 * Pure: the markdown for a brand new quest note.
 *
 * Objectives are plain `- [ ]` tasks so any other task plugin still sees them.
 */
export function buildQuestNote(
    fields: NewQuestFields,
    keys: FrontmatterKeys,
    typeValue: string,
    objectivesHeading: string,
): string {
    const lines: string[] = ['---', `${keys.type}: ${typeValue}`, `${keys.status}: ${fields.status}`]

    lines.push(...yamlLinkList(keys.areas, fields.areas))
    lines.push(...yamlLinkList(keys.projects, fields.projects))
    lines.push(...yamlLinkList(keys.blockedBy, fields.blockedBy))
    if (fields.priority !== null) lines.push(`${keys.priority}: ${fields.priority}`)
    if (fields.accepted) lines.push(`${keys.accepted}: ${fields.accepted}`)
    if (fields.due) lines.push(`${keys.due}: ${fields.due}`)
    lines.push('---', '')

    lines.push('# Brief', fields.brief.trim(), '')
    lines.push(`# ${objectivesHeading}`)
    if (fields.objectives.length === 0) lines.push('- [ ] ')
    else for (const objective of fields.objectives) lines.push(`- [ ] ${objective}`)
    lines.push('')

    return lines.join('\n')
}

/* ------------------------------------------------------------------ vault */

/** Flip one objective in place, leaving every other byte of the note alone. */
export async function toggleObjective(
    vault: Vault,
    file: TFile,
    line: number,
    toComplete: boolean,
): Promise<void> {
    await vault.process(file, data => {
        const lines = data.split('\n')
        if (line < 0 || line >= lines.length) return data
        lines[line] = applyToggleToLine(lines[line], toComplete)
        return lines.join('\n')
    })
}

/**
 * Set the quest's status, stamping or clearing `completed` to match so the
 * periodic slices always have a date to group by.
 */
export async function setQuestStatus(
    fileManager: FileManager,
    file: TFile,
    status: QuestStatus,
    keys: FrontmatterKeys,
    todayISO: string,
): Promise<void> {
    await fileManager.processFrontMatter(file, frontmatter => {
        frontmatter[keys.status] = status
        if (status === 'complete') frontmatter[keys.completed] = todayISO
        else delete frontmatter[keys.completed]
        if (status === 'active' && !frontmatter[keys.accepted]) frontmatter[keys.accepted] = todayISO
    })
}

/** Writing `null` removes the override so the quest goes back to inheriting. */
export async function setQuestPriority(
    fileManager: FileManager,
    file: TFile,
    priority: number | null,
    keys: FrontmatterKeys,
): Promise<void> {
    await fileManager.processFrontMatter(file, frontmatter => {
        if (priority === null) delete frontmatter[keys.priority]
        else frontmatter[keys.priority] = priority
    })
}

/* --------------------------------------------------------------- due dates */

export type DueParse = { ok: true; date: string | null } | { ok: false; reason: string }

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

function isRealDate(iso: string): boolean {
    const parsed = new Date(iso + 'T00:00:00Z')
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso
}

/**
 * Typing a date should not mean counting days on a calendar. Accepts an ISO
 * date, `+3d` / `2w`, `today`, `tomorrow`, or a weekday name meaning its next
 * occurrence. Empty (or `none`) clears the property.
 *
 * Returns a result rather than throwing so the modal can show the reason.
 */
export function parseDueInput(raw: string, todayISO: string): DueParse {
    const text = raw.trim().toLowerCase()
    if (text === '' || text === 'none' || text === 'clear') return { ok: true, date: null }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return isRealDate(text) ? { ok: true, date: text } : { ok: false, reason: `${text} is not a real date.` }
    }

    if (text === 'today') return { ok: true, date: todayISO }
    if (text === 'tomorrow') return { ok: true, date: addDays(todayISO, 1) }

    const offset = text.match(/^\+?(\d+)\s*(d|day|days|w|week|weeks)$/)
    if (offset) {
        const count = Number(offset[1])
        const days = offset[2].startsWith('w') ? count * 7 : count
        return { ok: true, date: addDays(todayISO, days) }
    }

    const weekday = WEEKDAYS.findIndex(day => day === text || day.slice(0, 3) === text)
    if (weekday !== -1) {
        // getUTCDay: Sunday is 0, so shift to a Monday-first week to match WEEKDAYS.
        const current = (new Date(todayISO + 'T00:00:00Z').getUTCDay() + 6) % 7
        const ahead = (weekday - current + 7) || 7 // never today; "friday" on a Friday means next Friday
        return { ok: true, date: addDays(todayISO, ahead) }
    }

    return { ok: false, reason: `Could not read "${raw.trim()}". Try 2026-10-01, +3d, or friday.` }
}

/** Writing `null` removes the property rather than leaving an empty key behind. */
export async function setQuestDue(
    fileManager: FileManager,
    file: TFile,
    date: string | null,
    keys: FrontmatterKeys,
): Promise<void> {
    await fileManager.processFrontMatter(file, frontmatter => {
        if (date === null) delete frontmatter[keys.due]
        else frontmatter[keys.due] = date
    })
}

/** Blockers are stored as wikilinks so they behave like every other vault link. */
export async function setQuestBlockedBy(
    fileManager: FileManager,
    file: TFile,
    titles: string[],
    keys: FrontmatterKeys,
): Promise<void> {
    await fileManager.processFrontMatter(file, frontmatter => {
        if (titles.length === 0) delete frontmatter[keys.blockedBy]
        else frontmatter[keys.blockedBy] = titles.map(title => `[[${title}]]`)
    })
}
