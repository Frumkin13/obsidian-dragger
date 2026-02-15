import { EditorView } from '@codemirror/view';
import { getHandleSizePx, getHandleHorizontalOffsetPx, getAlignToLineNumber } from './constants';
import { safeCoordsAtPos } from './dom-probe';
import { getMainContentLineRectForLine } from './line-dom';

type RectLike = {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width?: number;
    height?: number;
};

type VerticalRange = {
    top: number;
    bottom: number;
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

function getAnyGutterRect(view: EditorView): RectLike | null {
    const gutters = view.dom.querySelector('.cm-gutters');
    if (!gutters || !isElementVisible(gutters)) return null;
    const rect = gutters.getBoundingClientRect();
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

function getLineProbePositions(view: EditorView, lineNumber: number): number[] {
    const line = view.state.doc.line(lineNumber);
    return [line.from, Math.max(line.from, line.to - 1), line.to];
}

function getCoordsVerticalRangeForLine(view: EditorView, lineNumber: number): VerticalRange | null {
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    let hasRect = false;
    for (const pos of getLineProbePositions(view, lineNumber)) {
        const rect = safeCoordsAtPos(view, pos);
        if (!isLineNumberRowRect(rect)) continue;
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
        hasRect = true;
    }
    if (!hasRect) return null;
    return { top, bottom };
}

function getViewportMidYForLine(view: EditorView, lineNumber: number): number | null {
    const lineRect = getMainContentLineRectForLine(view, lineNumber);
    if (lineRect) return (lineRect.top + lineRect.bottom) / 2;

    const range = getCoordsVerticalRangeForLine(view, lineNumber);
    if (!range) return null;
    return (range.top + range.bottom) / 2;
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
    const horizontalOffset = getHandleHorizontalOffsetPx();
    const alignToLineNumber = getAlignToLineNumber();

    if (alignToLineNumber) {
        const lineNumberEl = getLineNumberElementForLine(view, lineNumber);
        if (lineNumberEl) {
            const rect = lineNumberEl.getBoundingClientRect();
            if (isLineNumberRowRect(rect)) {
                const centerY = rect.top + rect.height / 2;
                const centerX = (getGutterElementInnerCenterX(lineNumberEl) ?? (rect.left + rect.width / 2)) + horizontalOffset;
                return {
                    x: centerX,
                    y: centerY,
                };
            }
        }
    }

    if (lineNumber >= 1 && lineNumber <= view.state.doc.lines) {
        const lineRect = getMainContentLineRectForLine(view, lineNumber);
        if (lineRect) {
            return {
                x: getHandleColumnCenterX(view),
                y: (lineRect.top + lineRect.bottom) / 2,
            };
        }

        const range = getCoordsVerticalRangeForLine(view, lineNumber);
        if (range) {
            const height = range.bottom - range.top;
            const defaultLineHeight = view.defaultLineHeight || 20;
            const offsetY = height > defaultLineHeight * 1.5
                ? defaultLineHeight / 2
                : height / 2;

            return {
                x: getHandleColumnCenterX(view),
                y: range.top + Math.max(0, offsetY),
            };
        }
    }

    return null;
}

export function getHandleColumnCenterX(view: EditorView): number {
    const horizontalOffset = getHandleHorizontalOffsetPx();
    const alignToLineNumber = getAlignToLineNumber();

    if (alignToLineNumber) {
        const lineNumberElementCenterX = getLineNumberElementCenterX(view);
        if (lineNumberElementCenterX !== null) return lineNumberElementCenterX + horizontalOffset;

        const lineNumberRect = getLineNumberGutterRect(view);
        if (lineNumberRect) return lineNumberRect.left + rectWidth(lineNumberRect) / 2 + horizontalOffset;
    }

    const gutterRect = getAnyGutterRect(view);
    if (gutterRect) return gutterRect.left + rectWidth(gutterRect) / 2 + horizontalOffset;

    // 手柄完全悬浮在编辑器左侧边缘，不依赖文档内容
    const contentRect = view.contentDOM.getBoundingClientRect();
    return contentRect.left - getHandleSizePx() + horizontalOffset;
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

export { setHandleHorizontalOffsetPx } from './constants';
