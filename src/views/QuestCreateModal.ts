/**
 * The form a new quest is born from.
 *
 * A quest created without a due date tends to stay undated forever, so the
 * field arrives pre-filled with the default horizon rather than empty. It is
 * still a text box: clearing it is one keystroke, which is the point — the
 * default is a starting position, not a policy being enforced.
 */

import { Modal, Notice, Setting, SuggestModal } from 'obsidian'
import type Questline from '../main'
import type { Quest, QuestStatus } from '../quests/Quest'
import { parseDueInput, type NewQuestFields } from '../quests/QuestWriter'

class QuestPicker extends SuggestModal<Quest> {
    private plugin: Questline
    private onPick: (quest: Quest) => void
    private exclude: string[]

    constructor(plugin: Questline, exclude: string[], onPick: (quest: Quest) => void) {
        super(plugin.app)
        this.plugin = plugin
        this.exclude = exclude
        this.onPick = onPick
        this.setPlaceholder('Which quest has to finish first?')
    }

    getSuggestions(query: string): Quest[] {
        const needle = query.toLowerCase()
        return this.plugin.index.all()
            .filter(quest => !this.exclude.includes(quest.title))
            .filter(quest => quest.title.toLowerCase().includes(needle))
    }

    renderSuggestion(quest: Quest, el: HTMLElement): void {
        el.addClass('ql-blocker-suggestion')
        el.createDiv({ text: quest.title })
        el.createEl('small', { cls: 'ql-suggestion-note', text: quest.status })
    }

    onChooseSuggestion(quest: Quest): void {
        this.onPick(quest)
    }
}

export class QuestCreateModal extends Modal {
    private plugin: Questline
    private fields: NewQuestFields
    private dueRaw: string
    private onSubmit: (fields: NewQuestFields) => void
    private blockerList: HTMLElement | null = null

    constructor(plugin: Questline, seed: NewQuestFields, onSubmit: (fields: NewQuestFields) => void) {
        super(plugin.app)
        this.plugin = plugin
        this.fields = { ...seed, areas: [...seed.areas], projects: [...seed.projects], blockedBy: [...seed.blockedBy] }
        this.dueRaw = seed.due ?? ''
        this.onSubmit = onSubmit
    }

    onOpen(): void {
        this.titleEl.setText('New quest')
        const content = this.contentEl
        content.addClass('ql-create-modal')

        new Setting(content)
            .setName('Title')
            .addText(text => {
                text.setValue(this.fields.title).onChange(value => { this.fields.title = value })
                window.setTimeout(() => {
                    text.inputEl.focus()
                    text.inputEl.select()
                }, 0)
            })

        new Setting(content)
            .setName('Status')
            .addDropdown(drop => {
                drop.addOption('available', 'Available')
                drop.addOption('active', 'Active')
                drop.addOption('held', 'On hold')
                drop.setValue(this.fields.status)
                drop.onChange(value => { this.fields.status = value as QuestStatus })
            })

        const areaSetting = new Setting(content)
            .setName('Life areas')
            .setDesc('What this feeds. The first one selected is the primary.')
        const chipset = areaSetting.controlEl.createDiv('ql-chipset')
        for (const area of this.plugin.index.areas()) {
            const chip = chipset.createEl('button', { cls: 'ql-chip', text: area })
            chip.dataset.area = area
            const sync = (): void => chip.toggleClass('is-on', this.fields.areas.includes(area))
            sync()
            chip.addEventListener('click', () => {
                const at = this.fields.areas.indexOf(area)
                if (at === -1) this.fields.areas.push(area)
                else this.fields.areas.splice(at, 1)
                sync()
            })
        }

        new Setting(content)
            .setName('Projects')
            .setDesc('Comma separated. A quest inherits its priority from the first one.')
            .addText(text => text
                .setPlaceholder('Bloodless Sky')
                .setValue(this.fields.projects.join(', '))
                .onChange(value => {
                    this.fields.projects = value.split(',').map(part => part.trim()).filter(part => part.length > 0)
                }))

        new Setting(content)
            .setName('Due')
            .setDesc(`Defaults to ${this.plugin.settings.defaultDueDays} days out. An ISO date, +3d, friday, or empty for none.`)
            .addText(text => text
                .setPlaceholder('+45d')
                .setValue(this.dueRaw)
                .onChange(value => { this.dueRaw = value }))

        const blockerSetting = new Setting(content)
            .setName('Blocked by')
            .setDesc('Nothing by default. A blocker stops blocking the moment it is sealed.')
        blockerSetting.addButton(button => button
            .setButtonText('Add')
            .onClick(() => {
                new QuestPicker(this.plugin, this.fields.blockedBy, quest => {
                    this.fields.blockedBy.push(quest.title)
                    this.renderBlockers()
                }).open()
            }))
        this.blockerList = content.createDiv('ql-blocker-list')
        this.renderBlockers()

        new Setting(content)
            .setName('Objectives')
            .setDesc('One per line. Written as plain tasks so other plugins still see them.')
            .addTextArea(area => {
                area.setPlaceholder('Lock picture\nClear the score')
                area.inputEl.rows = 4
                area.onChange(value => {
                    this.fields.objectives = value.split('\n').map(line => line.trim()).filter(line => line.length > 0)
                })
            })

        new Setting(content)
            .setName('Brief')
            .addTextArea(area => {
                area.inputEl.rows = 2
                area.onChange(value => { this.fields.brief = value })
            })

        new Setting(content)
            .addButton(button => button.setButtonText('Cancel').onClick(() => this.close()))
            .addButton(button => button.setButtonText('Create').setCta().onClick(() => this.submit()))
    }

    onClose(): void {
        this.contentEl.empty()
    }

    private renderBlockers(): void {
        const list = this.blockerList
        if (!list) return
        list.empty()
        if (this.fields.blockedBy.length === 0) {
            list.createSpan({ cls: 'ql-suggestion-note', text: 'Nothing is blocking this quest.' })
            return
        }
        for (const title of this.fields.blockedBy) {
            const chip = list.createSpan({ cls: 'ql-chip is-on', text: title })
            const remove = chip.createEl('button', { cls: 'ql-chip-x', text: '×' })
            remove.setAttribute('aria-label', `Remove ${title}`)
            remove.addEventListener('click', () => {
                this.fields.blockedBy = this.fields.blockedBy.filter(other => other !== title)
                this.renderBlockers()
            })
        }
    }

    private submit(): void {
        const title = this.fields.title.trim()
        if (!title) {
            new Notice('A quest needs a title.')
            return
        }

        const due = parseDueInput(this.dueRaw, this.plugin.todayISO())
        if (!due.ok) {
            new Notice(due.reason)
            return
        }

        this.close()
        this.onSubmit({ ...this.fields, title, due: due.date })
    }
}
