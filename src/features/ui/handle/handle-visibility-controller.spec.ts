// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { BlockInfo, BlockType } from '../../../core/block/block-types';
import {
    DRAG_SOURCE_LINE_CLASS,
    DRAG_SOURCE_LINE_SINGLE_CLASS,
    DRAG_SOURCE_LINE_FIRST_CLASS,
    DRAG_SOURCE_LINE_MIDDLE_CLASS,
    DRAG_SOURCE_LINE_LAST_CLASS,
    DRAG_SOURCE_EMBED_CLASS,
} from '../../../shared/dom-selectors';
import { HandleVisibilityController } from './handle-visibility-controller';

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
        posAtDOM: (node: Node) => {
            const lineIndex = lineEls.findIndex((lineEl) => lineEl === node || lineEl.contains(node));
            if (lineIndex >= 0) {
                return state.doc.line(lineIndex + 1).from;
            }
            throw new Error('unknown node');
        },
    } as unknown as EditorView;

    return { view, lines: lineEls };
}

describe('HandleVisibilityController', () => {
    it('applies contiguous drag-source variant classes for a block range', () => {
        const { view, lines } = createViewStub(6);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getDraggableBlockAtPoint: () => null,
        });

        controller.enterGrabVisualStateForBlock(createBlock(1, 3), null);

        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_FIRST_CLASS)).toBe(true);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_MIDDLE_CLASS)).toBe(true);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_LAST_CLASS)).toBe(true);
        expect(lines[0].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[4].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);

        controller.clearGrabbedLineNumbers();

        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_FIRST_CLASS)).toBe(false);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_MIDDLE_CLASS)).toBe(false);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_LAST_CLASS)).toBe(false);
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
        expect(lines[0].classList.contains(DRAG_SOURCE_LINE_SINGLE_CLASS)).toBe(true);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_FIRST_CLASS)).toBe(true);
        expect(lines[4].classList.contains(DRAG_SOURCE_LINE_LAST_CLASS)).toBe(true);
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
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_SINGLE_CLASS)).toBe(true);

        lines[2].classList.remove(DRAG_SOURCE_LINE_CLASS, DRAG_SOURCE_LINE_SINGLE_CLASS);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_SINGLE_CLASS)).toBe(false);

        controller.refreshGrabVisualState();
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_SINGLE_CLASS)).toBe(true);
    });

    it('applies and clears drag-source class on rendered embed block for selected range', () => {
        const { view } = createViewStub(6);
        const embed = document.createElement('div');
        embed.className = 'cm-callout';
        view.dom.appendChild(embed);

        const originalPosAtDOM = view.posAtDOM.bind(view);
        (view as unknown as { posAtDOM: (node: Node, offset?: number) => number }).posAtDOM = (node: Node, offset?: number) => {
            if (node === embed || embed.contains(node)) {
                return view.state.doc.line(3).from;
            }
            return originalPosAtDOM(node, offset);
        };

        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getDraggableBlockAtPoint: () => null,
        });

        controller.enterGrabVisualStateForBlock(createBlock(2, 2), null);
        expect(embed.classList.contains(DRAG_SOURCE_EMBED_CLASS)).toBe(true);

        controller.clearGrabbedLineNumbers();
        expect(embed.classList.contains(DRAG_SOURCE_EMBED_CLASS)).toBe(false);
    });
});



