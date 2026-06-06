import type { Text } from '@codemirror/state';
import type { BlockInfo } from '../../domain/block/block-types';
import { groupSelectedBlocksIntoSegments, mergeSelectedBlocks, type SelectedBlockRange } from './selected-blocks';
import type { DragSourceRange } from './source';
import { normalizeCompositeRanges } from '../../shared/utils/composite-selection';
import { clampLineNumber } from '../../shared/utils/line-number';

export function normalizeDragSourceRanges(ranges: DragSourceRange[], totalLines: number): DragSourceRange[] {
    return normalizeCompositeRanges(ranges, totalLines).map((range) => ({
        startLine: range.startLine,
        endLine: range.endLine,
    }));
}

export function buildSingleBlockSourceRanges(block: BlockInfo): DragSourceRange[] {
    return [{ startLine: block.startLine, endLine: block.endLine }];
}

function buildPrimaryBlockFromRange(
    doc: Text,
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

export function buildSelectionSourceParts(
    doc: Text,
    blocks: SelectedBlockRange[],
    template: BlockInfo
): { primaryBlock: BlockInfo; ranges: DragSourceRange[] } | null {
    const normalizedBlocks = mergeSelectedBlocks(doc.lines, blocks);
    if (normalizedBlocks.length === 0) return null;

    const segments = groupSelectedBlocksIntoSegments(doc.lines, normalizedBlocks);
    const firstSegment = segments[0];
    if (!firstSegment) return null;

    return {
        primaryBlock: buildPrimaryBlockFromRange(
            doc,
            firstSegment.startLineNumber,
            firstSegment.endLineNumber,
            template
        ),
        ranges: segments.map((segment) => ({
            startLine: segment.startLineNumber - 1,
            endLine: segment.endLineNumber - 1,
        })),
    };
}
