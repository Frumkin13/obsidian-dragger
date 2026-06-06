import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { BlockType } from '../../../domain/block/block-types';
import { buildDragSourceFromBlocks } from './selection-model';

describe('selection-model', () => {
    it('treats contiguous selected blocks as a single combined drag source', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd' });
        const source = buildDragSourceFromBlocks(
            state.doc,
            [
                { startLineNumber: 2, endLineNumber: 2 },
                { startLineNumber: 3, endLineNumber: 3 },
            ],
            {
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 1,
                from: state.doc.line(2).from,
                to: state.doc.line(2).to,
                indentLevel: 0,
                content: 'b',
            }
        );

        expect(source.primaryBlock.startLine).toBe(1);
        expect(source.primaryBlock.endLine).toBe(2);
        expect(source.primaryBlock.content).toBe('b\nc');
        expect(source.ranges).toEqual([{ startLine: 1, endLine: 2 }]);
    });

    it('keeps disjoint segments in DragSource.ranges', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne' });
        const source = buildDragSourceFromBlocks(
            state.doc,
            [
                { startLineNumber: 2, endLineNumber: 2 },
                { startLineNumber: 4, endLineNumber: 4 },
            ],
            {
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 1,
                from: state.doc.line(2).from,
                to: state.doc.line(2).to,
                indentLevel: 0,
                content: 'b',
            }
        );

        expect(source.primaryBlock.startLine).toBe(1);
        expect(source.primaryBlock.endLine).toBe(1);
        expect(source.primaryBlock.content).toBe('b');
        expect(source.ranges).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 3, endLine: 3 },
        ]);
    });
});
