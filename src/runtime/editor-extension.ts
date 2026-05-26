import { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import DragNDropPlugin from '../plugin/main';
import { createDragHandleViewPluginClass } from './editor-runtime';
import { createHandleGutterExtension } from './handle-gutter-extension';

function createDragHandleViewPlugin(plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        createDragHandleViewPluginClass(plugin)
    );
}

/**
 * 创建拖拽手柄编辑器扩展
 */
export function dragHandleExtension(plugin: DragNDropPlugin): Extension {
    return [
        createHandleGutterExtension(),
        createDragHandleViewPlugin(plugin),
    ];
}


