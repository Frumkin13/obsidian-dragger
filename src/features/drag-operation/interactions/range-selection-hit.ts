import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../shared/types/block-types';
import { resolveLineNumberAtCoords, resolveLineNumberFromDomNodes } from '../../../infra/dom/probe/element-probe';
import { normalizeEmbedRoot } from '../../../infra/dom/probe/embed-probe';
import { clampLineNumber } from '../../../core/services/parser/line-number';
import { EMBED_BLOCK_SELECTOR } from '../../../shared/dom-selectors';
import { type RangeSelectionBoundary, resolveBlockBoundaryAtLine } from '../../../core/services/state/selection-model';

function buildBoundaryFromBlock(doc: EditorState['doc'], block: BlockInfo): RangeSelectionBoundary {
    const startLineNumber = clampLineNumber(doc.lines, block.startLine + 1);
    const endLineNumber = clampLineNumber(doc.lines, block.endLine + 1);
    const representativeLineNumber = Math.max(
        startLineNumber,
        Math.min(endLineNumber, doc.lineAt(block.from).number)
    );
    return {
        startLineNumber,
        endLineNumber,
        representativeLineNumber,
    };
}

function safeGetBlockInfoAtPoint(
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null,
    clientX: number,
    clientY: number
): BlockInfo | null {
    try {
        return getBlockInfoAtPoint(clientX, clientY);
    } catch {
        return null;
    }
}

function collectRangeSelectionHitCandidates(hit: HTMLElement): Node[] {
    const candidates: Node[] = [];
    const push = (candidate: Node | null | undefined) => {
        if (!candidate) return;
        if (candidates.includes(candidate)) return;
        candidates.push(candidate);
    };

    push(hit.closest('.cm-line'));
    push(normalizeEmbedRoot(hit.closest<HTMLElement>('.cm-embed-block')));
    push(normalizeEmbedRoot(hit.closest<HTMLElement>(EMBED_BLOCK_SELECTOR)));
    return candidates;
}

function resolveRangeBoundaryFromDomHit(
    view: EditorView,
    probeXs: number[],
    clientY: number
): RangeSelectionBoundary | null {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
        return null;
    }

    for (const x of probeXs) {
        const rawHit = document.elementFromPoint(x, clientY);
        const hit = rawHit instanceof HTMLElement ? rawHit : null;
        if (!hit || !view.dom.contains(hit)) continue;

        for (const candidate of collectRangeSelectionHitCandidates(hit)) {
            const lineNumber = resolveLineNumberFromDomNode(view, candidate);
            if (lineNumber === null) continue;
            const boundary = resolveBlockBoundaryAtLine(view.state, lineNumber);
            return {
                ...boundary,
                representativeLineNumber: lineNumber,
            };
        }
    }

    return null;
}

function resolveLineNumberAtY(
    view: EditorView,
    clientY: number
): number | null {
    const doc = view.state.doc;
    if (doc.lines <= 0) return null;
    const contentRect = view.contentDOM.getBoundingClientRect();
    if (clientY <= contentRect.top) return 1;
    if (clientY >= contentRect.bottom) return doc.lines;

    const probeXs = [
        contentRect.left + 40,
        contentRect.left + 96,
        contentRect.left + Math.max(12, Math.min(160, contentRect.width / 2)),
    ].map((x) => Math.max(contentRect.left + 2, Math.min(contentRect.right - 2, x)));
    for (const x of probeXs) {
        const lineNumber = resolveLineNumberAtCoords(view, x, clientY, contentRect);
        if (lineNumber !== null) return lineNumber;
    }

    const lineEl = getLineElementAtY(view, clientY);
    if (lineEl) {
        const lineNumber = resolveLineNumberFromDomNodes(view, [lineEl]);
        if (lineNumber !== null) return lineNumber;
    }
    return null;
}

function getLineElementAtY(view: EditorView, clientY: number): HTMLElement | null {
    const lines = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.cm-line'));
    if (lines.length === 0) return null;
    let best: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const lineEl of lines) {
        const rect = lineEl.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) return lineEl;
        const center = (rect.top + rect.bottom) / 2;
        const distance = Math.abs(center - clientY);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = lineEl;
        }
    }
    return best;
}

function resolveLineNumberFromDomNode(view: EditorView, node: Node): number | null {
    return resolveLineNumberFromDomNodes(view, [
        node,
        node instanceof Element ? node.firstChild : null,
    ]);
}

export function resolveRangeBoundaryAtPoint(
    view: EditorView,
    clientX: number,
    clientY: number,
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null
): RangeSelectionBoundary | null {
    const doc = view.state.doc;
    if (doc.lines <= 0) return null;
    const contentRect = view.contentDOM.getBoundingClientRect();
    const lineHeight = Math.max(12, Number(view.defaultLineHeight ?? 20));

    const probeXs = [
        clientX,
        contentRect.left + 6,
        contentRect.left + 40,
        contentRect.left + Math.max(18, Math.min(180, contentRect.width * 0.4)),
    ].map((x) => Math.max(contentRect.left + 2, Math.min(contentRect.right - 2, x)));
    const probeYs = [
        clientY,
        clientY - lineHeight * 0.6,
        clientY + lineHeight * 0.6,
        clientY - lineHeight * 1.2,
        clientY + lineHeight * 1.2,
    ].map((y) => Math.max(contentRect.top + 1, Math.min(contentRect.bottom - 1, y)));

    for (const y of probeYs) {
        const domBoundary = resolveRangeBoundaryFromDomHit(view, probeXs, y);
        if (domBoundary) {
            return domBoundary;
        }
        for (const x of probeXs) {
            const block = safeGetBlockInfoAtPoint(getBlockInfoAtPoint, x, y);
            if (!block) continue;
            return buildBoundaryFromBlock(doc, block);
        }
    }

    const fallbackLineNumber = resolveLineNumberAtY(view, clientY);
    if (fallbackLineNumber === null) return null;
    const fallbackBoundary = resolveBlockBoundaryAtLine(view.state, fallbackLineNumber);
    return {
        ...fallbackBoundary,
        representativeLineNumber: fallbackLineNumber,
    };
}
