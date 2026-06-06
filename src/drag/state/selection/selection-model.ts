import { EditorState } from '@codemirror/state';
import { BlockInfo } from '../../../domain/block/block-types';
import { detectBlock } from '../../../domain/block/block-detector';
import { clampLineNumber } from '../../../shared/utils/line-number';
import {
    mergeSelectedBlocks,
    type SelectedBlockRange,
} from './block-selection';

export type RangeSelectionBoundary = {
    startLineNumber: number;
    endLineNumber: number;
    representativeLineNumber: number;
};

export type RangeSelectionOperation = 'add' | 'remove';

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

export function buildSelectedBlockRangeFromBlockInfo(block: BlockInfo): SelectedBlockRange {
    return {
        startLineNumber: block.startLine + 1,
        endLineNumber: block.endLine + 1,
    };
}

export function resolveBlockBoundaryAtLine(
    state: EditorState,
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
    doc: EditorState['doc'],
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
    state: EditorState,
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
