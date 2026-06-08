// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { PipelineAdapter } from './pipeline-adapter';
import {
    appendHandleForBlockStart,
    createBlock,
    createPipelineAdapterDeps,
    createViewStub,
    dispatchPointer,
    registerMouseHandlerTestHooks,
    resolveBlockSelectionFromTestBlocks,
} from './pipeline-adapter.test-helpers';

registerMouseHandlerTestHooks();

function lineAt(view: ReturnType<typeof createViewStub>, index: number): HTMLElement {
    const line = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')[index];
    expect(line).toBeDefined();
    return line;
}

describe('mobile handle affordance PRD contract', () => {
    it('adds a disjoint mobile selection range through handle affordance when the real handle is not visible', () => {
        document.body.classList.add('is-mobile');
        const view = createViewStub(8);
        const firstHandle = appendHandleForBlockStart(view, 0);
        const firstBlock = createBlock('line 1', 0, 0);
        const farBlock = createBlock('line 6', 5, 5);

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: (handle) => handle === firstHandle ? firstBlock : null,
                point: (_x, y) => y >= 100 ? farBlock : firstBlock,
            }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));

        expect(handler.pipelineState.type).toBe('selecting');
        const farLine = lineAt(view, 5);
        dispatchPointer(farLine, 'pointerdown', {
            pointerId: 710,
            pointerType: 'touch',
            clientX: 12,
            clientY: 110,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 710,
            pointerType: 'touch',
            clientX: 12,
            clientY: 110,
        });

        expect(handler.pipelineState.type).toBe('selecting');
        if (handler.pipelineState.type === 'selecting') {
            expect(handler.pipelineState.selection.phase).toBe('passive');
            expect(handler.pipelineState.selection.selection.ranges).toEqual([
                expect.objectContaining({ startLine: 0, endLine: 0 }),
                expect.objectContaining({ startLine: 5, endLine: 5 }),
            ]);
        }
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(false);

        document.body.classList.remove('is-mobile');
        handler.destroy();
    });

    it('starts a touch handle drag through handle affordance even when mobile text drag mode is disabled', () => {
        document.body.classList.add('is-mobile');
        const view = createViewStub(6);
        const sourceBlock = createBlock('line 1', 0, 0);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: () => null,
                point: () => sourceBlock,
            }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileDragModeRequired: () => true,
            isMobileDragModeEnabled: () => false,
            isMobileTextLongPressDragEnabled: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        const firstLine = lineAt(view, 0);
        dispatchPointer(firstLine, 'pointerdown', {
            pointerId: 711,
            pointerType: 'touch',
            clientX: 12,
            clientY: 10,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 711,
            pointerType: 'touch',
            clientX: 48,
            clientY: 10,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(48, 10, expect.objectContaining({
            ranges: [expect.objectContaining({ startLine: 0, endLine: 0 })],
        }), 'touch');

        document.body.classList.remove('is-mobile');
        handler.destroy();
    });
});
