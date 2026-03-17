import { EditorView } from '@codemirror/view';
import {
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

function isLineNumberRowRect(rect: RectLike | null | undefined): rect is RectLike {
    if (!rect) return false;
    return typeof rect.height === 'number'
        ? rect.height > 0
        : (rect.bottom - rect.top) > 0;
}

function getHandleCenterXForLine(view: EditorView, lineNumber: number): number | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;

    const horizontalOffset = getHandleHorizontalOffsetPx();
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

