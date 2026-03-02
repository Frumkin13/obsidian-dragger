import type { LineRange } from '../types/line-range';

export function normalizeLineRange(docLines: number, startLineNumber: number, endLineNumber: number): LineRange {
    const safeStart = Math.max(1, Math.min(docLines, Math.min(startLineNumber, endLineNumber)));
    const safeEnd = Math.max(1, Math.min(docLines, Math.max(startLineNumber, endLineNumber)));
    return {
        startLineNumber: safeStart,
        endLineNumber: safeEnd,
    };
}

export function mergeLineRanges(docLines: number, ranges: LineRange[]): LineRange[] {
    const normalized = ranges
        .map((range) => normalizeLineRange(docLines, range.startLineNumber, range.endLineNumber))
        .sort((a, b) => a.startLineNumber - b.startLineNumber);
    const merged: LineRange[] = [];
    for (const range of normalized) {
        const last = merged[merged.length - 1];
        if (!last || range.startLineNumber > last.endLineNumber + 1) {
            merged.push({ ...range });
            continue;
        }
        if (range.endLineNumber > last.endLineNumber) {
            last.endLineNumber = range.endLineNumber;
        }
    }
    return merged;
}

export function cloneLineRanges(ranges: LineRange[]): LineRange[] {
    return ranges.map((range) => ({ ...range }));
}

export function isLineNumberInRanges(lineNumber: number, ranges: LineRange[]): boolean {
    for (const range of ranges) {
        if (lineNumber >= range.startLineNumber && lineNumber <= range.endLineNumber) {
            return true;
        }
    }
    return false;
}
