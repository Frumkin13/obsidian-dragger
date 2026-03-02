// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
    getMainContentLineElementForLine,
    getMainContentLineRectForLine,
} from './line-dom';

function createRect(left: number, top: number, width: number, height: number): DOMRect {
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
    } as DOMRect;
}

describe('line-dom', () => {
    it('resolves line element by scanning visible .cm-line nodes', () => {
        const state = EditorState.create({ doc: 'a\nb\nc' });
        const content = document.createElement('div');
        const line1 = document.createElement('div');
        line1.className = 'cm-line';
        const line2 = document.createElement('div');
        line2.className = 'cm-line';
        const line3 = document.createElement('div');
        line3.className = 'cm-line';
        content.append(line1, line2, line3);

        const view = {
            state,
            contentDOM: content,
            posAtDOM: (node: Node) => {
                if (node === line1) return state.doc.line(1).from;
                if (node === line2) return state.doc.line(2).from;
                if (node === line3) return state.doc.line(3).from;
                throw new Error('unknown node');
            },
        } as unknown as EditorView;

        expect(getMainContentLineElementForLine(view, 2)).toBe(line2);
    });

    it('falls back to domAtPos when scan path is unavailable', () => {
        const state = EditorState.create({ doc: 'a\nb\nc' });
        const content = document.createElement('div');
        const line2 = document.createElement('div');
        line2.className = 'cm-line';
        const textNode = document.createTextNode('b');
        line2.appendChild(textNode);
        content.appendChild(line2);

        const view = {
            state,
            contentDOM: content,
            domAtPos: () => ({ node: textNode, offset: 0 }),
        } as unknown as EditorView;

        expect(getMainContentLineElementForLine(view, 2)).toBe(line2);
    });

    it('returns null rect when line element has no measurable height', () => {
        const state = EditorState.create({ doc: 'a' });
        const content = document.createElement('div');
        const line = document.createElement('div');
        line.className = 'cm-line';
        content.appendChild(line);
        Object.defineProperty(line, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 100, 0),
        });

        const view = {
            state,
            contentDOM: content,
            posAtDOM: () => state.doc.line(1).from,
        } as unknown as EditorView;

        expect(getMainContentLineRectForLine(view, 1)).toBeNull();
    });
});


