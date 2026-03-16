import { Extension } from '@codemirror/state';
import {
    BlockInfo,
    EditorView,
    GutterMarker,
    gutter,
} from '@codemirror/view';
import {
    HANDLE_GUTTER_CLASS,
    HANDLE_GUTTER_MARKER_CLASS,
    HANDLE_GUTTER_PROBE_CLASS,
} from '../../shared/dom-selectors';

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

export function createHandleGutterExtension(): Extension {
    return gutter({
        class: HANDLE_GUTTER_CLASS,
        renderEmptyElements: true,
        lineMarker: (view, line) => new HandleGutterLineMarker(resolveLineNumber(view, line)),
        lineMarkerChange: (update) => update.docChanged || update.viewportChanged || update.geometryChanged,
    });
}
