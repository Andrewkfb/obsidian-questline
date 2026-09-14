# The quest note contract

What Questline reads, and what it derives. Anything that writes quest notes —
the plugin's own creation modal, a vault skill, you by hand — writes this.

The plugin's `buildQuestNote()` in `src/quests/QuestWriter.ts` is the reference
implementation. If this document and that function disagree, the function is
right and this document is stale; say so rather than guessing.

## Where a quest lives

A quest is one note in `Quests/` (the `questFolder` setting). It is read as a
quest when its `type` is `quest`, or when it has no `type` at all. A note in
that folder with a different `type` is ignored.

Quests are addressed by **basename** in `blocked-by`, so two quests sharing a
title are ambiguous. Keep titles unique.

## Frontmatter

Every key below is configurable in plugin settings, under the defaults shown.
Settings live in `.obsidian/plugins/questline/data.json` — absent until a
setting is changed, in which case these defaults are in force.

| Key | Value | Notes |
| --- | --- | --- |
| `type` | `quest` | Or omit entirely. |
| `status` | `active`, `held`, `available`, `complete` | Nothing else. See *Derived* below. |
| `life-areas` | list of `"[[Name]]"` | Must match a note basename in `Life Areas/`. The first is primary. |
| `projects` | list of `"[[Name]]"` | The first one supplies inherited priority. |
| `due` | `YYYY-MM-DD` | Omit for no due date. |
| `accepted` | `YYYY-MM-DD` | Stamped when a quest goes active. |
| `completed` | `YYYY-MM-DD` | Stamped when a quest is sealed. |
| `blocked-by` | list of `"[[Quest title]]"` | Must name a quest that exists. See below. |
| `priority` | number | **An override.** Omit to inherit. See below. |

## Body

```markdown
# Brief
One or two sentences.

# Objectives
- [ ] Something concrete
- [ ] Something else
```

Objectives are plain tasks so other task plugins still see them. When the
`Objectives` heading is present only tasks beneath it count toward progress;
when it is absent **every** task in the note counts, so a Notes or Log section
with checkboxes will inflate the meter.

## Derived — never write these

The plugin computes these. Writing them either does nothing or does damage.

- **`blocked`** is not a status. It is derived: a quest is blocked while any
  `blocked-by` entry is unsealed, and blocking outranks the declared status
  everywhere the board sorts. The parser refuses `status: blocked` and falls
  back to the default, so writing it silently loses the real status.
- **Ready** is derived: every blocker sealed, nobody has started it. It is
  never stored, and nothing changes status on its own.
- **Inherited priority** is derived from the first linked project's `Priority`.
  Writing `priority` on the quest is a permanent override that stops tracking
  the project. Only write it when the quest genuinely differs from its project.

## Two rules that bite

**A `blocked-by` entry that resolves to no quest still blocks.** This is
deliberate: failing to find a declared dependency is not evidence the
dependency is met. The consequence is that a mistyped or guessed blocker name
parks a quest in Blocked indefinitely, flagged in red as *no note by this
name*. Verify the target exists in `Quests/` before writing it.

**Life-area names are matched literally against note basenames.** A name that
does not resolve produces an unresolved link and the quest silently drops out
of that area's counts — it does not error. Read `Life Areas/` and match what is
there rather than spelling from memory.

## Worked example

```markdown
---
type: quest
status: available
life-areas:
  - "[[Capital]]"
  - "[[Karma]]"
projects:
  - "[[Bloodless Sky]]"
due: 2026-10-27
---

# Brief
Get the picture locked so the festival window is reachable.

# Objectives
- [ ] Lock reel one
- [ ] Clear the temp score
```

No `priority` (it inherits Bloodless Sky's). No `blocked-by` (nothing is
blocking it). No `accepted` or `completed` (it has not started or finished).
