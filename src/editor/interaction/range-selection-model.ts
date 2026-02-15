import { EditorState } from '@codemirror/state';
import { BlockInfo, LineRange } from '../../types';
import { detectBlock } from '../core/block-detector';
import { clampLineNumber } from '../core/line-number';
import {
    normalizeLineRange,
    mergeLineRanges,
    cloneLineRanges,
} from '../core/line-range-utils';

export type { LineRange };
export {
    normalizeLineRange,
    mergeLineRanges,
    cloneLineRanges,
} from '../core/line-range-utils';

export type RangeSelectionBoundary = {
    startLineNumber: number;
    endLineNumber: number;
    representativeLineNumber: number;
};

export type RangeSelectConfig = {
    longPressMs: number;
};

export type CommittedRangeSelection = {
    selectedBlock: BlockInfo;
    ranges: LineRange[];
};

export type MouseRangeSelectState = {
    anchorSelectionBlock: BlockInfo;
    directDragSourceBlock: BlockInfo;
    activeSelectionBlock: BlockInfo;
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
    sourceHandle: HTMLElement | null;
    sourceHandleDraggableAttr: string | null;
    anchorStartLineNumber: number;
    anchorEndLineNumber: number;
    currentLineNumber: number;
    committedRangesSnapshot: LineRange[];
    selectionRanges: LineRange[];
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

export function cloneBlockInfo(block: BlockInfo): BlockInfo {
    return {
        ...block,
        compositeSelection: block.compositeSelection
            ? {
                ranges: block.compositeSelection.ranges.map((range) => ({ ...range })),
            }
            : undefined,
    };
}

function buildBlockInfoFromRange(
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

export function buildDragSourceBlockFromRanges(
    doc: SliceDocWithLength,
    ranges: LineRange[],
    template: BlockInfo
): BlockInfo {
    const normalizedRanges = mergeLineRanges(doc.lines, ranges);
    if (normalizedRanges.length === 0) {
        return buildBlockInfoFromRange(doc, template.startLine + 1, template.endLine + 1, template);
    }
    if (normalizedRanges.length === 1) {
        const range = normalizedRanges[0];
        return buildBlockInfoFromRange(doc, range.startLineNumber, range.endLineNumber, template);
    }

    const firstRange = normalizedRanges[0];
    const lastRange = normalizedRanges[normalizedRanges.length - 1];
    const firstLine = doc.line(firstRange.startLineNumber);
    const lastLine = doc.line(lastRange.endLineNumber);
    const content = normalizedRanges.map((range) => {
        const startLine = doc.line(range.startLineNumber);
        const endLine = doc.line(range.endLineNumber);
        const from = startLine.from;
        const to = Math.min(endLine.to + 1, doc.length);
        return doc.sliceString(from, to);
    }).join('');

    return {
        type: template.type,
        startLine: firstRange.startLineNumber - 1,
        endLine: lastRange.endLineNumber - 1,
        from: firstLine.from,
        to: lastLine.to,
        indentLevel: template.indentLevel,
        content,
        compositeSelection: {
            ranges: normalizedRanges.map((range) => ({
                startLine: range.startLineNumber - 1,
                endLine: range.endLineNumber - 1,
            })),
        },
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

export function expandToBlockAlignedRange(
    state: EditorState,
    anchorStartLineNumber: number,
    anchorEndLineNumber: number,
    targetBlockStartLineNumber: number,
    targetBlockEndLineNumber: number
): { startLineNumber: number; endLineNumber: number } {
    const docLines = state.doc.lines;
    let startLineNumber = Math.max(1, Math.min(docLines, Math.min(anchorStartLineNumber, targetBlockStartLineNumber)));
    let endLineNumber = Math.max(1, Math.min(docLines, Math.max(anchorEndLineNumber, targetBlockEndLineNumber)));

    let changed = true;
    while (changed) {
        changed = false;
        let cursor = startLineNumber;
        while (cursor <= endLineNumber) {
            const boundary = resolveBlockBoundaryAtLine(state, cursor);
            if (boundary.startLineNumber < startLineNumber) {
                startLineNumber = boundary.startLineNumber;
                changed = true;
            }
            if (boundary.endLineNumber > endLineNumber) {
                endLineNumber = boundary.endLineNumber;
                changed = true;
            }
            cursor = Math.max(cursor + 1, boundary.endLineNumber + 1);
        }
    }

    return { startLineNumber, endLineNumber };
}
