import { App, PluginSettingTab, Setting } from 'obsidian';
import DragNDropPlugin from './main';
import { t } from './i18n';
import type {
    DragNDropSettings,
    DragSourceVisualStyle,
    HandleIconStyle,
    HandleVisibilityMode,
} from './shared/types/settings-types';

export type {
    DragNDropSettings,
    DragSourceVisualStyle,
    HandleIconStyle,
    HandleVisibilityMode,
} from './shared/types/settings-types';

export const DEFAULT_SETTINGS: DragNDropSettings = {
    handleColorMode: 'theme',
    handleColor: '#8a8a8a',
    handleVisibility: 'hover',
    handleIcon: 'dot',
    handleSize: 16,
    indicatorColorMode: 'theme',
    indicatorColor: '#7a7a7a',
    enableCrossFileDrag: false,
    enableMultiLineSelection: true,
    enableMobileTextLongPressDrag: true,
    enableDragSourceHighlight: true,
    enableListDropHighlight: true,
    dragSourceVisualStyle: 'subtle',
    handleHorizontalOffsetPx: 0,
    alignHandleToLineNumber: true,
};

export function normalizeDragSourceVisualStyle(value: unknown): DragSourceVisualStyle {
    if (value === 'outline' || value === 'subtle' || value === 'filled') {
        return value;
    }
    // Legacy migration: old "none" is mapped to minimal-but-on style.
    if (value === 'none') {
        return 'outline';
    }
    return 'subtle';
}

export class DragNDropSettingTab extends PluginSettingTab {
    plugin: DragNDropPlugin;

    constructor(app: App, plugin: DragNDropPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        const i = t();

        new Setting(containerEl).setName(i.headingAppearance).setHeading();

        const colorSetting = new Setting(containerEl)
            .setName(i.handleColor)
            .setDesc(i.handleColorDesc);

        colorSetting.addDropdown(dropdown => dropdown
            .addOption('theme', i.optionTheme)
            .addOption('custom', i.optionCustom)
            .setValue(this.plugin.settings.handleColorMode)
            .onChange(async (value: 'theme' | 'custom') => {
                this.plugin.settings.handleColorMode = value;
                await this.plugin.saveSettings();
            }));

        colorSetting.addColorPicker(picker => picker
            .setValue(this.plugin.settings.handleColor)
            .onChange(async (value) => {
                this.plugin.settings.handleColor = value;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName(i.handleVisibility)
            .setDesc(i.handleVisibilityDesc)
            .addDropdown(dropdown => dropdown
                .addOption('hover', i.optionHover)
                .addOption('always', i.optionAlways)
                .addOption('hidden', i.optionHidden)
                .setValue(this.plugin.settings.handleVisibility)
                .onChange(async (value: HandleVisibilityMode) => {
                    this.plugin.settings.handleVisibility = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.dragSourceVisualStyle)
            .setDesc(i.dragSourceVisualStyleDesc)
            .addDropdown(dropdown => dropdown
                .addOption('outline', i.optionDragSourceVisualOutline)
                .addOption('subtle', i.optionDragSourceVisualSubtle)
                .addOption('filled', i.optionDragSourceVisualFilled)
                .setValue(this.plugin.settings.dragSourceVisualStyle)
                .onChange(async (value: DragSourceVisualStyle) => {
                    this.plugin.settings.dragSourceVisualStyle = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.enableDragSourceHighlight)
            .setDesc(i.enableDragSourceHighlightDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDragSourceHighlight)
                .onChange(async (value) => {
                    this.plugin.settings.enableDragSourceHighlight = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.enableListDropHighlight)
            .setDesc(i.enableListDropHighlightDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableListDropHighlight)
                .onChange(async (value) => {
                    this.plugin.settings.enableListDropHighlight = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.handleIcon)
            .setDesc(i.handleIconDesc)
            .addDropdown(dropdown => dropdown
                .addOption('dot', i.iconDot)
                .addOption('grip-dots', i.iconGripDots)
                .addOption('grip-lines', i.iconGripLines)
                .addOption('square', i.iconSquare)
                .setValue(this.plugin.settings.handleIcon)
                .onChange(async (value: HandleIconStyle) => {
                    this.plugin.settings.handleIcon = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.handleSize)
            .setDesc(i.handleSizeDesc)
            .addSlider((slider) => slider
                .setLimits(12, 28, 2)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.handleSize)
                .onChange(async (value) => {
                    this.plugin.settings.handleSize = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.handleOffset)
            .setDesc(i.handleOffsetDesc)
            .addSlider((slider) => slider
                .setLimits(-80, 80, 1)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.handleHorizontalOffsetPx)
                .onChange(async (value) => {
                    this.plugin.settings.handleHorizontalOffsetPx = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.alignHandleToLineNumber)
            .setDesc(i.alignHandleToLineNumberDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.alignHandleToLineNumber)
                .onChange(async (value) => {
                    this.plugin.settings.alignHandleToLineNumber = value;
                    await this.plugin.saveSettings();
                }));

        const indicatorSetting = new Setting(containerEl)
            .setName(i.indicatorColor)
            .setDesc(i.indicatorColorDesc);

        indicatorSetting.addDropdown(dropdown => dropdown
            .addOption('theme', i.optionTheme)
            .addOption('custom', i.optionCustom)
            .setValue(this.plugin.settings.indicatorColorMode)
            .onChange(async (value: 'theme' | 'custom') => {
                this.plugin.settings.indicatorColorMode = value;
                await this.plugin.saveSettings();
            }));

        indicatorSetting.addColorPicker(picker => picker
            .setValue(this.plugin.settings.indicatorColor)
            .onChange(async (value) => {
                this.plugin.settings.indicatorColor = value;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl).setName(i.headingBehavior).setHeading();
        new Setting(containerEl)
            .setName(i.multiLineSelection)
            .setDesc(i.multiLineSelectionDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMultiLineSelection)
                .onChange(async (value) => {
                    this.plugin.settings.enableMultiLineSelection = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.mobileTextLongPressDrag)
            .setDesc(i.mobileTextLongPressDragDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMobileTextLongPressDrag)
                .onChange(async (value) => {
                    this.plugin.settings.enableMobileTextLongPressDrag = value;
                    await this.plugin.saveSettings();
                }));

        // Cross-file drag remains disabled in this release.
        // Keep the persisted setting key for backward compatibility, but hide it from UI.
    }
}
