import { EditorView } from '@codemirror/view';
import {
    CODEMIRROR_EDITOR_SELECTOR,
    CODEMIRROR_GUTTER_ELEMENT_SELECTOR,
    CODEMIRROR_LINE_NUMBER_GUTTER_SELECTOR,
} from '../../../shared/dom-selectors';
import { getHandleGutterElementForLine } from './handle-gutter';

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
    const all = Array.from(view.dom.querySelectorAll<HTMLElement>(CODEMIRROR_LINE_NUMBER_GUTTER_SELECTOR));
    return all.filter((gutter) => (
        isElementVisible(gutter)
        && gutter.closest(CODEMIRROR_EDITOR_SELECTOR) === view.dom
    ));
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

    const candidates = Array.from(gutter.querySelectorAll<HTMLElement>(CODEMIRROR_GUTTER_ELEMENT_SELECTOR));
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
    const candidates = Array.from(gutter.querySelectorAll<HTMLElement>(CODEMIRROR_GUTTER_ELEMENT_SELECTOR));
    return candidates.find((el) => resolveLineNumberFromGutterElement(view, el) === lineNumber) ?? null;
}

export function getLineNumberColumnCenterX(view: EditorView): number | null {
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;
    const candidates = Array.from(gutter.querySelectorAll<HTMLElement>(CODEMIRROR_GUTTER_ELEMENT_SELECTOR));
    for (const candidate of candidates) {
        const centerX = getGutterElementInnerCenterX(candidate);
        if (centerX === null) continue;
        return centerX;
    }
    return null;
}

export function getLineNumberElementForLine(view: EditorView, lineNumber: number): HTMLElement | null {
    return getLineNumberElementByLineNumber(view, lineNumber) ?? getClosestLineNumberElementByHandleRow(view, lineNumber);
}

export function hasVisibleLineNumberGutter(view: EditorView): boolean {
    return getLineNumberGutterRect(view) !== null;
}
