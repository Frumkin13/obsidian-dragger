import type { BlockInfo } from '../../../domain/block/block-types';
import type { DocLikeWithRange } from '../../../domain/markdown/document-types';

export type RangeSelectConfig = {
    longPressMs: number;
};

export type MouseRangeSelectState = {
    anchorBlock: BlockInfo;
    directBlock: BlockInfo;
    selectionGestureStarted: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    latestX: number;
    latestY: number;
    pointerType: string | null;
    dragReady: boolean;
    longPressReady: boolean;
    isIntercepting: boolean;
    timeoutId: number | null;
    dragTimeoutId: number | null;
    currentLineNumber: number;
};

type CreateInitialRangeSelectionStateOptions = {
    blockInfo: BlockInfo;
    doc: DocLikeWithRange;
    pointerId: number;
    startX: number;
    startY: number;
    pointerType: string | null;
};

export function resolveRangeSelectConfig(
    pointerType: string | null,
    mouseLongPressMs: number,
    getTouchRangeSelectLongPressMs: () => number
): RangeSelectConfig {
    if (pointerType === 'mouse') {
        return {
            longPressMs: mouseLongPressMs,
        };
    }

    return {
        longPressMs: getTouchRangeSelectLongPressMs(),
    };
}

export function createInitialRangeSelectionState(
    options: CreateInitialRangeSelectionStateOptions
): MouseRangeSelectState | null {
    const anchorStartLineNumber = options.blockInfo.startLine + 1;
    const anchorEndLineNumber = options.blockInfo.endLine + 1;
    if (
        anchorStartLineNumber < 1
        || anchorEndLineNumber > options.doc.lines
        || anchorStartLineNumber > anchorEndLineNumber
    ) {
        return null;
    }

    return {
        anchorBlock: options.blockInfo,
        directBlock: options.blockInfo,
        selectionGestureStarted: false,
        pointerId: options.pointerId,
        startX: options.startX,
        startY: options.startY,
        latestX: options.startX,
        latestY: options.startY,
        pointerType: options.pointerType,
        dragReady: options.pointerType === 'mouse',
        longPressReady: false,
        isIntercepting: options.pointerType !== 'mouse',
        timeoutId: null,
        dragTimeoutId: null,
        currentLineNumber: anchorEndLineNumber,
    };
}
