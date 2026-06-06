import { EditorState } from '@codemirror/state';
import { BlockInfo } from '../../../domain/block/block-types';
import { detectBlock } from '../../../domain/block/block-detector';
import { clampLineNumber } from '../../../shared/utils/line-number';
import { createDragSource, DragSource } from '../../../shared/types/drag';
import {
    groupSelectedBlocksIntoSegments,
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
    source: DragSource;
    blocks: SelectedBlockRange[];
};

export type MouseRangeSelectState = {
    anchorSelectionSource: DragSource;
    directDragSource: DragSource;
    activeSelectionSource: DragSource;
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

type SliceDoc = {
    line: (n: number) => { from: number; to: number };
    lines: number;
    sliceString: (from: number, to: number) => string;
};

type SliceDocWithLength = SliceDoc & {
    line: (n: number) => { from: number; to: number; number: number };
    length: number;
};

export function buildDragSourceFromBlock(block: BlockInfo): DragSource {
    return createDragSource(block, [{ startLine: block.startLine, endLine: block.endLine }]);
}

export function cloneDragSource(source: DragSource): DragSource {
    return createDragSource(
        { ...source.primaryBlock },
        source.ranges.map((range) => ({ ...range }))
    );
}

export function buildSelectedBlockRangeFromBlockInfo(block: BlockInfo): SelectedBlockRange {
    return {
        startLineNumber: block.startLine + 1,
        endLineNumber: block.endLine + 1,
    };
}

function buildPrimaryBlockFromRange(
    doc: SliceDoc,
    startLineNumber: number,
    endLineNumber: number,
    template: BlockInfo
): BlockInfo {
    const safeStart = clampLineNumber(doc.lines, startLineNumber);
    const safeEnd = Math.max(safeStart, clampLineNumber(doc.lines, endLineNumber));
    const startLine = doc.line(safeStart);
    const endLine = doc.line(safeEnd);
    return {
        type: template.type,
        startLine: safeStart - 1,
        endLine: safeEnd - 1,
        from: startLine.from,
        to: endLine.to,
        indentLevel: template.indentLevel,
        content: doc.sliceString(startLine.from, endLine.to),
    };
}

export function buildDragSourceFromBlocks(
    doc: SliceDocWithLength,
    blocks: SelectedBlockRange[],
    template: BlockInfo
): DragSource {
    const normalizedBlocks = mergeSelectedBlocks(doc.lines, blocks);
    if (normalizedBlocks.length === 0) {
        return buildDragSourceFromBlock(template);
    }

    const segments = groupSelectedBlocksIntoSegments(doc.lines, normalizedBlocks);
    const firstSegment = segments[0];
    const primaryBlock = buildPrimaryBlockFromRange(
        doc,
        firstSegment.startLineNumber,
        firstSegment.endLineNumber,
        template
    );

    return createDragSource(
        primaryBlock,
        segments.map((segment) => ({
            startLine: segment.startLineNumber - 1,
            endLine: segment.endLineNumber - 1,
        }))
    );
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
