/**
 * Every write back to the vault.
 *
 * The line- and note-building logic is pure so it can be tested in node; the
 * vault calls at the bottom are thin wrappers around it.
 */

import type { FileManager, TFile, Vault } from 'obsidian'
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
