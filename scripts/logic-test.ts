/**
 * Exercises every pure function in src/quests without an Obsidian app.
 * Bundled by esbuild and run in node: `npm test`.
 */

import {
    blockedByThis,
    compareQuests,
    isBlocked,
    isReady,
    progressOf,
    resolvePriority,
    type Quest,
} from '../src/quests/Quest'
import {
    DEFAULT_KEYS,
    linkName,
    looksLikeQuest,
    parseObjectives,
    parseQuest,
    sectionRange,
    toDate,
    toNames,
    toPriority,
} from '../src/quests/QuestParser'
import { applyToggleToLine, buildQuestNote, lineIsDone } from '../src/quests/QuestWriter'

let passed = 0
const failures: string[] = []

function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    if (a === b) passed++
    else failures.push(`${name}\n    expected ${b}\n    actual   ${a}`)
}

function quest(partial: Partial<Quest> & { title: string }): Quest {
    return {
        path: `Quests/${partial.title}.md`,
        status: 'available',
        areas: [],
        projects: [],
        priority: null,
        blockedBy: [],
        due: null,
        accepted: null,
        completed: null,
        objectives: [],
        ...partial,
    }
}

/* ------------------------------------------------------------- frontmatter */

check('linkName strips a wikilink', linkName('"[[Capital]]"'), 'Capital')
check('linkName drops an alias', linkName('[[GemKit Apps|GemKit]]'), 'GemKit Apps')
check('linkName drops a subpath', linkName('[[Bloodless Sky#Brief]]'), 'Bloodless Sky')
check('linkName passes plain text', linkName('Capital'), 'Capital')

check('toNames handles a list', toNames(['"[[Capital]]"', '[[Karma]]']), ['Capital', 'Karma'])
check('toNames handles a scalar', toNames('[[Capital]]'), ['Capital'])
check('toNames handles nothing', toNames(undefined), [])

check('toDate keeps an ISO date', toDate('2026-09-12'), '2026-09-12')
check('toDate trims a timestamp', toDate('2026-09-12T10:00:00.000Z'), '2026-09-12')
check('toDate rejects prose', toDate('soon'), null)

check('toPriority reads a number', toPriority(6), 6)
check('toPriority reads a numeric string', toPriority('10'), 10)
check('toPriority rejects empty', toPriority(''), null)

/* ---------------------------------------------------------------- sections */

const lines = [
    '# Brief',
    'Twenty-minute short.',
    '# Objectives',
    '- [x] Lock the drone sequence',
    '- [ ] Colour pass',
    '# Log',
    '- [ ] not an objective',
]
const headings = [
    { text: 'Brief', level: 1, line: 0 },
    { text: 'Objectives', level: 1, line: 2 },
    { text: 'Log', level: 1, line: 5 },
]

check('sectionRange finds the section', sectionRange(headings, 'Objectives', lines.length), { start: 3, end: 5 })
check('sectionRange is case-insensitive', sectionRange(headings, 'objectives', lines.length), { start: 3, end: 5 })
check('sectionRange misses cleanly', sectionRange(headings, 'Nope', lines.length), null)

check('objectives respect the heading', parseObjectives(lines, headings, 'Objectives').map(o => o.text),
    ['Lock the drone sequence', 'Colour pass'])
check('objectives keep their line numbers', parseObjectives(lines, headings, 'Objectives').map(o => o.line), [3, 4])
check('objectives fall back to the whole note', parseObjectives(lines, headings, null).length, 3)
check('objectives fall back when the heading is absent', parseObjectives(lines, headings, 'Missing').length, 3)

/* ------------------------------------------------------------------ parsing */

const parsed = parseQuest({
    path: 'Quests/Bloodless Sky.md',
    title: 'Bloodless Sky',
    frontmatter: {
        status: 'active',
        'life-areas': ['"[[Capital]]"', '"[[Karma]]"'],
        projects: '"[[Bloodless Sky]]"',
        'blocked-by': ['[[Something Else]]'],
        priority: 6,
        due: '2026-09-18',
    },
    lines,
    headings,
}, { keys: DEFAULT_KEYS, objectivesHeading: 'Objectives' })

check('parse reads status', parsed.status, 'active')
check('parse reads areas', parsed.areas, ['Capital', 'Karma'])
check('parse reads projects', parsed.projects, ['Bloodless Sky'])
check('parse reads blocked-by', parsed.blockedBy, ['Something Else'])
check('parse reads an explicit priority', parsed.priority, 6)
check('parse counts progress', progressOf(parsed), { done: 1, total: 2 })
check('parse defaults an unknown status', parseQuest({
    path: 'x', title: 'x', frontmatter: { status: 'nonsense' }, lines: [], headings: [],
}, { keys: DEFAULT_KEYS, objectivesHeading: null }).status, 'available')

check('untyped notes count as quests', looksLikeQuest({}, DEFAULT_KEYS, 'quest'), true)
check('quest-typed notes count', looksLikeQuest({ type: 'quest' }, DEFAULT_KEYS, 'quest'), true)
check('other types are skipped', looksLikeQuest({ type: 'project' }, DEFAULT_KEYS, 'quest'), false)

/* ----------------------------------------------------------------- priority */

const projects: Record<string, number> = { 'Bloodless Sky': 2, '4 Filmmakers': 10 }
const lookupPriority = (name: string): number | null => projects[name] ?? null

check('own priority wins',
    resolvePriority(quest({ title: 'a', priority: 6, projects: ['4 Filmmakers'] }), lookupPriority),
    { value: 6, inherited: false, from: null })
check('priority inherits from the first project',
    resolvePriority(quest({ title: 'a', projects: ['Bloodless Sky'] }), lookupPriority),
    { value: 2, inherited: true, from: 'Bloodless Sky' })
check('priority skips projects that have none',
    resolvePriority(quest({ title: 'a', projects: ['Nothing', '4 Filmmakers'] }), lookupPriority),
    { value: 10, inherited: true, from: '4 Filmmakers' })
check('inheritance can be turned off',
    resolvePriority(quest({ title: 'a', projects: ['Bloodless Sky'] }), lookupPriority, false),
    { value: null, inherited: false, from: null })

const sortable = [
    quest({ title: 'no priority' }),
    quest({ title: 'p10', priority: 10 }),
    quest({ title: 'p2 late', priority: 2, due: '2026-10-01' }),
    quest({ title: 'p2 soon', priority: 2, due: '2026-09-14' }),
]
check('sort is priority, then due, then title',
    sortable.slice().sort((a, b) => compareQuests(a, b, q => q.priority)).map(q => q.title),
    ['p2 soon', 'p2 late', 'p10', 'no priority'])

/* ----------------------------------------------------------------- blocking */

const locked = quest({ title: 'Locked Picture', status: 'active' })
const sealedBlocker = quest({ title: 'Table Read', status: 'complete', completed: '2026-08-29' })
const kaiju = quest({ title: 'Kaiju', status: 'held', blockedBy: ['Locked Picture'] })
const agora = quest({ title: 'Agora', status: 'available', blockedBy: ['Table Read'] })
const all = [locked, sealedBlocker, kaiju, agora]
const lookup = (title: string): Quest | undefined => all.find(q => q.title === title)

check('an unfinished blocker blocks', isBlocked(kaiju, lookup), true)
check('a sealed blocker does not', isBlocked(agora, lookup), false)
check('ready needs every blocker sealed', isReady(kaiju, lookup), false)
check('ready fires when they are', isReady(agora, lookup), true)
check('an active quest is never ready', isReady(quest({ title: 'x', status: 'active', blockedBy: ['Table Read'] }), lookup), false)
check('a quest with no blockers is never ready', isReady(quest({ title: 'x', status: 'available' }), lookup), false)
check('a missing blocker still blocks', isBlocked(quest({ title: 'x', blockedBy: ['Ghost'] }), lookup), true)
check('reciprocal blocking', blockedByThis(locked, all).map(q => q.title), ['Kaiju'])

/* ------------------------------------------------------------------ writing */

check('toggle checks a box', applyToggleToLine('- [ ] Colour pass', true), '- [x] Colour pass')
check('toggle unchecks a box', applyToggleToLine('- [x] Colour pass', false), '- [ ] Colour pass')
check('toggle keeps indentation', applyToggleToLine('\t- [ ] Nested', true), '\t- [x] Nested')
check('toggle keeps trailing text', applyToggleToLine('- [ ] Pass \u{1F4C5} 2026-09-18', true), '- [x] Pass \u{1F4C5} 2026-09-18')
check('toggle ignores prose', applyToggleToLine('just a line', true), 'just a line')
check('lineIsDone reads the box', [lineIsDone('- [x] a'), lineIsDone('- [ ] a'), lineIsDone('nope')], [true, false, false])

const note = buildQuestNote({
    title: 'Festival Submissions',
    status: 'available',
    areas: ['Capital'],
    projects: ['Bloodless Sky'],
    priority: null,
    due: null,
    accepted: null,
    blockedBy: ['Locked Picture'],
    objectives: ['Shortlist twelve festivals', 'Cut a trailer'],
    brief: 'Twelve submissions after lock.',
}, DEFAULT_KEYS, 'quest', 'Objectives')

check('the new note declares its type', note.includes('type: quest'), true)
check('the new note links its area', note.includes('  - "[[Capital]]"'), true)
check('the new note links its blocker', note.includes('blocked-by:\n  - "[[Locked Picture]]"'), true)
check('an inherited priority is never written', note.includes('priority:'), false)
check('objectives are plain tasks', note.includes('- [ ] Cut a trailer'), true)


/* ------------------------------------------------------------------ periods */

import { addDays, inPeriod, monthsOfYear, parsePeriodName } from '../src/quests/periods'
import { defaultSections, parseQuery } from '../src/views/query'

check('a year note', parsePeriodName('2026'), { kind: 'year', start: '2026-01-01', end: '2026-12-31', label: '2026' })
check('a Foundry month note', parsePeriodName('Sep-2026'),
    { kind: 'month', start: '2026-09-01', end: '2026-09-30', label: 'September 2026' })
check('a numeric month note', parsePeriodName('2026-02'),
    { kind: 'month', start: '2026-02-01', end: '2026-02-28', label: 'February 2026' })
check('a leap February', parsePeriodName('2028-02')?.end, '2028-02-29')
check('a spelled-out month', parsePeriodName('September 2026')?.start, '2026-09-01')
check('an ISO week note', parsePeriodName('2026-W37'),
    { kind: 'week', start: '2026-09-07', end: '2026-09-13', label: '2026-W37' })
check('week 1 crosses the new year', parsePeriodName('2026-W01')?.start, '2025-12-29')
check('a non-periodic note', parsePeriodName('Bloodless Sky'), null)
check('a nonsense month', parsePeriodName('Smarch-2026'), null)
check('a nonsense week', parsePeriodName('2026-W99'), null)

const sep = parsePeriodName('Sep-2026')!
check('inPeriod includes the bounds', [inPeriod('2026-09-01', sep), inPeriod('2026-09-30', sep)], [true, true])
check('inPeriod excludes outside', [inPeriod('2026-08-31', sep), inPeriod('2026-10-01', sep)], [false, false])
check('inPeriod handles no date', inPeriod(null, sep), false)
check('a year has twelve months', monthsOfYear(parsePeriodName('2026')!).length, 12)
check('addDays crosses a month', addDays('2026-09-30', 1), '2026-10-01')

/* -------------------------------------------------------------------- query */

const q = parseQuery('project: this\nstatus: active, held\nshow: objectives\nblocking: true\nhorizon: 10d')
check('query reads project', q.project, 'this')
check('query reads statuses', q.statuses, ['active', 'held'])
check('query reads sections', q.show, ['objectives'])
check('query reads blocking', q.blocking, true)
check('query reads a horizon in days', q.horizon, 10)
check('a clean query has no errors', q.errors, [])

const bad = parseQuery('proejct: this\nstatus: active, nonsense\nshow: objectives, sparkles\nnot a pair')
check('a misspelled key is reported', bad.errors.includes('Unknown option "proejct".'), true)
check('a bad status is reported', bad.errors.includes('Unknown status "nonsense".'), true)
check('a bad section is reported', bad.errors.includes('Unknown section "sparkles".'), true)
check('a line with no colon is reported', bad.errors.length, 4)
check('the valid parts still survive', [bad.statuses, bad.show], [['active'], ['objectives']])

check('comments are skipped', parseQuery('# just a note\nproject: this').errors, [])
check('blocking defaults on', parseQuery('project: this').blocking, true)
check('blocking can be turned off', parseQuery('project: this\nblocking: false').blocking, false)
check('scope is validated', parseQuery('blocking-scope: sideways').errors.length, 1)

check('a week note defaults sensibly', defaultSections('week'), ['due', 'sealed', 'ready'])
check('a year note defaults coarser', defaultSections('year'), ['sealed-by-month', 'life-areas', 'long-running'])
check('a project embed defaults to a list', defaultSections('project'), ['objectives'])

/* ------------------------------------------------------------- area summary */

import { summariseArea } from '../src/quests/Quest'

const areaQuest = (status: string, done: number, open: number): any => ({
    path: 'x', title: 'x', status, areas: [], projects: [], priority: null,
    blockedBy: [], due: null, accepted: null, completed: null,
    objectives: [
        ...Array.from({ length: done }, (_, i) => ({ text: 'd' + i, done: true, line: i })),
        ...Array.from({ length: open }, (_, i) => ({ text: 'o' + i, done: false, line: 100 + i })),
    ],
})

// The reported bug: an area holding only `available` quests read as empty,
// because the strip counted `active` and nothing else.
check('available quests are live, not nothing',
    summariseArea([areaQuest('available', 0, 4), areaQuest('available', 0, 8)]),
    { live: 2, active: 0, done: 0, total: 12 })
check('active is still counted separately',
    summariseArea([areaQuest('active', 1, 3), areaQuest('available', 0, 2)]),
    { live: 2, active: 1, done: 1, total: 6 })
check('held quests count as live', summariseArea([areaQuest('held', 0, 2)]).live, 1)
check('complete quests are excluded entirely',
    summariseArea([areaQuest('complete', 5, 0), areaQuest('available', 0, 3)]),
    { live: 1, active: 0, done: 0, total: 3 })
check('a genuinely empty area', summariseArea([]), { live: 0, active: 0, done: 0, total: 0 })
check('an area of only sealed quests is empty', summariseArea([areaQuest('complete', 2, 0)]).live, 0)

/* ------------------------------------------------------- due dates + cycles */

import { parseDueInput } from '../src/quests/QuestWriter'
import { wouldCycle } from '../src/quests/Quest'

const TODAY = '2026-09-13' // a Sunday

check('an ISO date passes through', parseDueInput('2026-10-01', TODAY), { ok: true, date: '2026-10-01' })
check('an impossible date is refused', parseDueInput('2026-02-30', TODAY).ok, false)
check('a non-leap 29 Feb is refused', parseDueInput('2027-02-29', TODAY).ok, false)
check('empty clears the property', parseDueInput('', TODAY), { ok: true, date: null })
check('none clears too', parseDueInput('none', TODAY), { ok: true, date: null })
check('today', parseDueInput('today', TODAY), { ok: true, date: '2026-09-13' })
check('tomorrow', parseDueInput('tomorrow', TODAY), { ok: true, date: '2026-09-14' })
check('a day offset', parseDueInput('+3d', TODAY), { ok: true, date: '2026-09-16' })
check('an offset without the plus', parseDueInput('10d', TODAY), { ok: true, date: '2026-09-23' })
check('a week offset', parseDueInput('2w', TODAY), { ok: true, date: '2026-09-27' })
check('an offset crossing a month', parseDueInput('+20d', TODAY), { ok: true, date: '2026-10-03' })
check('a weekday means the next one', parseDueInput('friday', TODAY), { ok: true, date: '2026-09-18' })
check('a short weekday works', parseDueInput('fri', TODAY), { ok: true, date: '2026-09-18' })
check('today\'s own weekday means next week', parseDueInput('sunday', TODAY), { ok: true, date: '2026-09-20' })
check('a negative day offset backdates', parseDueInput('-3d', TODAY), { ok: true, date: '2026-09-10' })
check('a negative week offset', parseDueInput('-2w', TODAY), { ok: true, date: '2026-08-30' })
check('yesterday', parseDueInput('yesterday', TODAY), { ok: true, date: '2026-09-12' })
check('backdating across a month boundary', parseDueInput('-20d', TODAY), { ok: true, date: '2026-08-24' })
check('an unsigned offset is still forward', parseDueInput('3d', TODAY), { ok: true, date: '2026-09-16' })
check('an explicit plus is still forward', parseDueInput('+3d', TODAY), { ok: true, date: '2026-09-16' })
check('a lone minus is not an offset', parseDueInput('-d', TODAY).ok, false)
check('gibberish is refused with a reason',
    (parseDueInput('next-ish', TODAY) as { ok: false; reason: string }).reason.includes('Could not read'), true)

const chain: Record<string, string[]> = { A: [], B: ['A'], C: ['B'] }
const look = (t: string): any => (t in chain ? { title: t, blockedBy: chain[t] } : undefined)

check('a quest cannot block itself', wouldCycle('A', 'A', look), true)
check('a direct loop is caught', wouldCycle('A', 'B', look), true)
check('an indirect loop is caught', wouldCycle('A', 'C', look), true)
check('a legitimate blocker is allowed', wouldCycle('C', 'A', look), false)
check('an unknown blocker is allowed', wouldCycle('A', 'Z', look), false)

/* --------------------------------------------------------- effective status */

import { effectiveStatus } from '../src/quests/Quest'

const mk = (title: string, status: string, blockedBy: string[] = []): any => ({
    path: title, title, status, areas: [], projects: [], priority: null,
    blockedBy, due: null, accepted: null, completed: null, objectives: [],
})

const world: Record<string, any> = {
    open: mk('open', 'active'),
    sealed: mk('sealed', 'complete'),
}
const look2 = (t: string): any => world[t]

check('an unblocked quest keeps its own status',
    effectiveStatus(mk('x', 'active'), look2), 'active')
check('an active quest with an open blocker files under blocked',
    effectiveStatus(mk('x', 'active', ['open']), look2), 'blocked')
check('an available quest with an open blocker files under blocked',
    effectiveStatus(mk('x', 'available', ['open']), look2), 'blocked')
check('a held quest with an open blocker files under blocked',
    effectiveStatus(mk('x', 'held', ['open']), look2), 'blocked')
check('a sealed blocker stops blocking',
    effectiveStatus(mk('x', 'active', ['sealed']), look2), 'active')
check('sealing outranks blocking',
    effectiveStatus(mk('x', 'complete', ['open']), look2), 'complete')
check('one open blocker among sealed ones still blocks',
    effectiveStatus(mk('x', 'active', ['sealed', 'open']), look2), 'blocked')
check('a blocker naming no quest still blocks',
    effectiveStatus(mk('x', 'active', ['ghost']), look2), 'blocked')

/* ------------------------------------------------- blocked in codeblock query */

check('the query accepts blocked as a status',
    parseQuery('project: this\nstatus: active, blocked').statuses, ['active', 'blocked'])
check('blocked alone is valid', parseQuery('status: blocked').statuses, ['blocked'])
check('accepting blocked did not loosen validation',
    parseQuery('status: blocked, sideways').errors, ['Unknown status "sideways".'])
check('a blocked-only query keeps the valid part',
    parseQuery('status: blocked, sideways').statuses, ['blocked'])
check('ready is still not a status — it is a section',
    parseQuery('status: ready').errors.length, 1)
check('but show: ready remains valid', parseQuery('show: ready').show, ['ready'])

/* ---------------------------------------------------------------- wikilinks */

import { parseInline } from '../src/quests/inline'

check('text with no link is one run', parseInline('Lock picture'),
    [{ kind: 'text', text: 'Lock picture' }])
check('a bare link', parseInline('[[Bloodless Sky]]'),
    [{ kind: 'link', target: 'Bloodless Sky', display: 'Bloodless Sky' }])
check('a link with surrounding text', parseInline('Send to [[Delphino]] first'),
    [{ kind: 'text', text: 'Send to ' },
     { kind: 'link', target: 'Delphino', display: 'Delphino' },
     { kind: 'text', text: ' first' }])
check('an alias shows the alias', parseInline('[[Bloodless Sky|the feature]]'),
    [{ kind: 'link', target: 'Bloodless Sky', display: 'the feature' }])
check('a subpath reads like Obsidian', parseInline('[[Notes#Act Two]]'),
    [{ kind: 'link', target: 'Notes#Act Two', display: 'Notes > Act Two' }])
check('a subpath with an alias prefers the alias', parseInline('[[Notes#Act Two|act two]]'),
    [{ kind: 'link', target: 'Notes#Act Two', display: 'act two' }])
check('two links do not merge', parseInline('[[A]] and [[B]]'),
    [{ kind: 'link', target: 'A', display: 'A' },
     { kind: 'text', text: ' and ' },
     { kind: 'link', target: 'B', display: 'B' }])
check('an unclosed link stays text', parseInline('Check [[Bloodless Sky'),
    [{ kind: 'text', text: 'Check [[Bloodless Sky' }])
check('empty brackets stay text', parseInline('[[]]'), [{ kind: 'text', text: '[[]]' }])
check('parseInline is not stateful across calls',
    [parseInline('[[A]]').length, parseInline('[[A]]').length], [1, 1])

/* ------------------------------------------------------------ group-by move */

import { migrateGroupBy } from '../src/quests/grouping'

// A vault that saved `area` before the mode was retired must not open the
// board on a grouping that no longer renders anything.
check('the retired area mode lands on priority', migrateGroupBy('area'), 'priority')
check('a surviving mode is left alone', migrateGroupBy('status'), 'status')
check('project survives', migrateGroupBy('project'), 'project')
check('none survives', migrateGroupBy('none'), 'none')
check('priority survives', migrateGroupBy('priority'), 'priority')
check('an unknown mode falls back', migrateGroupBy('sideways'), undefined)
check('a missing setting falls back', migrateGroupBy(undefined), undefined)
check('a non-string falls back', migrateGroupBy(3), undefined)

/* -------------------------------------------------------------------- done */

if (failures.length > 0) {
    console.error(`\n${failures.length} failed, ${passed} passed\n`)
    for (const failure of failures) console.error('  ✗ ' + failure + '\n')
    process.exit(1)
}
console.log(`✓ ${passed} logic checks passed`)
