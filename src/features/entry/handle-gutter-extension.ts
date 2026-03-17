import { Compartment, Extension } from '@codemirror/state';
import {
    BlockInfo,
    EditorView,
    GutterMarker,
    gutter,
} from '@codemirror/view';
import {
    CODEMIRROR_AFTER_GUTTERS_SELECTOR,
    HANDLE_GUTTER_CLASS,
    HANDLE_GUTTER_MARKER_CLASS,
    HANDLE_GUTTER_PROBE_CLASS,
} from '../../shared/dom-selectors';
import type { HandleGutterPosition } from '../../shared/types/settings-types';
import type DragNDropPlugin from '../../plugin/main';

export const handleGutterCompartment = new Compartment();

class HandleGutterLineMarker extends GutterMarker {
    readonly elementClass = HANDLE_GUTTER_MARKER_CLASS;

    constructor(private readonly lineNumber: number) {
        super();
    }

    eq(other: GutterMarker): boolean {
        return other instanceof HandleGutterLineMarker && other.lineNumber === this.lineNumber;
    }

    toDOM(_view: EditorView): Node {
        const probe = document.createElement('span');
        probe.className = HANDLE_GUTTER_PROBE_CLASS;
        probe.setAttribute('data-line-number', String(this.lineNumber));
        return probe;
    }
}

function resolveLineNumber(view: EditorView, line: BlockInfo): number {
    return view.state.doc.lineAt(line.from).number;
}

export function createHandleGutterExtension(position: HandleGutterPosition = 'left'): Extension {
    return gutter({
        class: HANDLE_GUTTER_CLASS,
        side: position === 'right' ? 'after' : 'before',
        renderEmptyElements: true,
        lineMarker: (view, line) => new HandleGutterLineMarker(resolveLineNumber(view, line)),
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

export function placeHandleGutterHost(view: EditorView): void {
    const afterGutters = view.dom.querySelector<HTMLElement>(CODEMIRROR_AFTER_GUTTERS_SELECTOR);
    if (!afterGutters) return;

    const contentContainer = view.contentDOM.parentElement;
    if (
        afterGutters.querySelector(`.${HANDLE_GUTTER_CLASS}`)
        && contentContainer instanceof HTMLElement
        && contentContainer !== view.scrollDOM
        && contentContainer.contains(view.contentDOM)
    ) {
        if (afterGutters.parentElement !== contentContainer) {
            contentContainer.appendChild(afterGutters);
        }
        return;
    }

    if (afterGutters.parentElement !== view.scrollDOM) {
        view.scrollDOM.appendChild(afterGutters);
    }
}
