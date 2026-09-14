/**
 * How the board arranges quests.
 *
 * Kept out of settings.ts, which imports from obsidian and so cannot be
 * reached by the node test bundle. Grouping is a decision worth testing.
 */

export type GroupBy = 'priority' | 'status' | 'project' | 'none'

export const GROUP_BY_VALUES: GroupBy[] = ['priority', 'status', 'project', 'none']

/** Modes that existed once and no longer do, mapped to the closest survivor. */
const RETIRED_GROUPS: Record<string, GroupBy> = {
    // Life areas still lead the board as a summary strip; what they stopped
    // being is a way to slice the list. Priority answers the question that
    // grouping is for — what to do next — which area never did.
    area: 'priority',
}

/**
 * Keeps a saved setting from pointing at a mode that has been removed.
 * Returns undefined when there is nothing sensible to carry forward, so the
 * caller falls back to its own default.
 */
export function migrateGroupBy(saved: unknown): GroupBy | undefined {
    if (typeof saved !== 'string') return undefined
    if (saved in RETIRED_GROUPS) return RETIRED_GROUPS[saved]
    return (GROUP_BY_VALUES as string[]).includes(saved) ? (saved as GroupBy) : undefined
}
