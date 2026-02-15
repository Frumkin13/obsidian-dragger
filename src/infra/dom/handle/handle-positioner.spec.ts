// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import {
    getHandleColumnCenterX,
    getHandleTopPxForLine,
    setHandleHorizontalOffsetPx,
    viewportXToEditorLocalX,
    viewportYToEditorLocalY,
} from './handle-positioner';
import { setAlignToLineNumber } from '../../../shared/constants';

type RectLike = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
    toJSON: () => Record<string, never>;
};

function createRect(left: number, top: number, width: number, height: number): RectLike {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    };
}

function setRect(el: HTMLElement, left: number, top: number, width: number, height: number): void {
    Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(left, top, width, height),
    });
}

afterEach(() => {
    setHandleHorizontalOffsetPx(0);
    setAlignToLineNumber(true);
    document.body.innerHTML = '';
});

describe('handle-position', () => {
    it('anchors to the current editor line-number gutter and centers inside gutterElement paddings', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';

        const nestedEditor = document.createElement('div');
        nestedEditor.className = 'cm-editor';
        const nestedGutter = document.createElement('div');
        nestedGutter.className = 'cm-gutter cm-lineNumbers';
        const nestedRow = document.createElement('div');
        nestedRow.className = 'cm-gutterElement';
        nestedRow.textContent = '1';
        nestedGutter.appendChild(nestedRow);
        nestedEditor.appendChild(nestedGutter);
        root.appendChild(nestedEditor);

        const scroller = document.createElement('div');
        scroller.className = 'cm-scroller';
        const gutters = document.createElement('div');
        gutters.className = 'cm-gutters';
        const mainGutter = document.createElement('div');
        mainGutter.className = 'cm-gutter cm-lineNumbers';
        const mainRow = document.createElement('div');
        mainRow.className = 'cm-gutterElement';
        mainRow.textContent = '7';
        mainRow.setCssStyles({
            paddingLeft: '12px',
            paddingRight: '4px',
        });
        mainGutter.appendChild(mainRow);
        gutters.appendChild(mainGutter);
        scroller.appendChild(gutters);
        root.appendChild(scroller);

        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 220);
        setRect(content, 80, 0, 280, 220);
        setRect(nestedGutter, 10, 0, 30, 220);
        setRect(nestedRow, 10, 20, 30, 20);
        setRect(mainGutter, 96, 0, 52, 220);
        setRect(mainRow, 100, 20, 40, 20);

        const view = {
            dom: root,
            contentDOM: content,
        } as unknown as EditorView;

        expect(getHandleColumnCenterX(view)).toBeCloseTo(124, 3);
        setHandleHorizontalOffsetPx(6);
        expect(getHandleColumnCenterX(view)).toBeCloseTo(130, 3);
    });

    it('converts viewport coordinates into local editor coordinates with scale and client border', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        setRect(root, 100, 50, 200, 160);

        Object.defineProperty(root, 'offsetWidth', { configurable: true, value: 100 });
        Object.defineProperty(root, 'offsetHeight', { configurable: true, value: 80 });
        Object.defineProperty(root, 'clientLeft', { configurable: true, value: 3 });
        Object.defineProperty(root, 'clientTop', { configurable: true, value: 5 });

        const view = { dom: root } as unknown as EditorView;
        expect(viewportXToEditorLocalX(view, 140)).toBeCloseTo(17, 6);
        expect(viewportYToEditorLocalY(view, 90)).toBeCloseTo(15, 6);
    });

    it('anchors handle Y by target gutter line number instead of coordsAtPos proximity', () => {
        const state = EditorState.create({ doc: 'first\n---\nthird' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        const gutter = document.createElement('div');
        gutter.className = 'cm-gutter cm-lineNumbers';
        const row1 = document.createElement('div');
        row1.className = 'cm-gutterElement';
        row1.textContent = '1';
        const row2 = document.createElement('div');
        row2.className = 'cm-gutterElement';
        row2.textContent = '2';
        const row3 = document.createElement('div');
        row3.className = 'cm-gutterElement';
        row3.textContent = '3';
        gutter.appendChild(row1);
        gutter.appendChild(row2);
        gutter.appendChild(row3);
        root.appendChild(gutter);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 80, 0, 300, 240);
        setRect(gutter, 20, 0, 40, 240);
        setRect(row1, 20, 10, 40, 20);
        setRect(row2, 20, 50, 40, 20);
        setRect(row3, 20, 90, 40, 20);

        const line2 = state.doc.line(2);
        const view = {
            state,
            dom: root,
            contentDOM: content,
            coordsAtPos: (pos: number) => {
                // Simulate a bad DOM mapping for line 2 (e.g. hr render overlay):
                // coords falls near line 1 although target line is 2.
                if (pos === line2.from) {
                    return createRect(100, 12, 10, 16) as unknown as DOMRect;
                }
                return createRect(100, 52, 10, 16) as unknown as DOMRect;
            },
        } as unknown as EditorView;

        const top = getHandleTopPxForLine(view, 2);
        expect(top).toBe(52);
    });

    it('resolves gutter row by rendered line mapping when gutter text is unavailable', () => {
        const state = EditorState.create({ doc: 'first\n---\nthird' });

        const root = document.createElement('div');
        root.className = 'cm-editor';
        const content = document.createElement('div');
        content.className = 'cm-content';
        const line1 = document.createElement('div');
        line1.className = 'cm-line';
        const line2 = document.createElement('div');
        line2.className = 'cm-line';
        const line3 = document.createElement('div');
        line3.className = 'cm-line';
        content.append(line1, line2, line3);
        root.appendChild(content);

        const gutter = document.createElement('div');
        gutter.className = 'cm-gutter cm-lineNumbers';
        const row1 = document.createElement('div');
        row1.className = 'cm-gutterElement';
        const row2 = document.createElement('div');
        row2.className = 'cm-gutterElement';
        const row3 = document.createElement('div');
        row3.className = 'cm-gutterElement';
        gutter.append(row1, row2, row3);
        root.appendChild(gutter);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 80, 0, 300, 240);
        setRect(gutter, 20, 0, 40, 240);
        setRect(row1, 20, 10, 40, 20);
        setRect(row2, 20, 50, 40, 20);
        setRect(row3, 20, 90, 40, 20);
        setRect(line1, 80, 10, 300, 20);
        setRect(line2, 80, 50, 300, 20);
        setRect(line3, 80, 90, 300, 20);

        const view = {
            state,
            dom: root,
            contentDOM: content,
            posAtDOM: (node: Node) => {
                if (node === line1) return state.doc.line(1).from;
                if (node === line2) return state.doc.line(2).from;
                if (node === line3) return state.doc.line(3).from;
                throw new Error('unknown node');
            },
            coordsAtPos: () => createRect(100, 12, 10, 16) as unknown as DOMRect,
        } as unknown as EditorView;

        const top = getHandleTopPxForLine(view, 2);
        expect(top).toBe(52);
    });
});
