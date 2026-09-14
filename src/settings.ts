import { PluginSettingTab, Setting, type App } from 'obsidian'
import type Questline from './main'
import { DEFAULT_KEYS, type FrontmatterKeys } from './quests/QuestParser'

export { migrateGroupBy, type GroupBy } from './quests/grouping'
import type { GroupBy } from './quests/grouping'

/** What the plugin does the moment a quest's last blocker is sealed. */
export type UnblockBehaviour = 'flag' | 'quiet' | 'activate'

export interface QuestlineSettings {
    questFolder: string
    projectFolder: string
    areaFolder: string
    typeValue: string
    objectivesHeading: string
    keys: FrontmatterKeys
    /** How far out a new quest is dated. 0 means a new quest starts undated. */
    defaultDueDays: number
    /** Frontmatter key holding a project's priority. Foundry capitalises it. */
    projectPriorityKey: string

    defaultGroup: GroupBy
    showComplete: boolean
    autoComplete: boolean

    inheritPriority: boolean
    sortByPriority: boolean

    onUnblock: UnblockBehaviour
    hideBlocked: boolean
    showBlocks: boolean

    neglectWarn: boolean
    neglectDays: number
}

export const DEFAULT_SETTINGS: QuestlineSettings = {
    questFolder: 'Quests',
    projectFolder: 'Projects',
    areaFolder: 'Life Areas',
    typeValue: 'quest',
    objectivesHeading: 'Objectives',
    keys: { ...DEFAULT_KEYS },
    defaultDueDays: 45,
    projectPriorityKey: 'Priority',

    defaultGroup: 'priority',
    showComplete: false,
    autoComplete: true,

    inheritPriority: true,
    sortByPriority: true,

    onUnblock: 'flag',
    hideBlocked: false,
    showBlocks: true,

    neglectWarn: true,
    neglectDays: 30,
}

export class QuestlineSettingTab extends PluginSettingTab {
    private plugin: Questline

    constructor(app: App, plugin: Questline) {
        super(app, plugin)
        this.plugin = plugin
    }

    /** Saves, then rebuilds the index because folders and keys change parsing. */
    private async commit(reindex = false): Promise<void> {
        await this.plugin.saveSettings()
        if (reindex) await this.plugin.index.rebuild()
        else this.plugin.index.notify()
    }

    display(): void {
        const { containerEl } = this
        containerEl.empty()

        new Setting(containerEl).setName('Vault').setHeading()

        new Setting(containerEl)
            .setName('Quest folder')
            .setDesc('Where quest notes live. Anything in here lands on the board unless it declares a different type.')
            .addText(text => text
                .setPlaceholder('Quests')
                .setValue(this.plugin.settings.questFolder)
                .onChange(async value => {
                    this.plugin.settings.questFolder = value.trim()
                    await this.commit(true)
                }))

        new Setting(containerEl)
            .setName('Project folder')
            .setDesc('Searched for the projects quests link to, and for the priority they inherit.')
            .addText(text => text
                .setPlaceholder('Projects')
                .setValue(this.plugin.settings.projectFolder)
                .onChange(async value => {
                    this.plugin.settings.projectFolder = value.trim()
                    await this.commit(true)
                }))

        new Setting(containerEl)
            .setName('Life area folder')
            .setDesc('Listed so the board can flag an area that has gone quiet, even when no quest points at it.')
            .addText(text => text
                .setPlaceholder('Life Areas')
                .setValue(this.plugin.settings.areaFolder)
                .onChange(async value => {
                    this.plugin.settings.areaFolder = value.trim()
                    await this.commit(true)
                }))

        new Setting(containerEl)
            .setName('Objectives heading')
            .setDesc('Only tasks under this heading count as objectives, so a Log or Review section does not inflate the meter. Leave empty to count every task in the note.')
            .addText(text => text
                .setPlaceholder('Objectives')
                .setValue(this.plugin.settings.objectivesHeading)
                .onChange(async value => {
                    this.plugin.settings.objectivesHeading = value.trim()
                    await this.commit(true)
                }))

        this.addKey(containerEl, 'Status property', 'Holds active, held, available or complete.', 'status')
        this.addKey(containerEl, 'Due property', 'Holds the due date.', 'due')
        this.addKey(containerEl, 'Life areas property', 'Links to the life areas a quest serves. The first is the primary.', 'areas')
        this.addKey(containerEl, 'Projects property', 'Links to the projects a quest belongs to.', 'projects')

        new Setting(containerEl).setName('Board').setHeading()

        new Setting(containerEl)
            .setName('Group quests by')
            .setDesc('How the board arranges quests when it opens.')
            .addDropdown(drop => drop
                .addOptions({ priority: 'Priority', status: 'Status', project: 'Project', none: 'No grouping' })
                .setValue(this.plugin.settings.defaultGroup)
                .onChange(async value => {
                    this.plugin.settings.defaultGroup = value as GroupBy
                    await this.commit()
                }))

        new Setting(containerEl)
            .setName('Show completed quests')
            .setDesc('Off, the board is only live work. The Complete filter still reaches sealed quests.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showComplete)
                .onChange(async value => {
                    this.plugin.settings.showComplete = value
                    await this.commit()
                }))

        new Setting(containerEl)
            .setName('Seal a quest when every objective is checked')
            .setDesc('Turn this off if you would rather mark quests complete by hand.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoComplete)
                .onChange(async value => {
                    this.plugin.settings.autoComplete = value
                    await this.commit()
                }))

        new Setting(containerEl).setName('Priority').setHeading()

        this.addKey(containerEl, 'Priority property', "The quest's own priority. Lower is higher.", 'priority')

        new Setting(containerEl)
            .setName('Project priority property')
            .setDesc('The key read from a project note when a quest inherits its priority.')
            .addText(text => text
                .setPlaceholder('Priority')
                .setValue(this.plugin.settings.projectPriorityKey)
                .onChange(async value => {
                    this.plugin.settings.projectPriorityKey = value.trim()
                    await this.commit(true)
                }))

        new Setting(containerEl)
            .setName('Inherit priority from the linked project')
            .setDesc('A quest with no priority of its own takes the first linked project’s. Only an override is ever written to the quest file.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.inheritPriority)
                .onChange(async value => {
                    this.plugin.settings.inheritPriority = value
                    await this.commit()
                }))

        new Setting(containerEl)
            .setName('Sort by priority inside each group')
            .setDesc('Orders by priority, then due date. Quests with no priority sit at the bottom.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.sortByPriority)
                .onChange(async value => {
                    this.plugin.settings.sortByPriority = value
                    await this.commit()
                }))

        new Setting(containerEl).setName('Blocking').setHeading()

        this.addKey(containerEl, 'Blocked-by property', 'Lists the quests that have to finish first. A blocker stops blocking the moment it is sealed.', 'blockedBy')

        new Setting(containerEl)
            .setName('When the last blocker is sealed')
            .setDesc('Flag it as ready puts the quest at the top of the board and leaves its own status alone.')
            .addDropdown(drop => drop
                .addOptions({ flag: 'Flag it as ready', quiet: 'Do nothing', activate: 'Set it to active' })
                .setValue(this.plugin.settings.onUnblock)
                .onChange(async value => {
                    this.plugin.settings.onUnblock = value as UnblockBehaviour
                    await this.commit()
                }))

        new Setting(containerEl)
            .setName('Hide blocked quests from the board')
            .setDesc('Keeps quests waiting on a blocker out of the way.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideBlocked)
                .onChange(async value => {
                    this.plugin.settings.hideBlocked = value
                    await this.commit()
                }))

        new Setting(containerEl)
            .setName('Show what a quest blocks')
            .setDesc('Adds the reciprocal line, so a blocker tells you what is stacked behind it.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showBlocks)
                .onChange(async value => {
                    this.plugin.settings.showBlocks = value
                    await this.commit()
                }))

        new Setting(containerEl)
            .setName('Default due horizon')
            .setDesc('How far out a new quest is dated, in days. The field is still editable at creation; set 0 to start undated.')
            .addText(text => text
                .setPlaceholder('45')
                .setValue(String(this.plugin.settings.defaultDueDays))
                .onChange(async value => {
                    const days = Number(value)
                    if (!Number.isFinite(days) || days < 0) return
                    this.plugin.settings.defaultDueDays = Math.round(days)
                    await this.plugin.saveSettings()
                }))

        new Setting(containerEl).setName('Life areas').setHeading()

        new Setting(containerEl)
            .setName('Warn about neglected life areas')
            .setDesc('Flags a life area on the board when nothing active points at it.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.neglectWarn)
                .onChange(async value => {
                    this.plugin.settings.neglectWarn = value
                    await this.commit()
                }))

        new Setting(containerEl)
            .setName('Neglect threshold')
            .setDesc('How long a life area can sit with no active quest before it is flagged.')
            .addText(text => text
                .setPlaceholder('30')
                .setValue(String(this.plugin.settings.neglectDays))
                .onChange(async value => {
                    const days = Number(value)
                    if (!Number.isFinite(days) || days < 1) return
                    this.plugin.settings.neglectDays = Math.round(days)
                    await this.commit()
                }))
    }

    private addKey(container: HTMLElement, name: string, desc: string, key: keyof FrontmatterKeys): void {
        new Setting(container)
            .setName(name)
            .setDesc(desc)
            .addText(text => text
                .setPlaceholder(DEFAULT_KEYS[key])
                .setValue(this.plugin.settings.keys[key])
                .onChange(async value => {
                    this.plugin.settings.keys[key] = value.trim() || DEFAULT_KEYS[key]
                    await this.commit(true)
                }))
    }
}
