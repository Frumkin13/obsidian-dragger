import type { Text } from '@codemirror/state';
import type { BlockInfo } from '../../../domain/block/block-types';
import {
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    type SelectedBlockRange,
} from '../../../shared/utils/block-ranges';
import type { RangeSelectionOperation } from '../../../shared/types/drag';
import {
    type MouseRangeSelectState,
    type RangeSelectConfig,
} from './selection-model';

type CreateInitialRangeSelectionStateOptions = {
    blockInfo: BlockInfo;
    doc: Text;
    committedBlocksSnapshot: SelectedBlockRange[];
    pointerId: number;
    startX: number;
    startY: number;
    pointerType: string | null;
    initialOperation?: RangeSelectionOperation;
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
