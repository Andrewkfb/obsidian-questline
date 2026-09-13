# Questline

Quests as the actionable layer over your projects and life areas, for [Obsidian](https://obsidian.md).

A quest is an ordinary note in `Quests/`. It links to the projects it serves and
the life areas it feeds, lists its objectives as plain `- [ ]` tasks, and declares
what has to finish before it can start. The plugin reads those notes and gives you
a board; it never becomes the source of truth.

## What it does today

- **Quest board** — a view grouped by life area, status or project, with search
  and status filters.
- **Objectives** are the note's own tasks. Checking one on the board writes
  straight back to the file, so any other task plugin still sees them.
- **Priority is inherited.** A quest with no `priority` of its own takes the first
  linked project's. An inherited value is never written to the quest file — only
  an override is.
- **`blocked-by` resolves live.** A blocker stops blocking the moment it is sealed.
  A name that resolves to no quest keeps blocking, so a typo can never be read as
  permission to start.
- **Ready** is derived, never stored: every blocker is finished but nobody has
  picked the quest up. It gets a strip at the top of the board, a filter and a
  Start button. Nothing changes status on its own.
- **Neglected life areas** get flagged when nothing active points at them.

## The `questline` codeblock

Scoped to a project, or to a stretch of time resolved from the note it sits in.

In a project note:

    ```questline
    project: this
    status: active, held, available
    show: objectives
    blocking: true
    ```

In a periodic note — `period: this` reads the note's own name, so `2026`,
`Sep-2026`, `2026-09` and `2026-W37` all resolve:

    ```questline
    period: this
    horizon: 10d
    show: due, sealed, ready
    ```

| Option | Values |
| --- | --- |
| `project` | `this`, or a project name |
| `period` | `this`, or `2026` / `Sep-2026` / `2026-09` / `2026-W37` |
| `status` | any of `active`, `held`, `available`, `complete` |
| `show` | `objectives`, `due`, `sealed`, `ready`, `life-areas`, `sealed-by-month`, `long-running` |
| `horizon` | e.g. `10d` — how far past the period's end `due` still reaches |
| `blocking` | `true` / `false` — list quests elsewhere waiting on this one |
| `blocking-scope` | `vault` (default) or `project` |
| `limit` | a positive number |

`show` defaults to the altitude of the note: a week gets `due, sealed, ready`,
a month `sealed, due, life-areas`, a year `sealed-by-month, life-areas,
long-running`. A typo renders a warning inside the block rather than blanking
the note.

## Frontmatter

```yaml
---
type: quest
status: active          # active | held | available | complete
life-areas:
  - "[[Capital]]"
  - "[[Karma]]"
projects:
  - "[[Bloodless Sky]]"
blocked-by:
  - "[[Bloodless Sky — Locked Picture]]"
priority: 6             # omit to inherit from the project
accepted: 2026-08-04
due: 2026-09-18
---

# Brief
Twenty-minute short. Picture locks before the sound house takes it.

# Objectives
- [x] Lock the third-act drone sequence
- [ ] Colour pass on reels 1–2
```

Every key is renameable in settings, including the project note's own priority key
(`Priority` by default, matching how Foundry already ranks projects).

## Development

```bash
npm install
npm run dev      # watch build
npm test         # pure-logic checks, run in node
npm run build    # typecheck + production bundle
```

`npm run deploy` copies `main.js`, `manifest.json` and `styles.css` into
`$VAULT_PLUGIN_DIR`.

## Not built yet

The new-quest modal — today `New quest` writes the note and opens it for editing.
