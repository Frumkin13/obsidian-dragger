// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockType, type BlockInfo } from '../../../core/block/block-types';
import { setHandleHorizontalOffsetPx, setHandleSizePx } from '../../../shared/constants';
import { LineHandleManager } from './line-handle-manager';

vi.mock('../../../core/block/block-factory', () => ({
    detectBlock: vi.fn(),
    getListItemOwnRangeForHandle: vi.fn(() => null),
}));

vi.mock('./handle-gutter', () => ({
    getHandleGutterElementForLine: vi.fn(),
}));

import { detectBlock } from '../../../core/block/block-factory';
import { getHandleGutterElementForLine } from './handle-gutter';

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
    setHandleHorizontalOffsetPx(-8);
    setHandleSizePx(16);
});

describe('LineHandleManager', () => {
    it('mounts gutter-bound handles using the configured constant offset', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);

        const gutterRow = document.createElement('div');

        const view = {
            dom: root,
            state: EditorState.create({ doc: 'alpha' }),
            visibleRanges: [{ from: 0, to: 5 }],
        } as unknown as EditorView;

        const handle = document.createElement('div');
        const block = createBlock();

        setHandleHorizontalOffsetPx(10);
        setHandleSizePx(20);
        vi.mocked(detectBlock).mockReturnValue(block);
        vi.mocked(getHandleGutterElementForLine).mockReturnValue(gutterRow);

        const manager = new LineHandleManager(view, {
            createHandleElement: () => handle,
            getDraggableBlockAtLine: () => block,
        });

        manager.rescan();

        expect(handle.parentElement).toBe(gutterRow);
        expect(handle.style.left).toBe('0px');
        expect(handle.style.top).toBe('0px');
        expect(handle.style.height).toBe('');
    });
});
