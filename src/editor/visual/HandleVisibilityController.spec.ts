// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { BlockInfo, BlockType } from '../../types';
import { DRAG_SOURCE_LINE_CLASS } from '../core/selectors';
import { HandleVisibilityController } from './HandleVisibilityController';

function createBlock(startLine: number, endLine: number, composite?: Array<{ startLine: number; endLine: number }>): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine,
        endLine,
        from: 0,
        to: 0,
        indentLevel: 0,
        content: '',
        compositeSelection: composite ? { ranges: composite } : undefined,
    };
}

function createViewStub(lineCount = 8): { view: EditorView; lines: HTMLElement[] } {
    const root = document.createElement('div');
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);

    const texts = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`);
    const state = EditorState.create({ doc: texts.join('\n') });
    const lineEls: HTMLElement[] = [];
    for (const text of texts) {
        const lineEl = document.createElement('div');
        lineEl.className = 'cm-line';
        lineEl.textContent = text;
        content.appendChild(lineEl);
        lineEls.push(lineEl);
    }

    const posToLineIndex = new Map<number, number>();
    for (let i = 1; i <= state.doc.lines; i++) {
        posToLineIndex.set(state.doc.line(i).from, i - 1);
    }

    const view = {
        dom: root,
        contentDOM: content,
        state,
        domAtPos: (pos: number) => {
            const lineIndex = posToLineIndex.get(pos) ?? 0;
            const node = lineEls[Math.max(0, Math.min(lineEls.length - 1, lineIndex))] ?? content;
            return { node, offset: 0 };
        },
    } as unknown as EditorView;

    return { view, lines: lineEls };
}

describe('HandleVisibilityController', () => {
    it('applies and clears drag-source line class for a single block range', () => {
        const { view, lines } = createViewStub(6);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getDraggableBlockAtPoint: () => null,
        });

        controller.enterGrabVisualStateForBlock(createBlock(1, 2), null);

        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[0].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);

        controller.clearGrabbedLineNumbers();

        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
    });

    it('highlights disjoint composite ranges without filling the gap', () => {
        const { view, lines } = createViewStub(7);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getDraggableBlockAtPoint: () => null,
        });

        controller.enterGrabVisualStateForBlock(
            createBlock(0, 5, [
                { startLine: 0, endLine: 0 },
                { startLine: 3, endLine: 4 },
            ]),
            null
        );

        expect(lines[0].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[4].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[5].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
    });

    it('re-applies drag-source class on refresh when grab state is active', () => {
        const { view, lines } = createViewStub(5);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getDraggableBlockAtPoint: () => null,
        });

        controller.enterGrabVisualStateForBlock(createBlock(2, 2), null);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);

        lines[2].classList.remove(DRAG_SOURCE_LINE_CLASS);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);

        controller.refreshGrabVisualState();
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
    });
});
