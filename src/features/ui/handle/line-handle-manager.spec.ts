// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockType, type BlockInfo } from '../../../core/block/block-types';
import { LineHandleManager } from './line-handle-manager';

vi.mock('../../../core/block/block-factory', () => ({
    detectBlock: vi.fn(),
    getListItemOwnRangeForHandle: vi.fn(() => null),
}));

vi.mock('./handle-gutter', () => ({
    getHandleGutterElementForLine: vi.fn(),
}));

vi.mock('./handle-positioner', () => ({
    getHandleLeftPxForLine: vi.fn(),
}));

import { detectBlock } from '../../../core/block/block-factory';
import { getHandleGutterElementForLine } from './handle-gutter';
import { getHandleLeftPxForLine } from './handle-positioner';

function createRect(left: number, top: number, width: number, height: number): DOMRect {
    return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
    } as DOMRect;
}

function createBlock(): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine: 0,
        endLine: 0,
        from: 0,
        to: 5,
        indentLevel: 0,
        content: 'alpha',
    };
}

afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
});

describe('LineHandleManager', () => {
    it('mounts gutter-bound handles with the same height as the matched gutter row', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);

        const gutterRow = document.createElement('div');
        Object.defineProperty(gutterRow, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(100, 20, 0, 28),
        });

        const view = {
            dom: root,
            state: EditorState.create({ doc: 'alpha' }),
            visibleRanges: [{ from: 0, to: 5 }],
        } as unknown as EditorView;

        const handle = document.createElement('div');
        const block = createBlock();

        vi.mocked(detectBlock).mockReturnValue(block);
        vi.mocked(getHandleGutterElementForLine).mockReturnValue(gutterRow);
        vi.mocked(getHandleLeftPxForLine).mockReturnValue(96);

        const manager = new LineHandleManager(view, {
            createHandleElement: () => handle,
            getDraggableBlockAtLine: () => block,
        });

        manager.rescan();

        expect(handle.parentElement).toBe(gutterRow);
        expect(handle.style.left).toBe('-4px');
        expect(handle.style.top).toBe('0px');
        expect(handle.style.height).toBe('28px');
    });
});
