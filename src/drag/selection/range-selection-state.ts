import type { BlockInfo } from '../../domain/block/block-types';
import { detectBlock } from '../../domain/block/block-detector';
import type { RangeSelectionOperation } from '../../domain/selection/block-selection';
import {
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    type SelectedBlockRange,
} from '../../domain/selection/block-ranges';
import { clampLineNumber } from '../../domain/markdown/line-number';
import type { DocLikeWithRange, StateWithDoc } from '../../domain/markdown/document-types';

type DocWithLineAt = DocLikeWithRange & {
    lineAt: (pos: number) => { number: number };
};

export type { RangeSelectionOperation } from '../../domain/selection/block-selection';
export {
    cloneSelectedBlocks,
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    type SelectedBlockRange,
} from '../../domain/selection/block-ranges';

export type RangeSelectionBoundary = {
    startLineNumber: number;
    endLineNumber: number;
    representativeLineNumber: number;
};

export type RangeSelectConfig = {
    longPressMs: number;
};

export type CommittedRangeSelection = {
    blocks: SelectedBlockRange[];
    templateBlock: BlockInfo;
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

export function buildSelectedBlockRangeFromBlockInfo(block: BlockInfo): SelectedBlockRange {
    return {
        startLineNumber: block.startLine + 1,
        endLineNumber: block.endLine + 1,
    };
}

export function resolveBlockBoundaryAtLine(
    state: StateWithDoc,
    lineNumber: number
): { startLineNumber: number; endLineNumber: number } {
    const doc = state.doc;
    const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
    const block = detectBlock(state, clampedLine);
    if (!block) {
        return {
            startLineNumber: clampedLine,
            endLineNumber: clampedLine,
        };
    }
    return {
        startLineNumber: Math.max(1, block.startLine + 1),
        endLineNumber: Math.min(doc.lines, block.endLine + 1),
    };
}

export function buildRangeSelectionBoundaryFromBlock(
    doc: DocWithLineAt,
    block: BlockInfo
): RangeSelectionBoundary {
    const startLineNumber = clampLineNumber(doc.lines, block.startLine + 1);
    const endLineNumber = clampLineNumber(doc.lines, block.endLine + 1);
    const representativeLineNumber = Math.max(
        startLineNumber,
        Math.min(endLineNumber, doc.lineAt(block.from).number)
    );
    return {
        startLineNumber,
        endLineNumber,
        representativeLineNumber,
    };
}

export function collectSelectedBlocksBetween(
    state: StateWithDoc,
    anchorStartLineNumber: number,
    anchorEndLineNumber: number,
    targetBlockStartLineNumber: number,
    targetBlockEndLineNumber: number
): SelectedBlockRange[] {
    const docLines = state.doc.lines;
    const startLineNumber = Math.max(
        1,
        Math.min(docLines, Math.min(anchorStartLineNumber, targetBlockStartLineNumber))
    );
    const endLineNumber = Math.max(
        1,
        Math.min(docLines, Math.max(anchorEndLineNumber, targetBlockEndLineNumber))
    );

    const blocks: SelectedBlockRange[] = [];
    let cursor = startLineNumber;
    while (cursor <= endLineNumber) {
        const boundary = resolveBlockBoundaryAtLine(state, cursor);
        blocks.push({
            startLineNumber: boundary.startLineNumber,
            endLineNumber: boundary.endLineNumber,
        });
        cursor = Math.max(cursor + 1, boundary.endLineNumber + 1);
    }

    return mergeSelectedBlocks(docLines, blocks);
}

export function computeUpdatedSelectionState(
    editorState: StateWithDoc,
    state: MouseRangeSelectState,
    target: RangeSelectionBoundary
): {
    currentLineNumber: number;
    selectionBlocks: SelectedBlockRange[];
} {
    const activeBlocks = collectSelectedBlocksBetween(
        editorState,
        state.anchorStartLineNumber,
        state.anchorEndLineNumber,
        target.startLineNumber,
        target.endLineNumber
    );

    const docLines = editorState.doc.lines;
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

export function buildCommittedRangeSelection(
    doc: DocLikeWithRange,
    selectionBlocks: SelectedBlockRange[],
    templateBlock: MouseRangeSelectState['anchorBlock']
): CommittedRangeSelection | null {
    const committedBlocks = mergeSelectedBlocks(doc.lines, selectionBlocks);
    if (committedBlocks.length === 0) {
        return null;
    }
    return {
        blocks: committedBlocks,
        templateBlock,
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
