import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { BlockType } from '../../domain/block/block-types';
import { createDragSource } from './source';
import { buildSelectionSourceParts } from './source-ranges';

function templateForLine(state: EditorState, lineNumber: number) {
    const line = state.doc.line(lineNumber);
    return {
        type: BlockType.Paragraph,
        startLine: lineNumber - 1,
        endLine: lineNumber - 1,
        from: line.from,
        to: line.to,
        indentLevel: 0,
        content: line.text,
    };
}

describe('source-ranges', () => {
    it('treats contiguous selected blocks as a single combined drag source', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd' });
        const parts = buildSelectionSourceParts(
            state.doc,
            [
                { startLineNumber: 2, endLineNumber: 2 },
                { startLineNumber: 3, endLineNumber: 3 },
            ],
            templateForLine(state, 2)
        );
        expect(parts).not.toBeNull();
        const source = createDragSource(parts!.primaryBlock, parts!.ranges);

        expect(source.primaryBlock.startLine).toBe(1);
        expect(source.primaryBlock.endLine).toBe(2);
        expect(source.primaryBlock.content).toBe('b\nc');
        expect(source.ranges).toEqual([{ startLine: 1, endLine: 2 }]);
    });

    it('keeps disjoint segments in DragSource.ranges', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne' });
        const parts = buildSelectionSourceParts(
            state.doc,
            [
                { startLineNumber: 2, endLineNumber: 2 },
                { startLineNumber: 4, endLineNumber: 4 },
            ],
            templateForLine(state, 2)
        );
        expect(parts).not.toBeNull();
        const source = createDragSource(parts!.primaryBlock, parts!.ranges);

        expect(source.primaryBlock.startLine).toBe(1);
        expect(source.primaryBlock.endLine).toBe(1);
        expect(source.primaryBlock.content).toBe('b');
        expect(source.ranges).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 3, endLine: 3 },
        ]);
    });
});
