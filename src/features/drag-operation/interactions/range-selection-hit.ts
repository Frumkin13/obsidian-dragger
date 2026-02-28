import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../shared/types/block-types';
import { normalizeEmbedRoot } from '../../../infra/dom/probe/embed-probe';
import { clampLineNumber } from '../../../core/services/parser/line-number';
import { EMBED_BLOCK_SELECTOR } from '../../../shared/dom-selectors';
import { type RangeSelectionBoundary } from '../../../core/services/state/selection-model';

function buildBoundaryFromBlock(doc: EditorView['state']['doc'], block: BlockInfo): RangeSelectionBoundary {
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

function clampToContentRect(
    x: number,
    y: number,
    rect: DOMRect
): { x: number; y: number } {
    return {
        x: Math.max(rect.left + 2, Math.min(rect.right - 2, x)),
        y: Math.max(rect.top + 1, Math.min(rect.bottom - 1, y)),
    };
}

function pushProbePoint(
    points: Array<{ x: number; y: number }>,
    point: { x: number; y: number }
): void {
    if (points.some((p) => Math.abs(p.x - point.x) < 0.5 && Math.abs(p.y - point.y) < 0.5)) return;
    points.push(point);
}

function collectDomProbePoints(
    view: EditorView,
    basePoint: { x: number; y: number },
    contentRect: DOMRect
): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
        return points;
    }

    const rawHit = document.elementFromPoint(basePoint.x, basePoint.y);
    const hit = rawHit instanceof HTMLElement ? rawHit : null;
    if (!hit || !view.dom.contains(hit)) return points;

    const embedRoot = normalizeEmbedRoot(hit.closest<HTMLElement>(EMBED_BLOCK_SELECTOR));
    const lineEl = hit.closest<HTMLElement>('.cm-line');
    const candidates: HTMLElement[] = [];
    if (embedRoot) candidates.push(embedRoot);
    if (lineEl) candidates.push(lineEl);
    if (candidates.length === 0) return points;

    for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        const insetX = Math.min(20, Math.max(8, rect.width * 0.1));
        const leftProbeX = rect.left + insetX;
        const centerProbeX = rect.left + rect.width / 2;
        const rightProbeX = rect.right - insetX;

        const insetY = Math.min(20, Math.max(6, rect.height * 0.2));
        const topProbeY = rect.top + insetY;
        const centerProbeY = rect.top + rect.height / 2;
        const bottomProbeY = rect.bottom - insetY;

        const probeYs = [topProbeY, centerProbeY, bottomProbeY];
        const probeXs = [leftProbeX, centerProbeX, rightProbeX, basePoint.x];
        for (const y of probeYs) {
            for (const x of probeXs) {
                pushProbePoint(points, clampToContentRect(x, y, contentRect));
            }
        }
    }

    return points;
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
        contentRect.left + Math.max(18, Math.min(220, contentRect.width * 0.4)),
        contentRect.left + Math.max(24, Math.min(320, contentRect.width * 0.7)),
    ].map((x) => Math.max(contentRect.left + 2, Math.min(contentRect.right - 2, x)));
    const probeYs = [
        clientY,
        clientY - lineHeight * 0.6,
        clientY + lineHeight * 0.6,
        clientY - lineHeight * 1.2,
        clientY + lineHeight * 1.2,
    ].map((y) => Math.max(contentRect.top + 1, Math.min(contentRect.bottom - 1, y)));

    for (const y of probeYs) {
        for (const x of probeXs) {
            pushProbePoint(probePoints, { x, y });
        }
    }
    for (const point of probePoints) {
        const block = safeGetBlockInfoAtPoint(getBlockInfoAtPoint, point.x, point.y);
        if (!block) continue;
        return buildBoundaryFromBlock(doc, block);
    }

    return null;
}
