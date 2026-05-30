import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { convertCurrentBlockType, deleteCurrentBlock } from './block-type-conversion';

describe('block type conversion', () => {
    it('converts the current block to a heading', () => {
        const view = createMutableView('alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, 'heading-2');

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('## alpha\nbeta');
    });

    it('converts the current list block to an ordered list marker', () => {
        const view = createMutableView('- alpha\n- beta', 0);

        const changed = convertCurrentBlockType(view, 'ordered-list');

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('1. alpha\n- beta');
    });

    it('wraps the current block in a fenced code block', () => {
        const view = createMutableView('alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, 'code-block');

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('```\nalpha\n```\nbeta');
    });

    it('deletes the current block and its trailing newline', () => {
        const view = createMutableView('alpha\nbeta\ngamma', 6);

        const changed = deleteCurrentBlock(view);

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('alpha\ngamma');
    });

    it('deletes the last block and its leading newline', () => {
        const view = createMutableView('alpha\nbeta', 6);

        const changed = deleteCurrentBlock(view);

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('alpha');
    });
});

function createMutableView(doc: string, selectionAnchor: number): EditorView {
    let state = EditorState.create({
        doc,
        selection: { anchor: selectionAnchor },
    });
    return {
        get state() {
            return state;
        },
        dispatch(spec: Parameters<EditorState['update']>[0]) {
            state = state.update(spec).state;
        },
    } as unknown as EditorView;
}
