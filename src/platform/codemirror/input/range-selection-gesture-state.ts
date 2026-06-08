import type { BlockInfo } from '../../../domain/block/block-types';
import type { RangeSelectionOperation } from '../../../domain/selection/block-selection';
import {
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    type SelectedBlockRange,
} from '../../../domain/selection/block-ranges';
import type { DocLikeWithRange } from '../../../domain/markdown/document-types';
import {
    collectSelectedBlocksBetween,
    type RangeSelectionBoundary,
    type RangeSelectionBoundaryResolver,
} from '../../../domain/selection/range-selection';

export type RangeSelectConfig = {
    longPressMs: number;
};

export type MouseRangeSelectState = {
    anchorBlock: BlockInfo;
    directBlock: BlockInfo;
    operation: RangeSelectionOperation;
    preferLongPressDrag: boolean;
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
    anchorStartLineNumber: number;
    anchorEndLineNumber: number;
    currentLineNumber: number;
    committedBlocksSnapshot: SelectedBlockRange[];
    selectionBlocks: SelectedBlockRange[];
};

type CreateInitialRangeSelectionStateOptions = {
    blockInfo: BlockInfo;
    doc: DocLikeWithRange;
    committedBlocksSnapshot: SelectedBlockRange[];
    pointerId: number;
    startX: number;
    startY: number;
    pointerType: string | null;
    initialOperation?: RangeSelectionOperation;
};

export function computeUpdatedSelectionState(
    docLines: number,
    state: MouseRangeSelectState,
    target: RangeSelectionBoundary,
    resolveBoundary: RangeSelectionBoundaryResolver
): {
    currentLineNumber: number;
    selectionBlocks: SelectedBlockRange[];
} {
    const activeBlocks = collectSelectedBlocksBetween(
        docLines,
        state.anchorStartLineNumber,
        state.anchorEndLineNumber,
        target.startLineNumber,
        target.endLineNumber,
        resolveBoundary
    );

    const selectionBlocks = state.operation === 'remove'
        ? subtractSelectedBlocks(docLines, state.committedBlocksSnapshot, activeBlocks)
        : mergeSelectedBlocks(docLines, [
            ...state.committedBlocksSnapshot,
            ...activeBlocks,
        ]);
    return {
        currentLineNumber: target.representativeLineNumber,
        selectionBlocks,
    };
}

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

    const anchorBlock = {
        startLineNumber: anchorStartLineNumber,
        endLineNumber: anchorEndLineNumber,
    };
    const operation: RangeSelectionOperation = options.initialOperation ?? (isSelectedBlockCoveredByBlocks(
        options.doc.lines,
        anchorBlock,
        options.committedBlocksSnapshot
    ) ? 'remove' : 'add');
    const selectionBlocks = operation === 'remove'
        ? subtractSelectedBlocks(options.doc.lines, options.committedBlocksSnapshot, [anchorBlock])
        : mergeSelectedBlocks(options.doc.lines, [...options.committedBlocksSnapshot, anchorBlock]);
    return {
        anchorBlock: options.blockInfo,
        directBlock: options.blockInfo,
        operation,
        preferLongPressDrag: false,
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
        anchorStartLineNumber,
        anchorEndLineNumber,
        currentLineNumber: anchorEndLineNumber,
        committedBlocksSnapshot: options.committedBlocksSnapshot,
        selectionBlocks,
    };
}
