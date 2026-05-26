import type { Text } from '@codemirror/state';
import type { BlockInfo } from '../../../domain/block/block-types';
import {
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    type SelectedBlockRange,
} from './block-selection';
import {
    type MouseRangeSelectState,
    type RangeSelectionOperation,
    type RangeSelectConfig,
    buildDragSourceBlockFromBlocks,
    buildSelectedBlockRangeFromBlockInfo,
    cloneBlockInfo,
} from './selection-model';

type CreateInitialRangeSelectionStateOptions = {
    blockInfo: BlockInfo;
    doc: Text;
    committedBlocksSnapshot: SelectedBlockRange[];
    pointerId: number;
    startX: number;
    startY: number;
    pointerType: string | null;
    sourceHandle: HTMLElement | null;
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

    const anchorBlock = buildSelectedBlockRangeFromBlockInfo(options.blockInfo);
    const operation: RangeSelectionOperation = isSelectedBlockCoveredByBlocks(
        options.doc.lines,
        anchorBlock,
        options.committedBlocksSnapshot
    ) ? 'remove' : 'add';
    const selectionBlocks = operation === 'remove'
        ? subtractSelectedBlocks(options.doc.lines, options.committedBlocksSnapshot, [anchorBlock])
        : mergeSelectedBlocks(options.doc.lines, [...options.committedBlocksSnapshot, anchorBlock]);
    const anchorSelectionBlock = buildDragSourceBlockFromBlocks(options.doc, selectionBlocks, options.blockInfo);

    return {
        anchorSelectionBlock,
        directDragSourceBlock: cloneBlockInfo(options.blockInfo),
        activeSelectionBlock: anchorSelectionBlock,
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
        sourceHandle: options.sourceHandle,
        anchorStartLineNumber,
        anchorEndLineNumber,
        currentLineNumber: anchorEndLineNumber,
        committedBlocksSnapshot: options.committedBlocksSnapshot,
        selectionBlocks,
    };
}

export function autoScrollRangeSelection(scroller: HTMLElement, clientY: number): void {
    const rect = scroller.getBoundingClientRect();
    const edgeZone = 44;
    let delta = 0;
    if (clientY < rect.top + edgeZone) {
        delta = -Math.min(22, ((rect.top + edgeZone) - clientY) * 0.35 + 2);
    } else if (clientY > rect.bottom - edgeZone) {
        delta = Math.min(22, (clientY - (rect.bottom - edgeZone)) * 0.35 + 2);
    }
    if (delta === 0) return;
    scroller.scrollTop += delta;
}

