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
    HANDLE_GUTTER_SPACER_CLASS,
} from '../../infra/dom/handle/handle-gutter';

class HandleGutterLineMarker extends GutterMarker {
    constructor(private readonly lineNumber: number) {
        super();
    }

    eq(other: GutterMarker): boolean {
        return other instanceof HandleGutterLineMarker && other.lineNumber === this.lineNumber;
    }

    toDOM(_view: EditorView): Node {
        const marker = document.createElement('div');
        marker.className = HANDLE_GUTTER_MARKER_CLASS;
        marker.setAttribute('data-line-number', String(this.lineNumber));
        return marker;
    }
}

class HandleGutterSpacerMarker extends GutterMarker {
    eq(other: GutterMarker): boolean {
        return other instanceof HandleGutterSpacerMarker;
    }

    toDOM(): Node {
        const spacer = document.createElement('div');
        spacer.className = HANDLE_GUTTER_SPACER_CLASS;
        return spacer;
    }
}

const spacerMarker = new HandleGutterSpacerMarker();

function resolveLineNumber(view: EditorView, line: BlockInfo): number {
    return view.state.doc.lineAt(line.from).number;
}

export function createHandleGutterExtension(): Extension {
    return gutter({
        class: HANDLE_GUTTER_CLASS,
        renderEmptyElements: true,
        lineMarker: (view, line) => new HandleGutterLineMarker(resolveLineNumber(view, line)),
        lineMarkerChange: (update) => update.docChanged || update.viewportChanged || update.geometryChanged,
        initialSpacer: () => spacerMarker,
        updateSpacer: () => spacerMarker,
    });
}
