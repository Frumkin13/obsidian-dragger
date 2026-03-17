// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getHandleColumnCenterX } from './handle-positioner';
import { getLineNumberElementForLine } from './line-number-gutter';
import { viewportXToEditorLocalX, viewportYToEditorLocalY } from '../../selection/editor-local-coordinates';
import { setHandleHorizontalOffsetPx } from '../../../shared/constants';
import {
    HANDLE_GUTTER_CLASS,
    HANDLE_GUTTER_MARKER_CLASS,
} from '../../../shared/dom-selectors';

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

function resetHandleConfigForTest(): void {
    setHandleHorizontalOffsetPx(0);
}

beforeEach(() => {
    resetHandleConfigForTest();
});

afterEach(() => {
    resetHandleConfigForTest();
    document.body.innerHTML = '';
});

describe('handle-position', () => {
    it('anchors to the current editor custom handle gutter center', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';

        const nestedEditor = document.createElement('div');
        nestedEditor.className = 'cm-editor';
        const nestedGutter = document.createElement('div');
        nestedGutter.className = `cm-gutter ${HANDLE_GUTTER_CLASS}`;
        const nestedMarker = document.createElement('div');
        nestedMarker.className = HANDLE_GUTTER_MARKER_CLASS;
        nestedMarker.setAttribute('data-line-number', '1');
        nestedGutter.appendChild(nestedMarker);
        nestedEditor.appendChild(nestedGutter);
        root.appendChild(nestedEditor);

        const scroller = document.createElement('div');
        scroller.className = 'cm-scroller';
        const gutters = document.createElement('div');
        gutters.className = 'cm-gutters';
        const handleGutter = document.createElement('div');
        handleGutter.className = `cm-gutter ${HANDLE_GUTTER_CLASS}`;
        const marker = document.createElement('div');
        marker.className = HANDLE_GUTTER_MARKER_CLASS;
        marker.setAttribute('data-line-number', '1');
        handleGutter.appendChild(marker);
        gutters.appendChild(handleGutter);
        scroller.appendChild(gutters);
        root.appendChild(scroller);

        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 220);
        setRect(content, 80, 0, 280, 220);
        setRect(nestedGutter, 10, 0, 30, 220);
        setRect(nestedMarker, 10, 20, 30, 20);
        setRect(handleGutter, 96, 0, 52, 220);
        setRect(marker, 104, 20, 40, 20);

        const view = {
            dom: root,
            contentDOM: content,
        } as unknown as EditorView;

        expect(getHandleColumnCenterX(view)).toBeCloseTo(124, 3);
        setHandleHorizontalOffsetPx(6);
        expect(getHandleColumnCenterX(view)).toBeCloseTo(130, 3);
    });

    it('prefers custom handle gutter center when available', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';
        const customGutter = document.createElement('div');
        customGutter.className = `cm-gutter ${HANDLE_GUTTER_CLASS}`;
        const marker = document.createElement('div');
        marker.className = HANDLE_GUTTER_MARKER_CLASS;
        marker.setAttribute('data-line-number', '1');
        customGutter.appendChild(marker);
        root.appendChild(customGutter);
        const lineNumberGutter = document.createElement('div');
        lineNumberGutter.className = 'cm-gutter cm-lineNumbers';
        root.appendChild(lineNumberGutter);
        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 200);
        setRect(content, 120, 0, 260, 200);
        setRect(customGutter, 40, 0, 24, 200);
        setRect(marker, 42, 20, 20, 20);
        setRect(lineNumberGutter, 70, 0, 40, 200);

        const view = {
            dom: root,
            contentDOM: content,
        } as unknown as EditorView;

        expect(getHandleColumnCenterX(view)).toBeCloseTo(52, 3);
        setHandleHorizontalOffsetPx(5);
        expect(getHandleColumnCenterX(view)).toBeCloseTo(57, 3);
    });

    it('uses zero-width handle gutter as x baseline when the gutter itself is zero-width', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';
        const customGutter = document.createElement('div');
        customGutter.className = `cm-gutter ${HANDLE_GUTTER_CLASS}`;
        const marker = document.createElement('div');
        marker.className = HANDLE_GUTTER_MARKER_CLASS;
        marker.setAttribute('data-line-number', '1');
        customGutter.appendChild(marker);
        root.appendChild(customGutter);
        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 200);
        setRect(content, 120, 0, 260, 200);
        setRect(customGutter, 40, 0, 0, 200);
        setRect(marker, 40, 20, 0, 20);

        const view = {
            dom: root,
            contentDOM: content,
        } as unknown as EditorView;

        expect(getHandleColumnCenterX(view)).toBeCloseTo(40, 3);
        setHandleHorizontalOffsetPx(6);
        expect(getHandleColumnCenterX(view)).toBeCloseTo(46, 3);
    });

    it('uses the handle gutter center when the handle gutter is on the right side', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';

        const beforeGutters = document.createElement('div');
        beforeGutters.className = 'cm-gutters cm-gutters-before';
        const lineNumberGutter = document.createElement('div');
        lineNumberGutter.className = 'cm-gutter cm-lineNumbers';
        const lineNumberRow = document.createElement('div');
        lineNumberRow.className = 'cm-gutterElement';
        lineNumberRow.textContent = '1';
        lineNumberGutter.appendChild(lineNumberRow);
        beforeGutters.appendChild(lineNumberGutter);
        root.appendChild(beforeGutters);

        const afterGutters = document.createElement('div');
        afterGutters.className = 'cm-gutters cm-gutters-after';
        const handleGutter = document.createElement('div');
        handleGutter.className = `cm-gutter ${HANDLE_GUTTER_CLASS}`;
        const marker = document.createElement('div');
        marker.className = HANDLE_GUTTER_MARKER_CLASS;
        marker.setAttribute('data-line-number', '1');
        handleGutter.appendChild(marker);
        afterGutters.appendChild(handleGutter);
        root.appendChild(afterGutters);

        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 200);
        setRect(content, 120, 0, 260, 200);
        setRect(beforeGutters, 0, 0, 48, 200);
        setRect(lineNumberGutter, 0, 0, 48, 200);
        setRect(lineNumberRow, 4, 20, 40, 20);
        setRect(afterGutters, 360, 0, 24, 200);
        setRect(handleGutter, 360, 0, 24, 200);
        setRect(marker, 362, 20, 20, 20);

        const view = {
            dom: root,
            contentDOM: content,
            state: EditorState.create({ doc: 'line 1' }),
        } as unknown as EditorView;

        expect(getHandleColumnCenterX(view)).toBeCloseTo(372, 3);
    });

    it('falls back by probe-matched handle row even when gutter row attrs are stale', () => {
        const state = EditorState.create({ doc: 'first\nsecond\nthird' });
        const root = document.createElement('div');
        root.className = 'cm-editor';
        const customGutter = document.createElement('div');
        customGutter.className = `cm-gutter ${HANDLE_GUTTER_CLASS}`;
        const customRow1 = document.createElement('div');
        customRow1.className = `cm-gutterElement ${HANDLE_GUTTER_MARKER_CLASS}`;
        customRow1.setAttribute('data-line-number', '2');
        const probe1 = document.createElement('span');
        probe1.className = 'dnd-handle-gutter-probe';
        probe1.setAttribute('data-line-number', '1');
        customRow1.appendChild(probe1);
        const customRow2 = document.createElement('div');
        customRow2.className = `cm-gutterElement ${HANDLE_GUTTER_MARKER_CLASS}`;
        customRow2.setAttribute('data-line-number', '1');
        const probe2 = document.createElement('span');
        probe2.className = 'dnd-handle-gutter-probe';
        probe2.setAttribute('data-line-number', '2');
        customRow2.appendChild(probe2);
        const customRow3 = document.createElement('div');
        customRow3.className = `cm-gutterElement ${HANDLE_GUTTER_MARKER_CLASS}`;
        customRow3.setAttribute('data-line-number', '3');
        const probe3 = document.createElement('span');
        probe3.className = 'dnd-handle-gutter-probe';
        probe3.setAttribute('data-line-number', '3');
        customRow3.appendChild(probe3);
        customGutter.append(customRow1, customRow2, customRow3);
        root.appendChild(customGutter);

        const lineNumberGutter = document.createElement('div');
        lineNumberGutter.className = 'cm-gutter cm-lineNumbers';
        const row1 = document.createElement('div');
        row1.className = 'cm-gutterElement';
        row1.textContent = '1';
        const row2 = document.createElement('div');
        row2.className = 'cm-gutterElement';
        row2.textContent = '99';
        const row3 = document.createElement('div');
        row3.className = 'cm-gutterElement';
        row3.textContent = '3';
        lineNumberGutter.append(row1, row2, row3);
        root.appendChild(lineNumberGutter);

        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);

        setRect(root, 0, 0, 400, 240);
        setRect(content, 120, 0, 260, 240);
        setRect(customGutter, 40, 0, 0, 240);
        setRect(customRow1, 40, 10, 0, 20);
        setRect(customRow2, 40, 50, 0, 32);
        setRect(customRow3, 40, 100, 0, 20);
        setRect(lineNumberGutter, 96, 0, 48, 240);
        setRect(row1, 100, 10, 40, 20);
        setRect(row2, 100, 50, 40, 32);
        setRect(row3, 100, 100, 40, 20);

        const view = {
            state,
            dom: root,
            contentDOM: content,
        } as unknown as EditorView;

        expect(getLineNumberElementForLine(view, 2)).toBe(row2);
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
});
