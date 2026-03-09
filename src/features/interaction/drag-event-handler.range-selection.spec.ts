// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../core/block/block-types';
import { DragEventHandler } from '../interaction/drag-event-handler';
import {
    registerMouseHandlerTestHooks,
    createBlock,
    createViewStub,
    appendHandleForBlockStart,
    appendHandleGutterMarker,
    dispatchPointer,
    createRect,
} from '../interaction/drag-event-handler.test-helpers';

registerMouseHandlerTestHooks();

describe('DragEventHandler Range Selection', () => {
    it('supports mouse two-stage flow: first select range, then long-press selected bar to drag', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const finishDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const hideDropIndicator = vi.fn();
        const performDropAtPoint = vi.fn();
        const endBlock = createBlock('line 6', 5, 5);

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: (_x, y) => (y >= 100 ? endBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession,
            scheduleDropIndicatorUpdate,
            hideDropIndicator,
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);

        dispatchPointer(window, 'pointermove', {
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 7,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        dispatchPointer(link!, 'pointerdown', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 80,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 105,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(selectedBlock.startLine).toBe(1);
        expect(selectedBlock.endLine).toBe(5);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 105, expect.objectContaining({
            startLine: 1,
            endLine: 5,
        }), 'mouse');
        dispatchPointer(window, 'pointerup', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 105,
        });

        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        expect(handle.getAttribute('draggable')).toBe('true');
        handler.destroy();
    });

    it('keeps content text unhighlighted after committing multi-block selection', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 72,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 72,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 72,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        expect(link?.classList.contains('is-active')).toBe(true);
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        handler.destroy();
    });

    it('anchors committed range link to block handles for multi-line end blocks', () => {
        const view = createViewStub([
            'line 1',
            'anchor',
            'line 3',
            'line 4',
            '```ts',
            'const value = 1',
            '```',
            'tail',
        ]);
        const anchorHandle = appendHandleForBlockStart(view, 1, () => 22, 1);
        const codeBlockHandle = appendHandleForBlockStart(view, 4, () => 82, 6);

        const sourceBlock = createBlock('anchor', 1, 1);
        const codeBlock = createBlock('```ts', 4, 6);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: (handle) => {
                if (handle === anchorHandle) return sourceBlock;
                if (handle === codeBlockHandle) return codeBlock;
                return null;
            },
            getBlockInfoAtPoint: (_x, y) => (y >= 110 ? codeBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(anchorHandle, 'pointerdown', {
            pointerId: 73,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 73,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 125,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 73,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 125,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 73,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 125,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        expect(link?.classList.contains('is-active')).toBe(true);
        expect(Number(link?.style.top.replace('px', '') || '0')).toBeCloseTo(10, 2);
        expect(Number(link?.style.height.replace('px', '') || '0')).toBeCloseTo(60, 2);
        handler.destroy();
    });

    it('keeps committed range link active as a single endpoint when end handle is missing', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1, () => 22);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('- end', 5, 5);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: (_x, y) => (y >= 160 ? endBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 74,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 74,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 182,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 74,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 182,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        expect(link?.classList.contains('is-active')).toBe(true);
        expect(Number(link?.style.height.replace('px', '') || '0')).toBeCloseTo(2, 1);
        handler.destroy();
    });

    it('does not use gutter marker as anchor when endpoint handle is unavailable', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1, () => 22);
        appendHandleGutterMarker(view, 6, () => 100);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('- end', 5, 5);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: (_x, y) => (y >= 100 ? endBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 76,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 76,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 112,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 76,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 112,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        expect(link?.classList.contains('is-active')).toBe(true);
        expect(Number(link?.style.height.replace('px', '') || '0')).toBeCloseTo(2, 1);
        handler.destroy();
    });

    it('requires second long-press before dragging committed mouse selection', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 70,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 70,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 70,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();

        dispatchPointer(link!, 'pointerdown', {
            pointerId: 71,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 80,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 71,
            pointerType: 'mouse',
            clientX: 13,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(0);
        expect(scheduleDropIndicatorUpdate).not.toHaveBeenCalled();

        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 71,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 80, expect.any(Object), 'mouse');
        handler.destroy();
    });

    it('supports immediate handle-slide deselection in committed multi-select mode', () => {
        const view = createViewStub(8);
        const startHandle = appendHandleForBlockStart(view, 1);
        const endHandle = appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: (handle) => (handle === endHandle ? endBlock : sourceBlock),
            getBlockInfoAtPoint: (_x, y) => (y >= 100 ? endBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(startHandle, 'pointerdown', {
            pointerId: 171,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 171,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 171,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const committedLink = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link.is-active');
        expect(committedLink).not.toBeNull();

        dispatchPointer(endHandle, 'pointerdown', {
            pointerId: 172,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 172,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 172,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(view.dom.querySelector('.dnd-range-selection-link.is-active')).toBeNull();
        handler.destroy();
    });

    it('prioritizes long-press drag over toggle when pressing a selected handle', () => {
        const view = createViewStub(8);
        const startHandle = appendHandleForBlockStart(view, 1);
        const endHandle = appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: (handle) => (handle === endHandle ? endBlock : sourceBlock),
            getBlockInfoAtPoint: (_x, y) => (y >= 100 ? endBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(startHandle, 'pointerdown', {
            pointerId: 181,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 181,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 181,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const committedLink = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link.is-active');
        expect(committedLink).not.toBeNull();

        dispatchPointer(endHandle, 'pointerdown', {
            pointerId: 182,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 182,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 105,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(selectedBlock.startLine).toBe(1);
        expect(selectedBlock.endLine).toBe(5);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 105, expect.objectContaining({
            startLine: 1,
            endLine: 5,
        }), 'mouse');
        handler.destroy();
    });

    it('does not toggle selection when long-pressing selected handle without movement', () => {
        const view = createViewStub(8);
        const startHandle = appendHandleForBlockStart(view, 1);
        const endHandle = appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: (handle) => (handle === endHandle ? endBlock : sourceBlock),
            getBlockInfoAtPoint: (_x, y) => (y >= 100 ? endBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(startHandle, 'pointerdown', {
            pointerId: 191,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 191,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 191,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const committedLinkBefore = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link.is-active');
        expect(committedLinkBefore).not.toBeNull();

        dispatchPointer(endHandle, 'pointerdown', {
            pointerId: 192,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointerup', {
            pointerId: 192,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        const committedLinkAfter = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link.is-active');
        expect(committedLinkAfter).not.toBeNull();
        handler.destroy();
    });

    it('falls back to point-based source resolution when handle mapping is stale', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 4);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => null,
            getBlockInfoAtPoint: () => sourceBlock,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 75,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 75,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 75,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        expect(link?.classList.contains('is-active')).toBe(true);
        handler.destroy();
    });

    it('uses unified touch long-press drag flow for handle interactions', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const finishDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const hideDropIndicator = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession,
            scheduleDropIndicatorUpdate,
            hideDropIndicator,
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 17,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(260);

        dispatchPointer(window, 'pointermove', {
            pointerId: 17,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 17,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        beginPointerDragSession.mockClear();
        performDropAtPoint.mockClear();
        finishDragSession.mockClear();
        scheduleDropIndicatorUpdate.mockClear();

        dispatchPointer(handle, 'pointerdown', {
            pointerId: 18,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(940);
        dispatchPointer(window, 'pointermove', {
            pointerId: 18,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 18,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(selectedBlock.startLine).toBe(1);
        expect(selectedBlock.endLine).toBe(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(12, 105, expect.objectContaining({
            startLine: 1,
            endLine: 1,
        }), 'touch');
        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        expect(handle.getAttribute('draggable')).toBe('true');
        handler.destroy();
    });

    it('keeps mobile handle long-press duration aligned with drag flow', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const performDropAtPoint = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            getMultiLineSelectionLongPressMs: () => 1200,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 170,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(260);

        dispatchPointer(window, 'pointermove', {
            pointerId: 170,
            pointerType: 'touch',
            clientX: 90,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 170,
            pointerType: 'touch',
            clientX: 90,
            clientY: 105,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        handler.destroy();
    });

    it('clears committed selection when clicking content area on the right side', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 41,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 41,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 41,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        let link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        expect(link?.classList.contains('is-active')).toBe(true);

        dispatchPointer(view.contentDOM, 'pointerdown', {
            pointerId: 42,
            pointerType: 'mouse',
            clientX: 220,
            clientY: 40,
        });

        link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        expect(link?.classList.contains('is-active')).toBe(false);
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        handler.destroy();
    });

    it('shows delete button for committed selection and removes selected blocks on click', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const viewRef = view as unknown as {
            state: EditorState;
            visibleRanges: Array<{ from: number; to: number }>;
            dispatch: (spec: { changes: Array<{ from: number; to: number }> }) => void;
        };
        viewRef.dispatch = (spec) => {
            const next = viewRef.state.update({ changes: spec.changes });
            viewRef.state = next.state;
            viewRef.visibleRanges = [{ from: 0, to: viewRef.state.doc.length }];
        };

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: (_x, y) => (y >= 100 ? endBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            isRangeSelectionDeleteEnabled: () => true,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 51,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 51,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 51,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const deleteButton = view.dom.querySelector<HTMLElement>('.dnd-range-selection-delete-btn');
        expect(deleteButton).not.toBeNull();
        expect(deleteButton?.classList.contains('is-active')).toBe(true);

        dispatchPointer(deleteButton!, 'pointerdown', {
            pointerId: 52,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 80,
        });
        deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(viewRef.state.doc.toString()).toBe('line 1\nline 7\nline 8');
        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link?.classList.contains('is-active')).toBe(false);
        expect(deleteButton?.classList.contains('is-active')).toBe(false);
        handler.destroy();
    });

    it('keeps delete button hidden when multi-selection delete feature is disabled', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 53,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 53,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 53,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const deleteButton = view.dom.querySelector<HTMLElement>('.dnd-range-selection-delete-btn');
        expect(deleteButton).toBeNull();
        handler.destroy();
    });

    it('keeps committed selection on touch content tap and clears it when editor input gains focus', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 61,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 61,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 61,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        let link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link?.classList.contains('is-active')).toBe(true);

        dispatchPointer(view.contentDOM, 'pointerdown', {
            pointerId: 62,
            pointerType: 'touch',
            clientX: 220,
            clientY: 40,
        });

        link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link?.classList.contains('is-active')).toBe(true);

        const input = document.createElement('textarea');
        view.dom.appendChild(input);
        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));

        link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link?.classList.contains('is-active')).toBe(false);
        handler.destroy();
    });

    it('repositions committed selection links after scroll', () => {
        const view = createViewStub(8);
        (view as unknown as { scrollDOM?: HTMLElement }).scrollDOM = view.dom;
        let scrollOffset = 0;
        (view as unknown as { coordsAtPos: (pos: number) => { left: number; right: number; top: number; bottom: number } | null }).coordsAtPos = (pos: number) => {
            const line = view.state.doc.lineAt(pos);
            const top = (line.number - 1) * 20 - scrollOffset;
            return { left: 40, right: 120, top, bottom: top + 20 };
        };

        const handle = appendHandleForBlockStart(view, 1, () => 22 - scrollOffset);
        appendHandleForBlockStart(view, 5, () => 102 - scrollOffset);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 43,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 43,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 43,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 105,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        const topBefore = Number(link?.style.top.replace('px', '') || '0');

        scrollOffset = 40;
        view.dom.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(20);

        const topAfter = Number(link?.style.top.replace('px', '') || '0');
        expect(topAfter).toBeLessThan(topBefore);
        handler.destroy();
    });

    it('keeps link active when boundary handles are missing but middle selected handle is visible', () => {
        const view = createViewStub(12);
        (view as unknown as { scrollDOM?: HTMLElement }).scrollDOM = view.dom;
        const topHandle = appendHandleForBlockStart(view, 1, () => 22);
        const middleHandle = appendHandleForBlockStart(view, 4, () => 82);
        const bottomHandle = appendHandleForBlockStart(view, 7, () => 142);

        const sourceBlock = createBlock('line 2', 1, 1);
        const middleBlock = createBlock('line 5', 4, 4);
        const endBlock = createBlock('line 8', 7, 7);
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: (handle) => {
                if (handle === topHandle) return sourceBlock;
                if (handle === middleHandle) return middleBlock;
                if (handle === bottomHandle) return endBlock;
                return null;
            },
            getBlockInfoAtPoint: (_x, y) => (y >= 140 ? endBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(topHandle, 'pointerdown', {
            pointerId: 440,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 440,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 150,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 440,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 150,
        });

        const linkBefore = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(linkBefore).not.toBeNull();
        expect(linkBefore?.classList.contains('is-active')).toBe(true);

        topHandle.remove();
        bottomHandle.remove();
        view.dom.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(20);

        const linkAfter = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(linkAfter).not.toBeNull();
        expect(linkAfter?.classList.contains('is-active')).toBe(true);
        expect(Number(linkAfter?.style.height.replace('px', '') || '0')).toBeCloseTo(2, 1);
        handler.destroy();
    });

    it('expands selection to whole list block when range touches any list line', () => {
        const view = createViewStub([
            'intro',
            '- parent',
            '  - child',
            'after',
            'tail',
        ]);
        const handle = appendHandleForBlockStart(view, 0);

        const sourceBlock: BlockInfo = {
            type: BlockType.Paragraph,
            startLine: 0,
            endLine: 0,
            from: 0,
            to: 5,
            indentLevel: 0,
            content: 'intro',
        };
        const listParentBlock: BlockInfo = {
            type: BlockType.ListItem,
            startLine: 1,
            endLine: 2,
            from: view.state.doc.line(2).from,
            to: view.state.doc.line(3).to,
            indentLevel: 0,
            content: '- parent\n  - child',
        };
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: (_x, y) => (y >= 20 ? listParentBlock : sourceBlock),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 10,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 25, // line 2: list parent
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 25,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 9,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 25,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        dispatchPointer(link!, 'pointerdown', {
            pointerId: 10,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 25,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 10,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 25,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(selectedBlock.startLine).toBe(0);
        expect(selectedBlock.endLine).toBe(2); // list child line must be included
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 25, expect.objectContaining({
            startLine: 0,
            endLine: 2,
        }), 'mouse');
        handler.destroy();
    });

    it('captures rendered embed block during downward range selection without requiring blank line hit', () => {
        const view = createViewStub([
            'intro',
            'anchor',
            'before',
            'around',
            '> [!note] title',
            '> body',
            'tail',
        ]);
        const handle = appendHandleForBlockStart(view, 1, () => 22);
        appendHandleForBlockStart(view, 4, () => 82);

        const sourceBlock = createBlock('anchor', 1, 1);
        const calloutBlock = createBlock('> [!note] title\n> body', 4, 5);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();

        const embed = document.createElement('div');
        embed.className = 'cm-callout';
        view.dom.appendChild(embed);
        Object.defineProperty(embed, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(120, 82, 220, 56),
        });

        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn((clientX: number, clientY: number) => {
                if (clientY >= 82 && clientY <= 138 && clientX >= 6 && clientX <= 240) {
                    return embed;
                }
                return null;
            }),
        });

        const originalPosAtCoords = view.posAtCoords.bind(view);
        (view as unknown as { posAtCoords: (coords: { x: number; y: number }) => number | null }).posAtCoords = (coords) => {
            if (coords.y >= 82 && coords.y <= 138) {
                // Simulate rendered block hit mismatch: point looks inside callout but resolves to previous line.
                return view.state.doc.line(4).from;
            }
            return originalPosAtCoords(coords);
        };

        const originalPosAtDOM = view.posAtDOM.bind(view);
        (view as unknown as { posAtDOM: (node: Node, offset?: number) => number }).posAtDOM = (node: Node, offset?: number) => {
            if (node === embed || embed.contains(node)) {
                return view.state.doc.line(5).from;
            }
            return originalPosAtDOM(node, offset);
        };

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: (_x, y) => (y >= 82 && y <= 138 ? calloutBlock : null),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 92,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 92,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 92,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();
        dispatchPointer(link!, 'pointerdown', {
            pointerId: 12,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 92,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 12,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 92,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(selectedBlock.startLine).toBe(1);
        expect(selectedBlock.endLine).toBe(5);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 92, expect.objectContaining({
            startLine: 1,
            endLine: 5,
        }), 'mouse');
        handler.destroy();
    });

    it('keeps disjoint committed ranges and drags them as one ordered composite source', () => {
        const view = createViewStub(12);
        const handleA = appendHandleForBlockStart(view, 1);
        const handleB = appendHandleForBlockStart(view, 7);

        const blockA = createBlock('line 2', 1, 1);
        const blockB = createBlock('line 8', 7, 7);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: (handle) => {
                if (handle === handleA) return blockA;
                if (handle === handleB) return blockB;
                return null;
            },
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();

        dispatchPointer(handleA, 'pointerdown', {
            pointerId: 30,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 30,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 30,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        dispatchPointer(handleB, 'pointerdown', {
            pointerId: 31,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 150,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 31,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 150,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 31,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 150,
        });

        const link = view.dom.querySelector<HTMLElement>('.dnd-range-selection-link');
        expect(link).not.toBeNull();

        dispatchPointer(link!, 'pointerdown', {
            pointerId: 32,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 80,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 32,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const composite = beginPointerDragSession.mock.calls[0][0] as BlockInfo;
        expect(composite.startLine).toBe(1);
        expect(composite.endLine).toBe(7);
        expect(composite.compositeSelection?.ranges).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 7, endLine: 7 },
        ]);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 80, expect.objectContaining({
            compositeSelection: {
                ranges: [
                    { startLine: 1, endLine: 1 },
                    { startLine: 7, endLine: 7 },
                ],
            },
        }), 'mouse');

        dispatchPointer(window, 'pointerup', {
            pointerId: 32,
            pointerType: 'mouse',
            clientX: 90,
            clientY: 80,
        });

        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        const droppedSource = performDropAtPoint.mock.calls[0][0] as BlockInfo;
        expect(droppedSource.compositeSelection?.ranges).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 7, endLine: 7 },
        ]);
        handler.destroy();
    });

    it('keeps mouse quick-drag path untouched before long-press selection activates', () => {
        const view = createViewStub(6);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);
        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();
        const downEvent = dispatchPointer(handle, 'pointerdown', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        expect(downEvent.defaultPrevented).toBe(false);
        expect(handle.getAttribute('draggable')).toBe('true');

        dispatchPointer(window, 'pointermove', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 120,
            clientY: 30,
        });
        vi.advanceTimersByTime(400);
        dispatchPointer(window, 'pointerup', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 120,
            clientY: 30,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(scheduleDropIndicatorUpdate).not.toHaveBeenCalled();
        expect(performDropAtPoint).not.toHaveBeenCalled();
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        expect(handle.getAttribute('draggable')).toBe('true');
        handler.destroy();
    });

    it('triggers vibration when mobile long-press drag starts', () => {
        const view = createViewStub();
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);

        const sourceBlock = createBlock();
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const vibrate = vi.fn();
        Object.defineProperty(window.navigator, 'vibrate', {
            configurable: true,
            writable: true,
            value: vibrate,
        });

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 32,
            clientY: 12,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 45,
            clientY: 12,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 45,
            clientY: 12,
        });
        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(45, 12, expect.objectContaining({
            startLine: 0,
            endLine: 0,
        }), 'touch');
        expect(vibrate).toHaveBeenCalledTimes(1);
        handler.destroy();
    });

    it('allows touch drag from hotzone long-press with a single selection stage', () => {
        const view = createViewStub(8);
        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => sourceBlock,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(view.contentDOM, 'pointerdown', {
            pointerId: 52,
            pointerType: 'touch',
            clientX: 32,
            clientY: 80,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 52,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 80, expect.any(Object), 'touch');
        handler.destroy();
    });

    it('skips range-selection flow on mouse when multi-line selection is disabled', () => {
        const view = createViewStub(6);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 81,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(600);
        dispatchPointer(window, 'pointermove', {
            pointerId: 81,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 81,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        handler.destroy();
    });

    it('falls back to single-block touch drag when multi-line selection is disabled', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const performDropAtPoint = vi.fn();
        const finishDragSession = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => false,
            beginPointerDragSession,
            finishDragSession,
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 82,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(260);
        dispatchPointer(window, 'pointermove', {
            pointerId: 82,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 82,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(90, 80, expect.objectContaining({
            startLine: 1,
            endLine: 1,
        }), 'touch');
        expect(view.dom.querySelector('.dnd-range-selection-link')).toBeNull();
        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        handler.destroy();
    });
});




