import { Plugin } from 'obsidian';
import { dragHandleExtension } from './features/editor-plugin/ExtensionFactory';
import { setHandleHorizontalOffsetPx } from './infra/dom/handle/handle-positioner';
import { setHandleSizePx, setAlignToLineNumber } from './shared/constants';
import {
    DragNDropSettings,
    DEFAULT_SETTINGS,
    DragNDropSettingTab,
    HandleVisibilityMode,
    normalizeMultiLineSelectionLongPressMs,
    normalizeDragSourceVisualStyle,
} from './settings';
import { DragLifecycleEvent, DragLifecycleListener } from './shared/types/drag';

export default class DragNDropPlugin extends Plugin {
    settings: DragNDropSettings;
    private readonly dragLifecycleListeners = new Set<DragLifecycleListener>();

    async onload() {

        await this.loadSettings();

        // 注册编辑器扩展
        this.registerEditorExtension(dragHandleExtension(this));

        // 添加设置面板
        this.addSettingTab(new DragNDropSettingTab(this.app, this));
    }

    onunload() {
        this.dragLifecycleListeners.clear();
    }

    async loadSettings() {
        const saved = await this.loadData() ?? {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
        const savedRecord = saved as Record<string, unknown>;
        // Migrate legacy alwaysShowHandles boolean
        if ('alwaysShowHandles' in saved && !('handleVisibility' in saved)) {
            this.settings.handleVisibility = (saved as { alwaysShowHandles?: boolean }).alwaysShowHandles ? 'always' : 'hover';
        }
        // Legacy migration: old "none" style implied both highlights were effectively off.
        if (savedRecord.dragSourceVisualStyle === 'none') {
            if (!('enableDragSourceHighlight' in savedRecord)) {
                this.settings.enableDragSourceHighlight = false;
            }
            if (!('enableListDropHighlight' in savedRecord)) {
                this.settings.enableListDropHighlight = false;
            }
        }
        this.settings.enableDragSourceHighlight = this.settings.enableDragSourceHighlight !== false;
        this.settings.enableListDropHighlight = this.settings.enableListDropHighlight !== false;
        this.settings.enableCrossFileDrag = this.settings.enableCrossFileDrag === true;
        this.settings.enableMultiSelectionDeleteButton = this.settings.enableMultiSelectionDeleteButton === true;
        this.settings.multiLineSelectionLongPressMs = normalizeMultiLineSelectionLongPressMs(
            this.settings.multiLineSelectionLongPressMs
        );
        await this.saveData(this.settings);
        this.applySettings();
    }

    async saveSettings() {
        this.applySettings();
        await this.saveData(this.settings);
    }

    applySettings() {
        const body = document.body;
        const visibility: HandleVisibilityMode = this.settings.handleVisibility ?? 'hover';
        body.classList.toggle('dnd-handles-always', visibility === 'always');
        body.classList.toggle('dnd-handles-hidden', visibility === 'hidden');
        this.settings.multiLineSelectionLongPressMs = normalizeMultiLineSelectionLongPressMs(
            this.settings.multiLineSelectionLongPressMs
        );

        const dragSourceVisualStyle = normalizeDragSourceVisualStyle(this.settings.dragSourceVisualStyle);
        this.settings.dragSourceVisualStyle = dragSourceVisualStyle;
        body.setAttribute('data-dnd-drag-source-style', dragSourceVisualStyle);
        body.setAttribute('data-dnd-drag-source-highlight', this.settings.enableDragSourceHighlight ? 'on' : 'off');
        body.setAttribute('data-dnd-list-drop-highlight', this.settings.enableListDropHighlight ? 'on' : 'off');

        const rawHandleOffset = Number(this.settings.handleHorizontalOffsetPx);
        const handleOffset = Number.isFinite(rawHandleOffset)
            ? Math.max(-80, Math.min(80, Math.round(rawHandleOffset)))
            : DEFAULT_SETTINGS.handleHorizontalOffsetPx;
        this.settings.handleHorizontalOffsetPx = handleOffset;
        setHandleHorizontalOffsetPx(handleOffset);
        setAlignToLineNumber(this.settings.alignHandleToLineNumber ?? true);
        body.setCssProps({
            '--dnd-handle-horizontal-offset-px': `${handleOffset}px`,
        });

        let colorValue = '';
        if (this.settings.handleColorMode === 'theme') {
            colorValue = 'var(--interactive-accent)';
        } else if (this.settings.handleColor) {
            colorValue = this.settings.handleColor;
        }

        if (colorValue) {
            body.setCssProps({
                '--dnd-handle-color': colorValue,
                '--dnd-handle-color-hover': colorValue,
            });
        } else {
            body.setCssProps({
                '--dnd-handle-color': '',
                '--dnd-handle-color-hover': '',
            });
        }

        let indicatorColorValue = '';
        if (this.settings.indicatorColorMode === 'theme') {
            indicatorColorValue = 'var(--interactive-accent)';
        } else if (this.settings.indicatorColor) {
            indicatorColorValue = this.settings.indicatorColor;
        }

        if (indicatorColorValue) {
            body.setCssProps({
                '--dnd-drop-indicator-color': indicatorColorValue,
            });
        } else {
            body.setCssProps({
                '--dnd-drop-indicator-color': '',
            });
        }

        const handleSize = Math.max(12, Math.min(28, this.settings.handleSize ?? 16));
        setHandleSizePx(handleSize);
        body.setCssProps({
            '--dnd-handle-size': `${handleSize}px`,
            '--dnd-handle-core-size': `${Math.round(handleSize * 0.5)}px`,
        });
        body.setAttribute('data-dnd-handle-icon', this.settings.handleIcon ?? 'dot');

        window.dispatchEvent(new Event('dnd:settings-updated'));
    }

    onDragLifecycleEvent(listener: DragLifecycleListener): () => void {
        this.dragLifecycleListeners.add(listener);
        return () => {
            this.dragLifecycleListeners.delete(listener);
        };
    }

    emitDragLifecycleEvent(event: DragLifecycleEvent): void {
        for (const listener of Array.from(this.dragLifecycleListeners)) {
            try {
                listener(event);
            } catch (error) {
                console.error('[Dragger] drag lifecycle listener failed:', error);
            }
        }
    }
}
