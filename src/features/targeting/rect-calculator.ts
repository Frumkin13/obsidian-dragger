import { EditorView } from '@codemirror/view';

// Removed GeometryFrameCache declarations

export function getCoordsAtPos(
    view: EditorView,
    pos: number,
    side?: -1 | 1
): ReturnType<EditorView['coordsAtPos']> | null {
    try {
        const { from, to } = view.viewport;
        const margin = 500; 

        if (pos >= Math.max(0, from - margin) && pos <= to + margin) {
            return typeof side !== 'undefined' ? view.coordsAtPos(pos, side) : view.coordsAtPos(pos);
        }

        const lineBlock = view.lineBlockAt(pos);
        const editorRect = view.dom.getBoundingClientRect();
        const doc = view.state.doc;
        
        if (pos < 0 || pos > doc.length) return null;

        const line = doc.lineAt(pos);
        const col = pos - line.from;
        
        const defaultCharWidth = view.defaultCharacterWidth || 7;
        const estimatedLeft = editorRect.left + (col * defaultCharWidth);
        const estimatedRight = estimatedLeft + defaultCharWidth;

        const documentTop = view.documentTop;
        const screenTop = documentTop + lineBlock.top;
        const screenBottom = documentTop + lineBlock.bottom;

        return {
            left: estimatedLeft,
            right: estimatedRight,
            top: screenTop,
            bottom: screenBottom
        };
    } catch {
        return null;
    }
}

export function getLineRect(
    view: EditorView,
    lineNumber: number
): { left: number; width: number } | undefined {
    const doc = view.state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return undefined;
    const line = doc.line(lineNumber);
    const start = getCoordsAtPos(view, line.from);
    const end = getCoordsAtPos(view, line.to);
    if (!start || !end) return undefined;
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.left, end.left);
    return { left, width: Math.max(8, right - left) };
}

export function getInsertionAnchorY(
    view: EditorView,
    lineNumber: number
): number | null {
    const doc = view.state.doc;
    let y: number | null = null;
    if (lineNumber <= 1) {
        const first = doc.line(1);
        const coords = getCoordsAtPos(view, first.from);
        y = coords ? coords.top : null;
    } else {
        const anchorLineNumber = Math.min(lineNumber - 1, doc.lines);
        const anchorLine = doc.line(anchorLineNumber);
        const coords = getCoordsAtPos(view, anchorLine.to);
        y = coords ? coords.bottom : null;
    }
    return y;
}

export function getLineIndentPosByWidth(
    view: EditorView,
    lineNumber: number,
    targetIndentWidth: number,
    tabSize: number
): number | null {
    const doc = view.state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const line = doc.line(lineNumber);
    const text = line.text;
    let width = 0;
    let idx = 0;
    while (idx < text.length && width < targetIndentWidth) {
        const ch = text[idx];
        if (ch === '\t') {
            width += tabSize;
        } else if (ch === ' ') {
            width += 1;
        } else {
            break;
        }
        idx += 1;
    }
    return line.from + idx;
}

export function getBlockRect(
    view: EditorView,
    startLineNumber: number,
    endLineNumber: number
): { top: number; left: number; width: number; height: number } | undefined {
    const doc = view.state.doc;
    if (startLineNumber < 1 || endLineNumber > doc.lines) return undefined;
    let minLeft = Number.POSITIVE_INFINITY;
    let maxRight = 0;
    let top = 0;
    let bottom = 0;

    for (let i = startLineNumber; i <= endLineNumber; i++) {
        const line = doc.line(i);
        const start = getCoordsAtPos(view, line.from);
        const end = getCoordsAtPos(view, line.to);
        if (!start || !end) continue;
        if (i === startLineNumber) top = start.top;
        if (i === endLineNumber) bottom = end.bottom;
        const left = Math.min(start.left, end.left);
        const right = Math.max(start.left, end.left);
        minLeft = Math.min(minLeft, left);
        maxRight = Math.max(maxRight, right);
    }

    if (!isFinite(minLeft) || maxRight === 0 || bottom <= top) return undefined;
    return { top, left: minLeft, width: Math.max(8, maxRight - minLeft), height: bottom - top };
}
