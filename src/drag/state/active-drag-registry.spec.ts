// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockInfo, BlockType } from '../../domain/block/block-types';
import { createDragSource } from '../source/source';
import {
    beginDragSession,
    finishDragSession,
    getActiveDragSource,
} from './active-drag-registry';

function createViewStub(docText = 'line'): EditorView {
    const state = EditorState.create({ doc: docText });
    const dom = document.createElement('div');
    dom.className = 'cm-editor dnd-root-editor';
    const contentDOM = document.createElement('div');
    contentDOM.className = 'cm-content';
    dom.appendChild(contentDOM);
    document.body.appendChild(dom);

    return {
        state,
        dom,
        contentDOM,
    } as unknown as EditorView;
}

function createBlock(content: string, startLine: number): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine,
        endLine: startLine,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

afterEach(() => {
    finishDragSession();
    document.body.innerHTML = '';
});

describe('pointer drag session scoping', () => {
    it('keeps drag source state isolated per editor view', () => {
        const viewA = createViewStub('a');
        const viewB = createViewStub('b');
        const blockA = createBlock('A', 0);
        const blockB = createBlock('B', 0);

        beginDragSession(createDragSource(blockA, [{ startLine: blockA.startLine, endLine: blockA.endLine }]), viewA);
        beginDragSession(createDragSource(blockB, [{ startLine: blockB.startLine, endLine: blockB.endLine }]), viewB);

        expect(document.body.classList.contains('dnd-dragging')).toBe(true);
        expect(getActiveDragSource(viewA)?.primaryBlock.content).toBe('A');
        expect(getActiveDragSource(viewB)?.primaryBlock.content).toBe('B');

        finishDragSession(viewA);
        expect(getActiveDragSource(viewA)).toBeNull();
        expect(getActiveDragSource(viewB)?.primaryBlock.content).toBe('B');
        expect(document.body.classList.contains('dnd-dragging')).toBe(true);

        finishDragSession(viewB);
        expect(document.body.classList.contains('dnd-dragging')).toBe(false);
    });

});

