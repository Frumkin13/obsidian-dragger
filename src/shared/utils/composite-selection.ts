import { mergeLineRanges } from './line-range';
import type { LineRange } from '../types/line-range';

export type CompositeLineRange = {
    startLine: number;
    endLine: number;
};

export function normalizeCompositeRanges(
    ranges: CompositeLineRange[],
    totalLines: number
): CompositeLineRange[] {
    if (totalLines <= 0) {
        return [];
    }

    const lineRanges: LineRange[] = ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));

    return mergeLineRanges(totalLines, lineRanges).map((range) => ({
        startLine: range.startLineNumber - 1,
        endLine: range.endLineNumber - 1,
    }));
}
