import { BlockInfo as ViewBlockInfo, BlockType, EditorView } from '@codemirror/view';
import { getHandleSizePx, getHandleHorizontalOffsetPx, getAlignToLineNumber } from '../../../shared/constants';
import { getMainContentLineElementForLine } from '../probe/line-dom';
import {
    getHandleGutterElementCenterX,
    getHandleGutterElementForLine,
    getHandleGutterRect,
} from './handle-gutter';

type RectLike = {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width?: number;
    height?: number;
};

function rectWidth(rect: RectLike): number {
    return typeof rect.width === 'number' ? rect.width : (rect.right - rect.left);
}

function rectHeight(rect: RectLike): number {
    return typeof rect.height === 'number' ? rect.height : (rect.bottom - rect.top);
}

function isUsableRect(rect: RectLike | null | undefined): rect is RectLike {
    if (!rect) return false;
    return rectWidth(rect) > 0 && rectHeight(rect) > 0;
}

function isLineNumberRowRect(rect: RectLike | null | undefined): rect is RectLike {
    if (!rect) return false;
    return rectHeight(rect) > 0;
}

function isElementVisible(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
}

function getOwnLineNumberGutters(view: EditorView): HTMLElement[] {
    const all = Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-gutter.cm-lineNumbers, .cm-lineNumbers'));
    return all.filter((gutter) => (
        isElementVisible(gutter)
        && gutter.closest('.cm-editor') === view.dom
    ));
}

function getGutterElementInnerCenterX(gutterElement: HTMLElement): number | null {
    const rect = gutterElement.getBoundingClientRect();
    if (!isLineNumberRowRect(rect)) return null;

    const style = getComputedStyle(gutterElement);
    const borderLeft = Number.parseFloat(style.borderLeftWidth || '0') || 0;
    const borderRight = Number.parseFloat(style.borderRightWidth || '0') || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft || '0') || 0;
    const paddingRight = Number.parseFloat(style.paddingRight || '0') || 0;
    const innerLeft = rect.left + borderLeft + paddingLeft;
    const innerRight = rect.right - borderRight - paddingRight;
    if (innerRight <= innerLeft) {
        return rect.left + rect.width / 2;
    }
    return (innerLeft + innerRight) / 2;
}

function getLineNumberGutterRect(view: EditorView): RectLike | null {
    const lineNumberGutter = getLineNumberGutter(view);
    if (!lineNumberGutter) return null;
    const rect = lineNumberGutter.getBoundingClientRect();
    return isUsableRect(rect) ? rect : null;
}

function getLineNumberGutter(view: EditorView): HTMLElement | null {
    const candidates = getOwnLineNumberGutters(view);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const editorRect = view.dom.getBoundingClientRect();
    let bestGutter: HTMLElement | null = null;
    let bestOverlapArea = -1;
    for (const gutter of candidates) {
        const rect = gutter.getBoundingClientRect();
        if (!isUsableRect(rect)) continue;
        const overlapWidth = Math.max(0, Math.min(rect.right, editorRect.right) - Math.max(rect.left, editorRect.left));
        const overlapHeight = Math.max(0, Math.min(rect.bottom, editorRect.bottom) - Math.max(rect.top, editorRect.top));
        const overlapArea = overlapWidth * overlapHeight;
        if (overlapArea > bestOverlapArea) {
            bestOverlapArea = overlapArea;
            bestGutter = gutter;
        }
    }
    return bestGutter ?? candidates[0];
}

function getLineNumberElementCenterX(view: EditorView): number | null {
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;
    const candidates = Array.from(gutter.querySelectorAll<HTMLElement>('.cm-gutterElement'));
    for (const candidate of candidates) {
        const centerX = getGutterElementInnerCenterX(candidate);
        if (centerX === null) continue;
        return centerX;
    }
    return null;
}

function resolveLineNumberFromGutterElement(
    view: EditorView,
    gutterElement: HTMLElement
): number | null {
    const byData = gutterElement.getAttribute('data-line-number')
        ?? gutterElement.getAttribute('data-line')
        ?? gutterElement.dataset.lineNumber
        ?? null;
    if (byData) {
        const parsed = Number(byData);
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= view.state.doc.lines) {
            return parsed;
        }
    }

    const aria = gutterElement.getAttribute('aria-label');
    if (aria) {
        const match = aria.match(/\d+/);
        if (match) {
            const parsed = Number(match[0]);
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= view.state.doc.lines) {
                return parsed;
            }
        }
    }

    const raw = gutterElement.textContent?.trim();
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > view.state.doc.lines) return null;
    return parsed;
}

function getRenderedAnchorBlockForLine(view: EditorView, lineNumber: number): ReturnType<EditorView['lineBlockAt']> | null {
    for (const lineBlock of view.viewportLineBlocks) {
        if (Array.isArray(lineBlock.type)) {
            let firstSameLineBlock: ViewBlockInfo | null = null;
            for (const block of lineBlock.type) {
                if (view.state.doc.lineAt(block.from).number !== lineNumber) continue;
                firstSameLineBlock ??= block;
                if (block.type === BlockType.Text) {
                    return block;
                }
            }
            if (firstSameLineBlock) return firstSameLineBlock;
            continue;
        }

        if (view.state.doc.lineAt(lineBlock.from).number !== lineNumber) continue;
        return lineBlock;
    }
    return null;
}

function getFirstTextRowMidY(rootEl: HTMLElement): number | null {
    const doc = rootEl.ownerDocument;
    const nodeFilter = doc.defaultView?.NodeFilter;
    const textRects: DOMRect[] = [];

    const pushRangeRects = (range: Range) => {
        const rects = range.getClientRects();
        for (let i = 0; i < rects.length; i++) {
            const rect = rects.item(i);
            if (!rect || rect.width <= 0 || rect.height <= 0) continue;
            textRects.push(rect);
        }
    };

    if (nodeFilter) {
        const walker = doc.createTreeWalker(rootEl, nodeFilter.SHOW_TEXT, {
            acceptNode(node: Node): number {
                const text = node.textContent;
                if (!text || text.trim().length === 0) return nodeFilter.FILTER_SKIP;
                const parent = node.parentElement;
                if (!parent) return nodeFilter.FILTER_SKIP;
                if (parent.closest('.cm-formatting, .cm-foldPlaceholder, .cm-invisible')) {
                    return nodeFilter.FILTER_SKIP;
                }
                if (parent.closest('.table-col-drag-handle, .table-row-drag-handle, .table-row-btn, .table-col-btn, [data-ignore-swipe="true"]')) {
                    return nodeFilter.FILTER_SKIP;
                }
                const style = getComputedStyle(parent);
                if (style.display === 'none' || style.visibility === 'hidden') {
                    return nodeFilter.FILTER_SKIP;
                }
                if (style.position === 'absolute' || style.position === 'fixed') {
                    return nodeFilter.FILTER_SKIP;
                }
                return nodeFilter.FILTER_ACCEPT;
            },
        });

        let node: Node | null = walker.nextNode();
        while (node) {
            const range = doc.createRange();
            range.selectNodeContents(node);
            pushRangeRects(range);
            node = walker.nextNode();
        }
    }

    if (textRects.length === 0) return null;

    let firstTop = Number.POSITIVE_INFINITY;
    for (const rect of textRects) {
        if (rect.top < firstTop) firstTop = rect.top;
    }

    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const rect of textRects) {
        if (Math.abs(rect.top - firstTop) > 1) continue;
        if (rect.top < top) top = rect.top;
        if (rect.bottom > bottom) bottom = rect.bottom;
    }
    if (!(bottom > top)) return null;
    return (top + bottom) / 2;
}

const TEXT_BLOCK_PROBE_SELECTOR = '.cm-preview-code-block, .cm-embed-block, .cm-callout, .cm-math, .MathJax_Display, .callout, .MathJax, .mjx-container, .cm-line';
const CODE_BLOCK_PROBE_SELECTOR = '.cm-preview-code-block, .HyperMD-codeblock';
const TABLE_WIDGET_SELECTOR = '.cm-table-widget';
const TABLE_FIRST_ROW_CELL_SELECTOR = '.table-wrapper > .table-editor > thead > tr:first-child > th:first-child > .table-cell-wrapper';

function getTextProbeRootFromLine(lineEl: HTMLElement): HTMLElement {
    return lineEl.querySelector<HTMLElement>(TEXT_BLOCK_PROBE_SELECTOR) ?? lineEl;
}

function getTableWidgetFromElement(el: Element): HTMLElement | null {
    return el.closest<HTMLElement>(TABLE_WIDGET_SELECTOR);
}

function getTableFirstRowMidY(tableWidget: HTMLElement): number | null {
    const firstCell = tableWidget.querySelector<HTMLElement>(TABLE_FIRST_ROW_CELL_SELECTOR);
    if (!firstCell) return null;
    return getFirstTextRowMidY(firstCell);
}

type TableAnchorResult = {
    matched: boolean;
    midY: number | null;
};

function getTableWidgetForLine(view: EditorView, lineNumber: number, pos: number): HTMLElement | null {
    const lineEl = getMainContentLineElementForLine(view, lineNumber);
    if (lineEl) {
        const lineWidget = lineEl.matches(TABLE_WIDGET_SELECTOR)
            ? lineEl
            : lineEl.querySelector<HTMLElement>(TABLE_WIDGET_SELECTOR);
        if (lineWidget) return lineWidget;
    }

    if (typeof view.domAtPos !== 'function') return null;
    try {
        const at = view.domAtPos(pos);
        const base = at.node.nodeType === Node.TEXT_NODE
            ? at.node.parentElement
            : at.node;
        if (!(base instanceof Element)) return null;
        return getTableWidgetFromElement(base);
    } catch {
        return null;
    }
}

function getTableAnchorForLine(view: EditorView, lineNumber: number, pos: number): TableAnchorResult {
    const tableWidget = getTableWidgetForLine(view, lineNumber, pos);
    if (!tableWidget) return { matched: false, midY: null };
    return {
        matched: true,
        midY: getTableFirstRowMidY(tableWidget),
    };
}

function isCodeBlockProbe(probe: Element): boolean {
    return probe.matches(CODE_BLOCK_PROBE_SELECTOR) || !!probe.querySelector(CODE_BLOCK_PROBE_SELECTOR);
}

function getTextBlockMidY(view: EditorView, blockFrom: number, lineNumber: number): number | null {
    const tableAnchor = getTableAnchorForLine(view, lineNumber, blockFrom);
    if (tableAnchor.matched) return tableAnchor.midY;

    if (typeof view.domAtPos === 'function') {
        try {
            const domAtPos = view.domAtPos(blockFrom);
            const base = domAtPos.node.nodeType === Node.TEXT_NODE
                ? domAtPos.node.parentElement
                : domAtPos.node;
            if (base instanceof Element) {
                const probe = base.closest<HTMLElement>(TEXT_BLOCK_PROBE_SELECTOR);
                if (probe) {
                    if (isCodeBlockProbe(probe)) return null;
                    const midY = getFirstTextRowMidY(probe);
                    if (midY !== null) return midY;
                }
            }
        } catch {
            // Fall through to line-based probe.
        }
    }

    const lineEl = getMainContentLineElementForLine(view, lineNumber);
    if (!lineEl) return null;
    try {
        const probe = getTextProbeRootFromLine(lineEl);
        if (isCodeBlockProbe(probe)) return null;
        return getFirstTextRowMidY(probe);
    } catch {
        return null;
    }
}

function getViewportMidYForLine(view: EditorView, lineNumber: number): number | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;

    const block = getRenderedAnchorBlockForLine(view, lineNumber);
    if (!block || !(block.height > 0)) return null;
    if (block.type === BlockType.Text) {
        const textMidY = getTextBlockMidY(view, block.from, lineNumber);
        if (textMidY !== null) return textMidY;
        return view.documentTop + block.top + block.height / 2;
    }
    const tableAnchor = getTableAnchorForLine(view, lineNumber, block.from);
    if (tableAnchor.matched) return tableAnchor.midY;
    return view.documentTop + block.top + view.defaultLineHeight / 2;
}

function getClosestLineNumberElementByY(view: EditorView, lineNumber: number): HTMLElement | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;

    const y = getViewportMidYForLine(view, lineNumber);
    if (y === null) return null;

    const candidates = Array.from(gutter.querySelectorAll<HTMLElement>('.cm-gutterElement'));
    let bestEl: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (!isLineNumberRowRect(rect)) continue;
        if (y >= rect.top && y <= rect.bottom) return candidate;
        const centerY = (rect.top + rect.bottom) / 2;
        const distance = Math.abs(centerY - y);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestEl = candidate;
        }
    }
    return bestEl;
}

function getLineNumberElementByLineNumber(view: EditorView, lineNumber: number): HTMLElement | null {
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;
    const candidates = Array.from(gutter.querySelectorAll<HTMLElement>('.cm-gutterElement'));
    return candidates.find((el) => resolveLineNumberFromGutterElement(view, el) === lineNumber) ?? null;
}

export function getLineNumberElementForLine(view: EditorView, lineNumber: number): HTMLElement | null {
    return getLineNumberElementByLineNumber(view, lineNumber) ?? getClosestLineNumberElementByY(view, lineNumber);
}

export function getLineNumberAtViewportY(view: EditorView, viewportY: number): number | null {
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;
    const candidates = Array.from(gutter.querySelectorAll<HTMLElement>('.cm-gutterElement'));
    let nearest: { lineNumber: number; distance: number } | null = null;
    for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (!isLineNumberRowRect(rect)) continue;
        const lineNumber = resolveLineNumberFromGutterElement(view, candidate);
        if (lineNumber === null) continue;
        if (viewportY >= rect.top && viewportY <= rect.bottom) return lineNumber;
        const centerY = (rect.top + rect.bottom) / 2;
        const distance = Math.abs(centerY - viewportY);
        if (!nearest || distance < nearest.distance) {
            nearest = { lineNumber, distance };
        }
    }
    return nearest?.lineNumber ?? null;
}

export function hasVisibleLineNumberGutter(view: EditorView): boolean {
    return getLineNumberGutterRect(view) !== null;
}

function getHandleCenterForLine(view: EditorView, lineNumber: number): { x: number; y: number } | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;

    const horizontalOffset = getHandleHorizontalOffsetPx();
    const centerY = getViewportMidYForLine(view, lineNumber);
    if (centerY === null) return null;

    if (getAlignToLineNumber()) {
        const lineNumberEl = getLineNumberElementForLine(view, lineNumber);
        if (lineNumberEl) {
            const lineNumberRect = lineNumberEl.getBoundingClientRect();
            if (isLineNumberRowRect(lineNumberRect)) {
                const centerX = (getGutterElementInnerCenterX(lineNumberEl) ?? (lineNumberRect.left + lineNumberRect.width / 2))
                    + horizontalOffset;
                return { x: centerX, y: centerY };
            }
        }
    }

    const handleGutterEl = getHandleGutterElementForLine(view, lineNumber);
    if (handleGutterEl) {
        const handleGutterRect = handleGutterEl.getBoundingClientRect();
        if (isLineNumberRowRect(handleGutterRect)) {
            return {
                x: handleGutterRect.left + handleGutterRect.width / 2 + horizontalOffset,
                y: centerY,
            };
        }
    }
    return {
        x: getHandleColumnCenterX(view),
        y: centerY,
    };
}

export function getHandleColumnCenterX(view: EditorView): number {
    const horizontalOffset = getHandleHorizontalOffsetPx();
    if (getAlignToLineNumber()) {
        const lineNumberElementCenterX = getLineNumberElementCenterX(view);
        if (lineNumberElementCenterX !== null) return lineNumberElementCenterX + horizontalOffset;
    }

    const handleGutterCenterX = getHandleGutterElementCenterX(view);
    if (handleGutterCenterX !== null) return handleGutterCenterX + horizontalOffset;
    const handleGutterRect = getHandleGutterRect(view);
    if (handleGutterRect) return handleGutterRect.left + rectWidth(handleGutterRect) / 2 + horizontalOffset;

    // 手柄完全悬浮在编辑器左侧边缘，不依赖文档内容
    const contentRect = view.contentDOM.getBoundingClientRect();
    return contentRect.left - getHandleSizePx() / 2 + horizontalOffset;
}

export function getHandleColumnLeftPx(view: EditorView): number {
    return Math.round(getHandleColumnCenterX(view) - getHandleSizePx() / 2);
}

export function getHandleLeftPxForLine(view: EditorView, lineNumber: number): number | null {
    const center = getHandleCenterForLine(view, lineNumber);
    if (!center) return null;
    return Math.round(center.x - getHandleSizePx() / 2);
}

export function getHandleTopPxForLine(view: EditorView, lineNumber: number): number | null {
    const center = getHandleCenterForLine(view, lineNumber);
    if (!center) return null;
    return Math.round(center.y - getHandleSizePx() / 2);
}

function getEditorAxisScale(rectSize: number, offsetSize: number): number {
    if (rectSize <= 0 || offsetSize <= 0) return 1;
    return rectSize / offsetSize;
}

export function viewportXToEditorLocalX(view: EditorView, viewportX: number): number {
    const rect = view.dom.getBoundingClientRect();
    const scaleX = getEditorAxisScale(rect.width, view.dom.offsetWidth);
    return (viewportX - rect.left) / scaleX - view.dom.clientLeft;
}

export function viewportYToEditorLocalY(view: EditorView, viewportY: number): number {
    const rect = view.dom.getBoundingClientRect();
    const scaleY = getEditorAxisScale(rect.height, view.dom.offsetHeight);
    return (viewportY - rect.top) / scaleY - view.dom.clientTop;
}

export { setHandleHorizontalOffsetPx } from '../../../shared/constants';
