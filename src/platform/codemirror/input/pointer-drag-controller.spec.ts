// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { PointerDragController } from './pointer-drag-controller';
import {
    registerMouseHandlerTestHooks,
    createBlock,
    createPointerDragControllerDeps,
    createViewStub,
    appendHandleForBlockStart,
    dispatchPointer,
    dispatchTouchMove,
    createRect,
    resolveBlockSelectionFromTestBlocks,
} from './pointer-drag-controller.test-helpers';

registerMouseHandlerTestHooks();

describe('PointerDragController', () => {
    it('does not commit range selection from mobile hotzone long-press without movement', () => {
        const view = createViewStub();
        const sourceBlock = createBlock();
        const beginPointerDragSession = vi.fn();

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => null, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(view.dom, 'pointerdown', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 32,
            clientY: 10,
        });
        vi.advanceTimersByTime(940);
        dispatchPointer(window, 'pointermove', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 32,
            clientY: 10,
        });

        dispatchPointer(window, 'pointerup', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 32,
            clientY: 10,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        const link = view.dom.querySelector<HTMLElement>('.dnd-selection-rail');
        expect(link).toBeNull();
        handler.destroy();
    });

    it('does not start drag when pointerdown is outside hotzone', () => {
        const view = createViewStub();
        const beginPointerDragSession = vi.fn();
        const onPlatformCommit = vi.fn();

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => null, point: () => createBlock() }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(view.dom, 'pointerdown', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 120,
            clientY: 10,
        });
        vi.advanceTimersByTime(260);
        dispatchPointer(window, 'pointermove', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 140,
            clientY: 10,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 140,
            clientY: 10,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(onPlatformCommit).not.toHaveBeenCalled();
        handler.destroy();
    });

    it('starts single-block touch drag from full line area when mobile text long-press drag is enabled', () => {
        const view = createViewStub(6);
        const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
        expect(line).not.toBeNull();
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const onPlatformCommit = vi.fn();
        const finishDragSession = vi.fn();

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession,
            finishDragSession,
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(line!, 'pointerdown', {
            pointerId: 91,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 91,
            pointerType: 'touch',
            clientX: 90,
            clientY: 10,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 91,
            pointerType: 'touch',
            clientX: 90,
            clientY: 10,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(90, 10, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 0,
                endLine: 0,
            })],
            }), 'touch');
        expect(onPlatformCommit).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        expect(view.dom.querySelector('.dnd-selection-rail')).toBeNull();
        handler.destroy();
    });

    it('does not start text long-press drag from a short focused editor tap', () => {
        const view = createViewStub(6);
        const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
        expect(line).not.toBeNull();
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const onPlatformCommit = vi.fn();
        const blurSpy = vi.spyOn(view.contentDOM, 'blur');

        Object.defineProperty(view, 'hasFocus', {
            configurable: true,
            value: true,
        });

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        const downEvent = dispatchPointer(line!, 'pointerdown', {
            pointerId: 913,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });
        expect(downEvent.defaultPrevented).toBe(false);
        expect(blurSpy).toHaveBeenCalledTimes(1);

        dispatchPointer(window, 'pointerup', {
            pointerId: 913,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(onDropPreview).not.toHaveBeenCalled();
        expect(onPlatformCommit).not.toHaveBeenCalled();
        expect(view.dom.querySelector('.dnd-selection-rail')).toBeNull();
        handler.destroy();
    });

    it('preserves touch tap-to-focus before text long-press drag starts', () => {
        const view = createViewStub(6);
        const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
        expect(line).not.toBeNull();
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        const input = document.createElement('textarea');
        view.dom.appendChild(input);
        const blurSpy = vi.spyOn(input, 'blur');

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        const downEvent = dispatchPointer(line!, 'pointerdown', {
            pointerId: 911,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });
        expect(downEvent.defaultPrevented).toBe(false);

        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));
        expect(blurSpy).not.toHaveBeenCalled();

        dispatchPointer(window, 'pointerup', {
            pointerId: 911,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        handler.destroy();
    });

    it('blocks touch scrolling after text long-press is ready', () => {
        const view = createViewStub(6);
        const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
        expect(line).not.toBeNull();
        const sourceBlock = createBlock('- item', 0, 0);

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(line!, 'pointerdown', {
            pointerId: 912,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });

        const beforeReadyMove = dispatchTouchMove(window);
        expect(beforeReadyMove.defaultPrevented).toBe(false);

        vi.advanceTimersByTime(220);

        const readyMove = dispatchTouchMove(window);
        expect(readyMove.defaultPrevented).toBe(true);

        dispatchPointer(window, 'pointerup', {
            pointerId: 912,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });

        handler.destroy();
    });

    it('auto-scrolls the editor at the viewport edge while dragging instead of using native scroll', () => {
        document.body.classList.add('is-mobile');
        const view = createViewStub(20);
        const scroller = document.createElement('div');
        scroller.className = 'cm-scroller';
        view.dom.appendChild(scroller);
        (view as unknown as { scrollDOM?: HTMLElement }).scrollDOM = scroller;
        Object.defineProperty(scroller, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 360, 200),
        });
        scroller.scrollTop = 40;

        const handle = appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('- item', 0, 0);
        const onDropPreview = vi.fn();

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 916,
            pointerType: 'touch',
            clientX: 12,
            clientY: 10,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 916,
            pointerType: 'touch',
            clientX: 12,
            clientY: 195,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 916,
            pointerType: 'touch',
            clientX: 12,
            clientY: 196,
        });
        const touchMove = dispatchTouchMove(window);

        expect(touchMove.defaultPrevented).toBe(true);
        expect(scroller.scrollTop).toBeGreaterThan(40);
        expect(onDropPreview).toHaveBeenLastCalledWith(12, 196, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 0,
                endLine: 0,
            })],
            }), 'touch');

        dispatchPointer(window, 'pointerup', {
            pointerId: 916,
            pointerType: 'touch',
            clientX: 12,
            clientY: 195,
        });
        document.body.classList.remove('is-mobile');
        handler.destroy();
    });

    it('blurs focused mobile editor and continues the same long-press drag intent', () => {
        const view = createViewStub(6);
        const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
        expect(line).not.toBeNull();
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        const blurSpy = vi.spyOn(view.contentDOM, 'blur');

        Object.defineProperty(view, 'hasFocus', {
            configurable: true,
            value: true,
        });

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        const downEvent = dispatchPointer(line!, 'pointerdown', {
            pointerId: 914,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });

        expect(downEvent.defaultPrevented).toBe(false);
        expect(blurSpy).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 914,
            pointerType: 'touch',
            clientX: 90,
            clientY: 10,
        });
        expect(beginPointerDragSession).toHaveBeenCalledWith(expect.objectContaining({ anchorBlock: sourceBlock }));
        handler.destroy();
    });

    it('does not start touch drag from line area when mobile text long-press drag is disabled', () => {
        const view = createViewStub(6);
        const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
        expect(line).not.toBeNull();
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const onPlatformCommit = vi.fn();

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(line!, 'pointerdown', {
            pointerId: 92,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });
        vi.advanceTimersByTime(300);
        dispatchPointer(window, 'pointermove', {
            pointerId: 92,
            pointerType: 'touch',
            clientX: 90,
            clientY: 10,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 92,
            pointerType: 'touch',
            clientX: 90,
            clientY: 10,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(onDropPreview).not.toHaveBeenCalled();
        expect(onPlatformCommit).not.toHaveBeenCalled();
        handler.destroy();
    });

    it('starts touch drag when pressing trailing whitespace on the same line', () => {
        const view = createViewStub(6);
        const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
        expect(line).not.toBeNull();
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        const onPlatformCommit = vi.fn();

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(line!, 'pointerdown', {
            pointerId: 93,
            pointerType: 'touch',
            clientX: 200,
            clientY: 10,
        });
        vi.advanceTimersByTime(300);
        dispatchPointer(window, 'pointermove', {
            pointerId: 93,
            pointerType: 'touch',
            clientX: 240,
            clientY: 10,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 93,
            pointerType: 'touch',
            clientX: 240,
            clientY: 10,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onPlatformCommit).toHaveBeenCalledTimes(1);
        handler.destroy();
    });

    it('starts touch drag from rendered callout area when mobile text long-press drag is enabled', () => {
        const view = createViewStub(6);
        const sourceBlock = createBlock('> [!note] title', 2, 3);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();

        const callout = document.createElement('div');
        callout.className = 'cm-callout';
        const calloutContent = document.createElement('div');
        callout.appendChild(calloutContent);
        view.dom.appendChild(callout);

        Object.defineProperty(callout, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(40, 40, 200, 60),
        });

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(calloutContent, 'pointerdown', {
            pointerId: 931,
            pointerType: 'touch',
            clientX: 80,
            clientY: 70,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 931,
            pointerType: 'touch',
            clientX: 110,
            clientY: 70,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 931,
            pointerType: 'touch',
            clientX: 110,
            clientY: 70,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(110, 70, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 2,
                endLine: 3,
            })],
            }), 'touch');
        handler.destroy();
    });

    it('starts touch drag from rendered latex area when mobile text long-press drag is enabled', () => {
        const view = createViewStub(6);
        const sourceBlock = createBlock('$$ x^2 $$', 4, 4);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();

        const mathDisplay = document.createElement('div');
        mathDisplay.className = 'MathJax';
        const mathContainer = document.createElement('div');
        mathContainer.className = 'mjx-container';
        mathDisplay.appendChild(mathContainer);
        view.dom.appendChild(mathDisplay);

        Object.defineProperty(mathDisplay, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(36, 88, 220, 52),
        });
        Object.defineProperty(mathContainer, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(36, 88, 220, 52),
        });

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(mathContainer, 'pointerdown', {
            pointerId: 932,
            pointerType: 'touch',
            clientX: 84,
            clientY: 110,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 932,
            pointerType: 'touch',
            clientX: 118,
            clientY: 110,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 932,
            pointerType: 'touch',
            clientX: 118,
            clientY: 110,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(118, 110, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 4,
                endLine: 4,
            })],
            }), 'touch');
        handler.destroy();
    });

    it('emits press/drag/idle lifecycle states on mobile text long-press drag path', () => {
        const view = createViewStub(6);
        const line = view.contentDOM.querySelector<HTMLElement>('.cm-line');
        expect(line).not.toBeNull();
        const sourceBlock = createBlock('- item', 0, 0);
        const lifecycleEvents: Array<{ type: string; phase: string; pressReady?: boolean }> = [];

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
            onDragLifecycleEvent: (event) => lifecycleEvents.push({
                type: event.type,
                phase: event.phase,
                pressReady: event.type === 'drag_press_pending' ? event.pressReady : undefined,
            }),
        }));

        handler.attach();
        dispatchPointer(line!, 'pointerdown', {
            pointerId: 94,
            pointerType: 'touch',
            clientX: 60,
            clientY: 10,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 94,
            pointerType: 'touch',
            clientX: 90,
            clientY: 10,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 94,
            pointerType: 'touch',
            clientX: 90,
            clientY: 10,
        });

        const pressPendingWaiting = lifecycleEvents.find((event) => event.type === 'drag_press_pending' && event.pressReady === false);
        const pressPendingReady = lifecycleEvents.find((event) => event.type === 'drag_press_pending' && event.pressReady === true);
        expect(pressPendingWaiting).toBeDefined();
        expect(pressPendingReady).toBeDefined();
        expect(lifecycleEvents.some((event) => event.type === 'drag_started')).toBe(true);
        expect(lifecycleEvents.some((event) => event.type === 'drag_idle')).toBe(true);
        handler.destroy();
    });

    it('emits press/drag/idle lifecycle states on handle touch drag path', () => {
        const view = createViewStub(6);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const lifecycleEvents: Array<{ type: string; phase: string; pressReady?: boolean }> = [];

        const handler = new PointerDragController(view, createPointerDragControllerDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
            onDragLifecycleEvent: (event) => lifecycleEvents.push({
                type: event.type,
                phase: event.phase,
                pressReady: event.type === 'drag_press_pending' ? event.pressReady : undefined,
            }),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 95,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 95,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 95,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });

        const pressPendingWaiting = lifecycleEvents.find((event) => event.type === 'drag_press_pending' && event.pressReady === false);
        const pressPendingReady = lifecycleEvents.find((event) => event.type === 'drag_press_pending' && event.pressReady === true);
        expect(pressPendingWaiting).toBeDefined();
        expect(pressPendingReady).toBeDefined();
        expect(lifecycleEvents.some((event) => event.type === 'drag_started')).toBe(true);
        expect(lifecycleEvents.some((event) => event.type === 'drag_idle')).toBe(true);
        handler.destroy();
    });

});



