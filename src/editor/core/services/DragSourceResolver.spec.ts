// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DragSourceResolver } from './DragSourceResolver';
import { BlockType } from '../../../types';

const originalElementFromPoint = (document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
}).elementFromPoint;

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

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: originalElementFromPoint,
    });
});

describe('DragSourceResolver', () => {
    it('prefers DOM position over stale handle data attributes', () => {
        const state = EditorState.create({
            doc: 'alpha\nbeta\n- item\ngamma',
        });
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '0');

        const view = {
            state,
            posAtDOM: (node: Node) => {
                if (node === handle) {
                    return state.doc.line(3).from;
                }
                throw new Error('unexpected node');
            },
        } as unknown as EditorView;

        const resolver = new DragSourceResolver(view);
        const block = resolver.getBlockInfoForHandle(handle);
        expect(block).not.toBeNull();
        expect(block?.startLine).toBe(2);
        expect(block?.content).toContain('- item');
    });

    it('falls back to data attributes when DOM lookup fails', () => {
        const state = EditorState.create({
            doc: 'first\nsecond\nthird',
        });
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '1');

        const view = {
            state,
            posAtDOM: () => {
                throw new Error('dom lookup failed');
            },
        } as unknown as EditorView;

        const resolver = new DragSourceResolver(view);
        const block = resolver.getBlockInfoForHandle(handle);
        expect(block).not.toBeNull();
        expect(block?.startLine).toBe(1);
        expect(block?.content).toContain('second');
    });

    it('prefers bound handle line for horizontal rule when DOM resolves to an adjacent line', () => {
        const state = EditorState.create({
            doc: 'alpha\n---\nbeta',
        });
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '1');

        const view = {
            state,
            posAtDOM: (node: Node) => {
                if (node === handle) {
                    return state.doc.line(3).from;
                }
                throw new Error('unexpected node');
            },
        } as unknown as EditorView;

        const resolver = new DragSourceResolver(view);
        const block = resolver.getBlockInfoForHandle(handle);
        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.HorizontalRule);
        expect(block?.startLine).toBe(1);
        expect(block?.content).toBe('---');
    });

    it('returns null when point lookup hits transient layout-read guard', () => {
        const state = EditorState.create({
            doc: 'alpha\nbeta\ngamma',
        });
        const view = {
            state,
            contentDOM: {
                getBoundingClientRect: () => ({
                    left: 0,
                    top: 0,
                    right: 300,
                    bottom: 120,
                }),
            },
            posAtCoords: () => {
                throw new Error("Reading the editor layout isn't allowed during an update");
            },
        } as unknown as EditorView;

        const resolver = new DragSourceResolver(view);
        const block = resolver.getDraggableBlockAtPoint(20, 30);
        expect(block).toBeNull();
    });

    it('resolves rendered callout block from embed hit before coordinate fallback', () => {
        const state = EditorState.create({
            doc: '> [!note] title\n> body\nafter',
        });
        const root = document.createElement('div');
        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);
        const embed = document.createElement('div');
        embed.className = 'cm-callout';
        root.appendChild(embed);

        Object.defineProperty(root, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 360, 220),
        });
        Object.defineProperty(content, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 340, 180),
        });
        Object.defineProperty(embed, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(40, 50, 220, 60),
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn(() => embed),
        });

        const view = {
            state,
            dom: root,
            contentDOM: content,
            posAtCoords: () => state.doc.line(3).from,
            posAtDOM: (node: Node) => {
                if (node === embed) {
                    return state.doc.line(1).from;
                }
                throw new Error('unexpected node');
            },
        } as unknown as EditorView;

        const resolver = new DragSourceResolver(view);
        const block = resolver.getDraggableBlockAtPoint(110, 76);
        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.Callout);
        expect(block?.startLine).toBe(0);
        expect(block?.endLine).toBe(1);
    });

    it('resolves rendered latex block when elementFromPoint misses but viewport fallback finds embed', () => {
        const state = EditorState.create({
            doc: '$$\nx^2\n$$\nafter',
        });
        const root = document.createElement('div');
        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);
        const math = document.createElement('div');
        math.className = 'MathJax';
        root.appendChild(math);

        Object.defineProperty(root, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 360, 260),
        });
        Object.defineProperty(content, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 340, 200),
        });
        Object.defineProperty(math, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(36, 90, 240, 52),
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn(() => null),
        });

        const view = {
            state,
            dom: root,
            contentDOM: content,
            posAtCoords: () => state.doc.line(4).from,
            posAtDOM: (node: Node) => {
                if (node === math) {
                    return state.doc.line(2).from;
                }
                throw new Error('unexpected node');
            },
        } as unknown as EditorView;

        const resolver = new DragSourceResolver(view);
        const block = resolver.getDraggableBlockAtPoint(120, 102);
        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.MathBlock);
        expect(block?.startLine).toBe(0);
        expect(block?.endLine).toBe(2);
    });
});
