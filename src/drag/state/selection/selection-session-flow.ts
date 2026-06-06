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
    buildDragSourceFromBlock,
    buildDragSourceFromBlocks,
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
    const anchorSelectionSource = buildDragSourceFromBlocks(options.doc, selectionBlocks, options.blockInfo);

    return {
        anchorSelectionSource,
        directDragSource: buildDragSourceFromBlock(options.blockInfo),
        activeSelectionSource: anchorSelectionSource,
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

export function autoScrollRangeSelection(scroller: HTMLElement, clientY: number): boolean {
    const rect = scroller.getBoundingClientRect();
    const topEdgeZone = 88;
    const bottomEdgeZone = 88;
    let delta = 0;
    if (clientY < rect.top + topEdgeZone) {
        delta = -Math.min(22, ((rect.top + topEdgeZone) - clientY) * 0.35 + 2);
    } else if (clientY > rect.bottom - bottomEdgeZone) {
        delta = Math.min(22, (clientY - (rect.bottom - bottomEdgeZone)) * 0.35 + 2);
    }
    if (delta === 0) return false;
    const previousScrollTop = scroller.scrollTop;
    scroller.scrollTop += delta;
    return scroller.scrollTop !== previousScrollTop;
}
