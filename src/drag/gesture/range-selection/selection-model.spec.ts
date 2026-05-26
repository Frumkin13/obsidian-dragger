import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { BlockType } from '../../../domain/block/block-types';
import { buildDragSourceBlockFromBlocks } from './selection-model';

describe('selection-model', () => {
    it('treats contiguous selected blocks as a single combined block', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd' });
        const sourceBlock = buildDragSourceBlockFromBlocks(
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

        expect(sourceBlock.startLine).toBe(1);
        expect(sourceBlock.endLine).toBe(2);
        expect(sourceBlock.content).toBe('b\nc');
        expect(sourceBlock.compositeSelection).toBeUndefined();
    });

    it('keeps only disjoint segments in composite selection metadata', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne' });
        const sourceBlock = buildDragSourceBlockFromBlocks(
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

        expect(sourceBlock.startLine).toBe(1);
        expect(sourceBlock.endLine).toBe(3);
        expect(sourceBlock.content).toBe('b\nd');
        expect(sourceBlock.compositeSelection?.ranges).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 3, endLine: 3 },
        ]);
    });
});
