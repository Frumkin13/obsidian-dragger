import { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import DragNDropPlugin from '../main';
import { createDragHandleViewPluginClass } from './orchestration/drag-handle-view-plugin-class';

function createDragHandleViewPlugin(plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        createDragHandleViewPluginClass(plugin)
        // No decorations config - LineHandleManager uses independent DOM elements
    );
}

/**
 * 创建拖拽手柄编辑器扩展
 */
export function dragHandleExtension(plugin: DragNDropPlugin): Extension {
    return [createDragHandleViewPlugin(plugin)];
}
