/**
 * The two properties you cannot sensibly type by hand.
 *
 * A due date wants shorthand (`+3d`, `friday`) rather than counting squares on
 * a calendar, and a blocker wants to be picked from the quests that exist so a
 * typo cannot invent a dependency that never resolves.
 */

import { Modal, Notice, SuggestModal, Setting, type TFile } from 'obsidian'
import type Questline from '../main'
import { wouldCycle, type Quest } from '../quests/Quest'
import { parseDueInput, setQuestBlockedBy, setQuestDue } from '../quests/QuestWriter'

export class DueModal extends Modal {
    private plugin: Questline
    private quest: Quest
    private file: TFile
    private input: HTMLInputElement | null = null

    constructor(plugin: Questline, quest: Quest, file: TFile) {
        super(plugin.app)
        this.plugin = plugin
        this.quest = quest
        this.file = file
    }

    onOpen(): void {
        this.titleEl.setText(`Due date — ${this.quest.title}`)

        new Setting(this.contentEl)
            .setName('Due')
            .setDesc('2026-10-01, an offset like +3d or -2w, today, tomorrow, yesterday, or a weekday. Leave empty to clear it.')
            .addText(text => {
                text.setPlaceholder('+3d').setValue(this.quest.due ?? '')
                this.input = text.inputEl
                text.inputEl.addEventListener('keydown', event => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    void this.commit(text.getValue())
                })
            })

        new Setting(this.contentEl)
            .addButton(button => button
                .setButtonText('Clear')
                .onClick(() => void this.apply(null)))
            .addButton(button => button
                .setButtonText('Save')
                .setCta()
                .onClick(() => void this.commit(this.input?.value ?? '')))

        window.setTimeout(() => this.input?.focus(), 0)
    }

    onClose(): void {
        this.contentEl.empty()
    }

    private async commit(raw: string): Promise<void> {
        const result = parseDueInput(raw, this.plugin.todayISO())
        if (!result.ok) {
            new Notice(result.reason)
            return
        }
        await this.apply(result.date)
    }

    private async apply(date: string | null): Promise<void> {
        await setQuestDue(this.app.fileManager, this.file, date, this.plugin.settings.keys)
        new Notice(date ? `${this.quest.title} due ${date}` : `Due date cleared`)
        this.close()
    }
}

type Choice =
    | { kind: 'add'; title: string }
    | { kind: 'remove'; title: string }
    | { kind: 'clear' }

function choiceLabel(choice: Choice): string {
    if (choice.kind === 'clear') return 'Clear all blockers'
    return choice.title
}

export class BlockerModal extends SuggestModal<Choice> {
    private plugin: Questline
    private quest: Quest
    private file: TFile

    constructor(plugin: Questline, quest: Quest, file: TFile) {
        super(plugin.app)
        this.plugin = plugin
        this.quest = quest
        this.file = file
        this.setPlaceholder('Which quest has to finish first?')
    }

    getSuggestions(query: string): Choice[] {
        const needle = query.toLowerCase()
        const current = this.quest.blockedBy
        const choices: Choice[] = []

        if (current.length > 0) choices.push({ kind: 'clear' })
        // Existing blockers first, including any whose note has gone missing —
        // a dangling name still blocks, so it has to be removable.
        for (const title of current) choices.push({ kind: 'remove', title })
        for (const other of this.plugin.index.all()) {
            if (other.title === this.quest.title) continue
            if (current.includes(other.title)) continue
            choices.push({ kind: 'add', title: other.title })
        }

        return choices.filter(choice => choiceLabel(choice).toLowerCase().includes(needle))
    }

    renderSuggestion(choice: Choice, el: HTMLElement): void {
        el.addClass('ql-blocker-suggestion')
        if (choice.kind === 'clear') {
            el.createDiv({ text: 'Clear all blockers' })
            el.createEl('small', { text: `${this.quest.blockedBy.length} currently set`, cls: 'ql-suggestion-note' })
            return
        }

        el.createDiv({ text: choice.title })
        if (choice.kind === 'remove') {
            const known = this.plugin.index.lookup(choice.title)
            el.createEl('small', {
                cls: 'ql-suggestion-note',
                text: known ? 'Remove this blocker' : 'Remove — no note by this name',
            })
            return
        }

        const blocker = this.plugin.index.lookup(choice.title)
        el.createEl('small', {
            cls: 'ql-suggestion-note',
            text: blocker ? `Add as blocker · ${blocker.status}` : 'Add as blocker',
        })
    }

    onChooseSuggestion(choice: Choice): void {
        void this.apply(choice)
    }

    private async apply(choice: Choice): Promise<void> {
        let next: string[]

        if (choice.kind === 'clear') {
            next = []
        } else if (choice.kind === 'remove') {
            next = this.quest.blockedBy.filter(title => title !== choice.title)
        } else {
            if (wouldCycle(this.quest.title, choice.title, this.plugin.index.lookup)) {
                new Notice(`${choice.title} already waits on ${this.quest.title}. Both would block forever.`)
                return
            }
            next = [...this.quest.blockedBy, choice.title]
        }

        await setQuestBlockedBy(this.app.fileManager, this.file, next, this.plugin.settings.keys)

        if (choice.kind === 'clear') new Notice(`${this.quest.title} is no longer blocked`)
        else if (choice.kind === 'remove') new Notice(`Removed ${choice.title} as a blocker`)
        else new Notice(`${this.quest.title} now waits on ${choice.title}`)
    }
}
