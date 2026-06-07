import { Plugin } from 'obsidian';
import { dragHandleExtension } from '../runtime/editor-extension';
import { ExternalFileDropController } from '../runtime/external-file-drop-controller';
import {
    DEFAULT_HANDLE_SIZE_PX,
    HANDLE_CORE_SIZE_RATIO,
    GRIP_DOTS_CORE_SIZE_RATIO,
    MAX_HANDLE_SIZE_PX,
    MIN_HANDLE_SIZE_PX,
    setHandleHorizontalOffsetPx,
    setHandleSizePx,
} from '../shared/constants';
import {
    DND_DRAG_SOURCE_HIGHLIGHT_ATTR,
    DND_DRAG_SOURCE_STYLE_ATTR,
    DND_HANDLE_ICON_ATTR,
    DND_LIST_DROP_HIGHLIGHT_ATTR,
} from '../shared/dom-attrs';
import {
    DragNDropSettings,
    DEFAULT_SETTINGS,
    DragNDropSettingTab,
    HandleVisibilityMode,
    normalizeHandleGutterPosition,
    normalizeMultiLineSelectionLongPressMs,
    normalizeDragSourceVisualStyle,
} from './settings';
import { DragLifecycleEvent, DragLifecycleListener } from '../shared/types/drag';
import { registerMobileToolbarCommands } from './mobile-toolbar-commands';

export default class DragNDropPlugin extends Plugin {
    settings: DragNDropSettings;
    private readonly dragLifecycleListeners = new Set<DragLifecycleListener>();

    async onload() {

        await this.loadSettings();

        // 注册编辑器扩展
        this.registerEditorExtension(dragHandleExtension(this));
        registerMobileToolbarCommands(this);
        const externalFileDropController = new ExternalFileDropController(this);
        externalFileDropController.register();

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
        this.settings.multiLineSelectionLongPressMs = normalizeMultiLineSelectionLongPressMs(
            this.settings.multiLineSelectionLongPressMs
        );
        this.settings.handleGutterPosition = normalizeHandleGutterPosition(this.settings.handleGutterPosition);
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
        body.setAttribute(DND_DRAG_SOURCE_STYLE_ATTR, dragSourceVisualStyle);
        body.setAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR, this.settings.enableDragSourceHighlight ? 'on' : 'off');
        body.setAttribute(DND_LIST_DROP_HIGHLIGHT_ATTR, this.settings.enableListDropHighlight ? 'on' : 'off');

        const rawHandleOffset = Number(this.settings.handleHorizontalOffsetPx);
        const handleOffset = Number.isFinite(rawHandleOffset)
            ? Math.max(-80, Math.min(80, Math.round(rawHandleOffset)))
            : DEFAULT_SETTINGS.handleHorizontalOffsetPx;
        this.settings.handleHorizontalOffsetPx = handleOffset;
        this.settings.handleGutterPosition = normalizeHandleGutterPosition(this.settings.handleGutterPosition);
        setHandleHorizontalOffsetPx(handleOffset);
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

        const handleSize = Math.max(
            MIN_HANDLE_SIZE_PX,
            Math.min(MAX_HANDLE_SIZE_PX, this.settings.handleSize ?? DEFAULT_HANDLE_SIZE_PX)
        );
        setHandleSizePx(handleSize);
        body.setCssProps({
            '--dnd-handle-size': `${handleSize}px`,
            '--dnd-handle-core-size': `${Math.round(handleSize * HANDLE_CORE_SIZE_RATIO)}px`,
            '--dnd-grip-dots-core-size': `${Math.round(handleSize * GRIP_DOTS_CORE_SIZE_RATIO)}px`,
        });
        body.setAttribute(DND_HANDLE_ICON_ATTR, this.settings.handleIcon ?? 'grip-dots');

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
