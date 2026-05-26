import { describe, expect, it } from 'vitest';
import { BlockType, type BlockInfo } from '../block/block-types';
import { validateInPlaceDrop } from './drop-validation';
import { getLineMap } from '../markdown/line-map';
import { parseLineWithQuote } from '../markdown/line-parser';

function createDoc(lines: string[]) {
    return {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] ?? '' }),
    };
}

function createBlock(type: BlockType, startLine: number, endLine: number, content: string): BlockInfo {
    return {
        type,
        startLine,
        endLine,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

describe('drop-validation', () => {
    it('uses insertion matrix to reject invalid container drops', () => {
        const result = validateInPlaceDrop({
            doc: createDoc(['- list item']),
            sourceBlock: createBlock(BlockType.Paragraph, 0, 0, 'plain'),
            targetLineNumber: 1,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            slotContext: 'inside_list',
        });

        expect(result.allowInPlaceIndentChange).toBe(false);
        expect(result.rejectReason).toBe('inside_list');
    });

    it('keeps result stable when lineMap is provided', () => {
        const state = { doc: createDoc(['- root', '  - child', 'tail']) };
        const sourceBlock = createBlock(BlockType.ListItem, 0, 1, '- root\n  - child');
        const withoutMap = validateInPlaceDrop({
            doc: state.doc,
            sourceBlock,
            targetLineNumber: 2,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => ({ indentWidth: 0, indentRaw: '', markerType: 'unordered' }),
            getIndentUnitWidth: () => 2,
            slotContext: 'inside_list',
            listIntent: {
                contextLineNumber: 1,
                indentDelta: 0,
                targetIndentWidth: 0,
            },
        });
        const withMap = validateInPlaceDrop({
            doc: state.doc,
            sourceBlock,
            targetLineNumber: 2,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => ({ indentWidth: 0, indentRaw: '', markerType: 'unordered' }),
            getIndentUnitWidth: () => 2,
            slotContext: 'inside_list',
            lineMap: getLineMap(state),
            listIntent: {
                contextLineNumber: 1,
                indentDelta: 0,
                targetIndentWidth: 0,
            },
        });

        expect(withMap).toEqual(withoutMap);
    });

    it('treats disjoint composite selection gaps as valid drop targets', () => {
        const sourceBlock: BlockInfo = {
            ...createBlock(BlockType.ListItem, 1, 6, '- a\n- z'),
            compositeSelection: {
                ranges: [
                    { startLine: 1, endLine: 1 },
                    { startLine: 6, endLine: 6 },
                ],
            },
        };

        const inGap = validateInPlaceDrop({
            doc: createDoc(['0', 'a', 'b', 'c', 'd', 'e', 'z', 'tail']),
            sourceBlock,
            targetLineNumber: 4,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
        });
        expect(inGap.inSelfRange).toBe(false);
        expect(inGap.allowInPlaceIndentChange).toBe(false);

        const inSelectedRange = validateInPlaceDrop({
            doc: createDoc(['0', 'a', 'b', 'c', 'd', 'e', 'z', 'tail']),
            sourceBlock,
            targetLineNumber: 2,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
        });
        expect(inSelectedRange.inSelfRange).toBe(true);
        expect(inSelectedRange.rejectReason).toBe('self_range_blocked');
    });

    it('treats contiguous composite ranges like a single block for in-place indent changes', () => {
        const sourceBlock: BlockInfo = {
            ...createBlock(BlockType.ListItem, 0, 1, '- root\n  - child'),
            compositeSelection: {
                ranges: [
                    { startLine: 0, endLine: 0 },
                    { startLine: 1, endLine: 1 },
                ],
            },
        };

        const result = validateInPlaceDrop({
            doc: createDoc(['- root', '  - child', 'after']),
            sourceBlock,
            targetLineNumber: 3,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            listIntent: {
                contextLineNumber: 3,
                targetIndentWidth: 4,
            },
        });

        expect(result.inSelfRange).toBe(true);
        expect(result.allowInPlaceIndentChange).toBe(true);
        expect(result.rejectReason).toBeUndefined();
    });

    it('blocks in-place list indent when a composite source contains non-list content', () => {
        const sourceBlock: BlockInfo = {
            ...createBlock(BlockType.ListItem, 0, 2, '- root\nparagraph\n- child'),
            compositeSelection: {
                ranges: [
                    { startLine: 0, endLine: 0 },
                    { startLine: 1, endLine: 1 },
                    { startLine: 2, endLine: 2 },
                ],
            },
        };

        const result = validateInPlaceDrop({
            doc: createDoc(['- root', 'paragraph', '- child', 'after']),
            sourceBlock,
            targetLineNumber: 4,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            listIntent: {
                contextLineNumber: 4,
                targetIndentWidth: 2,
            },
        });

        expect(result.inSelfRange).toBe(true);
        expect(result.allowInPlaceIndentChange).toBe(false);
        expect(result.rejectReason).toBe('self_range_blocked');
    });
});


