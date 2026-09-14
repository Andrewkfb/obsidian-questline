/**
 * The `questline` codeblock language.
 *
 *     ```questline
 *     project: this
 *     status: active, held, available
 *     show: objectives
 *     blocking: true
 *     ```
 *
 * Pure, so `npm test` covers it. Unknown keys are collected rather than thrown:
 * a typo should render a warning inside the block, not blank the note.
 */

import { BOARD_STATUSES, type BoardStatus } from '../quests/Quest'

export type Section =
    | 'objectives'
    | 'due'
    | 'sealed'
    | 'ready'
    | 'life-areas'
    | 'sealed-by-month'
    | 'long-running'

const SECTIONS: Section[] = ['objectives', 'due', 'sealed', 'ready', 'life-areas', 'sealed-by-month', 'long-running']

export type BlockingScope = 'vault' | 'project'

export interface QuestQuery {
    /** `this` is left as-is here; the renderer resolves it against the host note. */
    project: string | null
    period: string | null
    /**
     * Matched against a quest's effective status, not its frontmatter, so
     * `blocked` is a value here even though it can never be one in a note.
     */
    statuses: BoardStatus[] | null
    show: Section[] | null
    /** Days past the end of a period that `due` still reaches. */
    horizon: number
    blocking: boolean
    blockingScope: BlockingScope
    limit: number | null
    errors: string[]
}

export const DEFAULT_QUERY: QuestQuery = {
    project: null,
    period: null,
    statuses: null,
    show: null,
    horizon: 0,
    blocking: true,
    blockingScope: 'vault',
    limit: null,
    errors: [],
}

function toBoolean(value: string): boolean {
    const text = value.trim().toLowerCase()
    return text === 'true' || text === 'yes' || text === 'on' || text === '1'
}

function toList(value: string): string[] {
    return value.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)
}

export function parseQuery(source: string): QuestQuery {
    const query: QuestQuery = { ...DEFAULT_QUERY, errors: [] }

    for (const raw of source.split('\n')) {
        const line = raw.trim()
        if (!line || line.startsWith('#') || line.startsWith('//')) continue

        const split = line.indexOf(':')
        if (split === -1) {
            query.errors.push(`Could not read "${line}" — every line is key: value.`)
            continue
        }

        const key = line.slice(0, split).trim().toLowerCase()
        const value = line.slice(split + 1).trim()

        switch (key) {
            case 'project':
                query.project = value || null
                break

            case 'period':
                query.period = value || null
                break

            case 'status': {
                const wanted = toList(value.toLowerCase())
                const valid = wanted.filter(status => (BOARD_STATUSES as string[]).includes(status)) as BoardStatus[]
                for (const status of wanted) {
                    if (!(BOARD_STATUSES as string[]).includes(status)) {
                        query.errors.push(`Unknown status "${status}".`)
                    }
                }
                query.statuses = valid.length > 0 ? valid : null
                break
            }

            case 'show': {
                const wanted = toList(value.toLowerCase())
                const valid = wanted.filter(section => (SECTIONS as string[]).includes(section)) as Section[]
                for (const section of wanted) {
                    if (!(SECTIONS as string[]).includes(section)) {
                        query.errors.push(`Unknown section "${section}".`)
                    }
                }
                query.show = valid.length > 0 ? valid : null
                break
            }

            case 'horizon': {
                const days = Number(value.replace(/d(ays)?$/i, '').trim())
                if (Number.isFinite(days) && days >= 0) query.horizon = Math.round(days)
                else query.errors.push(`Could not read horizon "${value}". Try 10d.`)
                break
            }

            case 'blocking':
                query.blocking = toBoolean(value)
                break

            case 'blocking-scope':
                if (value === 'vault' || value === 'project') query.blockingScope = value
                else query.errors.push(`blocking-scope is vault or project, not "${value}".`)
                break

            case 'limit': {
                const limit = Number(value)
                if (Number.isFinite(limit) && limit > 0) query.limit = Math.round(limit)
                else query.errors.push(`Could not read limit "${value}".`)
                break
            }

            default:
                query.errors.push(`Unknown option "${key}".`)
        }
    }

    return query
}

/**
 * What a block shows when it does not say. A project embed is a quest list; a
 * periodic note wants a different altitude depending on how long it is.
 */
export function defaultSections(kind: 'project' | 'week' | 'month' | 'year' | 'vault'): Section[] {
    switch (kind) {
        case 'week': return ['due', 'sealed', 'ready']
        case 'month': return ['sealed', 'due', 'life-areas']
        case 'year': return ['sealed-by-month', 'life-areas', 'long-running']
        default: return ['objectives']
    }
}
