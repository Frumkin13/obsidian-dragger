import { Compartment, Extension } from '@codemirror/state';
import {
    BlockInfo,
    EditorView,
    gutter,
} from '@codemirror/view';
import {
    HANDLE_GUTTER_CLASS,
} from '../shared/dom-selectors';
import type { HandleGutterPosition } from '../shared/types/settings-types';
import type DragNDropPlugin from '../plugin/main';
import { HandleGutterLineMarker } from '../drag/source/handle-renderer';
import { resolveHandleBlockAtLine } from '../drag/source/handle-block-resolver';

export const handleGutterCompartment = new Compartment();

function resolveLineNumber(view: EditorView, line: BlockInfo): number {
    return view.state.doc.lineAt(line.from).number;
}

export function createHandleGutterExtension(position: HandleGutterPosition = 'left'): Extension {
    return gutter({
        class: HANDLE_GUTTER_CLASS,
        side: position === 'right' ? 'after' : 'before',
        renderEmptyElements: false,
        lineMarker: (view, line) => {
            const block = resolveHandleBlockAtLine(view.state, resolveLineNumber(view, line));
            return block ? new HandleGutterLineMarker(block) : null;
        },
        lineMarkerChange: (update) => update.docChanged || update.viewportChanged || update.geometryChanged,
    });
}

function resolveHandleGutterPosition(plugin: DragNDropPlugin): HandleGutterPosition {
    return plugin.settings.handleGutterPosition === 'right' ? 'right' : 'left';
}

export function createConfiguredHandleGutterExtension(plugin: DragNDropPlugin): Extension {
    return handleGutterCompartment.of(createHandleGutterExtension(resolveHandleGutterPosition(plugin)));
}

export function reconfigureHandleGutterExtension(view: EditorView, plugin: DragNDropPlugin): void {
    view.dispatch({
        effects: handleGutterCompartment.reconfigure(
            createHandleGutterExtension(resolveHandleGutterPosition(plugin))
        ),
    });
}
