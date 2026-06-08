import type { BlockInfo } from '../../domain/block/block-types';
import type { RangeSelectionOperation } from '../../domain/selection/block-selection';
import {
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    type SelectedBlockRange,
} from '../../domain/selection/block-ranges';
import type { DocLikeWithRange } from '../../domain/markdown/document-types';
import {
    buildSelectedBlockRangeFromBlockInfo,
    collectSelectedBlocksBetween,
    type RangeSelectionBoundary,
    type RangeSelectionBoundaryResolver,
} from '../../domain/selection/range-selection';

export type BlockRangeSelectionState = {
    anchorStartLineNumber: number;
    anchorEndLineNumber: number;
    operation: RangeSelectionOperation;
    baseBlocks: SelectedBlockRange[];
    activeBlocks: SelectedBlockRange[];
    selectionBlocks: SelectedBlockRange[];
};

export function createBlockRangeSelectionState(options: {
    doc: DocLikeWithRange;
    blockInfo: BlockInfo;
    selectedBlocks: SelectedBlockRange[];
    operation?: RangeSelectionOperation;
}): BlockRangeSelectionState | null {
    const anchorStartLineNumber = options.blockInfo.startLine + 1;
    const anchorEndLineNumber = options.blockInfo.endLine + 1;
    if (
        anchorStartLineNumber < 1
        || anchorEndLineNumber > options.doc.lines
        || anchorStartLineNumber > anchorEndLineNumber
    ) {
        return null;
    }

    const activeBlock = buildSelectedBlockRangeFromBlockInfo(options.blockInfo);
    const operation = options.operation ?? (isSelectedBlockCoveredByBlocks(
        options.doc.lines,
        activeBlock,
        options.selectedBlocks
    ) ? 'remove' : 'add');
    return applyBlockRangeSelection({
        docLines: options.doc.lines,
        operation,
        baseBlocks: options.selectedBlocks,
        activeBlocks: [activeBlock],
    }, {
        anchorStartLineNumber,
        anchorEndLineNumber,
    });
}

export function updateBlockRangeSelectionState(
    state: Pick<BlockRangeSelectionState, 'anchorStartLineNumber' | 'anchorEndLineNumber' | 'operation' | 'baseBlocks'>,
    options: {
        docLines: number;
        target: RangeSelectionBoundary;
        resolveBoundary: RangeSelectionBoundaryResolver;
    }
): BlockRangeSelectionState {
    const activeBlocks = collectSelectedBlocksBetween(
        options.docLines,
        state.anchorStartLineNumber,
        state.anchorEndLineNumber,
        options.target.startLineNumber,
        options.target.endLineNumber,
        options.resolveBoundary
    );
    return applyBlockRangeSelection({
        docLines: options.docLines,
        operation: state.operation,
        baseBlocks: state.baseBlocks,
        activeBlocks,
    }, {
        anchorStartLineNumber: state.anchorStartLineNumber,
        anchorEndLineNumber: state.anchorEndLineNumber,
    });
}

function applyBlockRangeSelection(
    options: {
        docLines: number;
        operation: RangeSelectionOperation;
        baseBlocks: SelectedBlockRange[];
        activeBlocks: SelectedBlockRange[];
    },
    anchor: Pick<BlockRangeSelectionState, 'anchorStartLineNumber' | 'anchorEndLineNumber'>
): BlockRangeSelectionState {
    const selectionBlocks = options.operation === 'remove'
        ? subtractSelectedBlocks(options.docLines, options.baseBlocks, options.activeBlocks)
        : mergeSelectedBlocks(options.docLines, [
            ...options.baseBlocks,
            ...options.activeBlocks,
        ]);
    return {
        ...anchor,
        operation: options.operation,
        baseBlocks: mergeSelectedBlocks(options.docLines, options.baseBlocks),
        activeBlocks: mergeSelectedBlocks(options.docLines, options.activeBlocks),
        selectionBlocks,
    };
}
