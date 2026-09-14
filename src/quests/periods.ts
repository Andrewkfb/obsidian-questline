/**
 * Resolving a periodic note to the span of time it covers.
 *
 * `period: this` in a codeblock means "whatever note I am sitting in", so the
 * note's own name is the only input. All date maths is done in UTC to keep a
 * daylight-saving boundary from moving a week.
 */

export type PeriodKind = 'week' | 'month' | 'year'

export interface Period {
    kind: PeriodKind
    /** Inclusive ISO bounds. */
    start: string
    end: string
    /** Canonical name, for the slice header. */
    label: string
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_FULL = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

function utc(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month, day))
}

function iso(date: Date): string {
    return date.toISOString().slice(0, 10)
}

export function monthIndex(name: string): number {
    const wanted = name.trim().toLowerCase()
    const full = MONTHS_FULL.findIndex(month => month.toLowerCase() === wanted)
    if (full !== -1) return full
    return MONTHS_SHORT.findIndex(month => month.toLowerCase() === wanted)
}

/** Monday of ISO week 1, which is the week containing 4 January. */
function isoWeekStart(year: number, week: number): Date {
    const jan4 = utc(year, 0, 4)
    const weekday = (jan4.getUTCDay() + 6) % 7 // Monday = 0
    const week1Monday = new Date(jan4.getTime() - weekday * 86400000)
    return new Date(week1Monday.getTime() + (week - 1) * 7 * 86400000)
}

export function yearPeriod(year: number): Period {
    return { kind: 'year', start: iso(utc(year, 0, 1)), end: iso(utc(year, 11, 31)), label: String(year) }
}

export function monthPeriod(year: number, month: number): Period {
    return {
        kind: 'month',
        start: iso(utc(year, month, 1)),
        // Day 0 of the next month is the last day of this one.
        end: iso(utc(year, month + 1, 0)),
        label: `${MONTHS_FULL[month]} ${year}`,
    }
}

export function weekPeriod(year: number, week: number): Period {
    const start = isoWeekStart(year, week)
    const end = new Date(start.getTime() + 6 * 86400000)
    return {
        kind: 'week',
        start: iso(start),
        end: iso(end),
        label: `${year}-W${String(week).padStart(2, '0')}`,
    }
}

/**
 * Recognises the periodic-note names in use: `2026`, `2026-W37`, `2026-09`,
 * `Sep-2026` and `September 2026`. Returns null for anything else, which is
 * how the codeblock knows to report "this note is not a periodic note".
 */
export function parsePeriodName(name: string): Period | null {
    const text = name.trim()

    let match = text.match(/^(\d{4})$/)
    if (match) return yearPeriod(Number(match[1]))

    match = text.match(/^(\d{4})-W(\d{1,2})$/i)
    if (match) {
        const week = Number(match[2])
        if (week < 1 || week > 53) return null
        return weekPeriod(Number(match[1]), week)
    }

    match = text.match(/^(\d{4})-(\d{2})$/)
    if (match) {
        const month = Number(match[2]) - 1
        if (month < 0 || month > 11) return null
        return monthPeriod(Number(match[1]), month)
    }

    // Foundry writes months as `Sep-2026`; `September 2026` is accepted too.
    match = text.match(/^([A-Za-z]{3,})[-\s](\d{4})$/)
    if (match) {
        const month = monthIndex(match[1])
        if (month === -1) return null
        return monthPeriod(Number(match[2]), month)
    }

    return null
}

/** `2026-10-27` -> `27 Oct`, keeping the year only when it is not this one. */
export function formatShortDate(iso: string, todayISO: string): string {
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match) return iso
    const month = Number(match[2]) - 1
    if (month < 0 || month > 11) return iso
    const day = Number(match[3])
    const short = `${day} ${MONTHS_SHORT[month]}`
    return match[1] === todayISO.slice(0, 4) ? short : `${short} ${match[1]}`
}

export function inPeriod(date: string | null, period: Period): boolean {
    if (!date) return false
    return date >= period.start && date <= period.end
}

/** The twelve months of a year period, for the sealed-by-month chart. */
export function monthsOfYear(period: Period): Period[] {
    const year = Number(period.start.slice(0, 4))
    const months: Period[] = []
    for (let month = 0; month < 12; month++) months.push(monthPeriod(year, month))
    return months
}

/** Inclusive day count between two ISO dates, or null when either is unparseable. */
export function daysBetween(from: string, to: string): number | null {
    const a = Date.parse(from + 'T00:00:00Z')
    const b = Date.parse(to + 'T00:00:00Z')
    if (Number.isNaN(a) || Number.isNaN(b)) return null
    return Math.round((b - a) / 86400000)
}

/** Shifts an ISO date by whole days. Used to widen a period by its horizon. */
export function addDays(date: string, days: number): string {
    const base = Date.parse(date + 'T00:00:00Z')
    if (Number.isNaN(base)) return date
    return iso(new Date(base + days * 86400000))
}
