import { EditorView } from '@codemirror/view';
import {
    getAlignToLineNumber,
    getHandleHorizontalOffsetPx,
    getHandleSizePx,
} from '../../../shared/constants';
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

function getHandleRowRectForLine(view: EditorView, lineNumber: number): RectLike | null {
    const row = getHandleGutterElementForLine(view, lineNumber);
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    return isLineNumberRowRect(rect) ? rect : null;
}

function getClosestLineNumberElementByHandleRow(view: EditorView, lineNumber: number): HTMLElement | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;

    const handleRowRect = getHandleRowRectForLine(view, lineNumber);
    if (!handleRowRect) return null;
    const centerY = (handleRowRect.top + handleRowRect.bottom) / 2;

    const candidates = Array.from(gutter.querySelectorAll<HTMLElement>('.cm-gutterElement'));
    let bestEl: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (!isLineNumberRowRect(rect)) continue;
        if (centerY >= rect.top && centerY <= rect.bottom) return candidate;
        const distance = Math.abs((rect.top + rect.bottom) / 2 - centerY);
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
    return getLineNumberElementByLineNumber(view, lineNumber) ?? getClosestLineNumberElementByHandleRow(view, lineNumber);
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

function getHandleCenterXForLine(view: EditorView, lineNumber: number): number | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;

    const horizontalOffset = getHandleHorizontalOffsetPx();
    if (getAlignToLineNumber()) {
        const lineNumberEl = getLineNumberElementForLine(view, lineNumber);
        if (lineNumberEl) {
            const lineNumberRect = lineNumberEl.getBoundingClientRect();
            if (isLineNumberRowRect(lineNumberRect)) {
                return (getGutterElementInnerCenterX(lineNumberEl) ?? (lineNumberRect.left + lineNumberRect.width / 2))
                    + horizontalOffset;
            }
        }
    }

    const handleGutterEl = getHandleGutterElementForLine(view, lineNumber);
    if (handleGutterEl) {
        const handleGutterRect = handleGutterEl.getBoundingClientRect();
        if (isLineNumberRowRect(handleGutterRect)) {
            return handleGutterRect.left + handleGutterRect.width / 2 + horizontalOffset;
        }
    }
    return getHandleColumnCenterX(view);
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

export function getHandleLeftPxForLine(view: EditorView, lineNumber: number): number | null {
    const centerX = getHandleCenterXForLine(view, lineNumber);
    if (centerX === null) return null;
    return Math.round(centerX - getHandleSizePx() / 2);
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

