import { describe, expect, it } from 'vitest';
import {
    cloneLineRanges,
    isLineRangeCoveredByRanges,
    isLineNumberInRanges,
    mergeLineRanges,
    normalizeLineRange,
    subtractLineRange,
} from './line-range';

describe('line-range', () => {
    it('normalizes and clamps range boundaries', () => {
        expect(normalizeLineRange(10, 8, 3)).toEqual({
            startLineNumber: 3,
            endLineNumber: 8,
        });
        expect(normalizeLineRange(5, 0, 99)).toEqual({
            startLineNumber: 1,
            endLineNumber: 5,
        });
    });

    it('merges overlapping and adjacent ranges', () => {
        expect(mergeLineRanges(20, [
            { startLineNumber: 10, endLineNumber: 12 },
            { startLineNumber: 2, endLineNumber: 3 },
            { startLineNumber: 4, endLineNumber: 6 },
            { startLineNumber: 12, endLineNumber: 15 },
        ])).toEqual([
            { startLineNumber: 2, endLineNumber: 6 },
            { startLineNumber: 10, endLineNumber: 15 },
        ]);
    });

    it('clones ranges without mutating source objects', () => {
        const source = [
            { startLineNumber: 1, endLineNumber: 2 },
            { startLineNumber: 4, endLineNumber: 5 },
        ];
        const cloned = cloneLineRanges(source);
        cloned[0].startLineNumber = 99;
        expect(source[0].startLineNumber).toBe(1);
    });

    it('checks whether a line number belongs to ranges', () => {
        const ranges = [
            { startLineNumber: 2, endLineNumber: 4 },
            { startLineNumber: 7, endLineNumber: 8 },
        ];
        expect(isLineNumberInRanges(3, ranges)).toBe(true);
        expect(isLineNumberInRanges(6, ranges)).toBe(false);
    });

    it('checks whether a range is fully covered by selected ranges', () => {
        const ranges = [
            { startLineNumber: 2, endLineNumber: 6 },
            { startLineNumber: 9, endLineNumber: 10 },
        ];
        expect(isLineRangeCoveredByRanges(20, { startLineNumber: 3, endLineNumber: 5 }, ranges)).toBe(true);
        expect(isLineRangeCoveredByRanges(20, { startLineNumber: 5, endLineNumber: 9 }, ranges)).toBe(false);
    });

    it('subtracts a line range from current selection ranges', () => {
        const ranges = [
            { startLineNumber: 2, endLineNumber: 8 },
            { startLineNumber: 10, endLineNumber: 12 },
        ];
        expect(subtractLineRange(20, ranges, { startLineNumber: 4, endLineNumber: 10 })).toEqual([
            { startLineNumber: 2, endLineNumber: 3 },
            { startLineNumber: 11, endLineNumber: 12 },
        ]);
        expect(subtractLineRange(20, ranges, { startLineNumber: 1, endLineNumber: 20 })).toEqual([]);
    });
});
