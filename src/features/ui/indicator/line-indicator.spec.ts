// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../../core/block/block-types';
import { DropIndicatorManager } from './line-indicator';
import { HIDDEN_CLASS } from '../../../shared/dom-selectors';

function createViewStub(): EditorView {
    const root = document.createElement('div');
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);
    Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }),
    });
    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, top: 0, right: 380, bottom: 180, width: 380, height: 180 }),
    });
    return {
        dom: root,
        contentDOM: content,
    } as unknown as EditorView;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('DropIndicatorManager', () => {
    it('skips target recalculation for tiny pointer moves on same source', () => {
        const view = createViewStub();
        const resolveDropTarget = vi.fn(() => ({
            lineNumber: 1,
            indicatorY: 10,
            lineRect: { left: 5, width: 100 },
        }));
        const onFrameMetrics = vi.fn();
        const queuedFrames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            queuedFrames.push(cb);
            return queuedFrames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { });
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({ paddingRight: '0' } as CSSStyleDeclaration);

        const manager = new DropIndicatorManager(view, resolveDropTarget, { onFrameMetrics });
        const source = {
            type: BlockType.Paragraph,
            startLine: 0,
            endLine: 0,
            from: 0,
            to: 5,
            indentLevel: 0,
            content: 'plain',
        };

        manager.scheduleFromPoint(10, 10, source, 'mouse');
        queuedFrames.shift()?.(0);
        manager.scheduleFromPoint(11, 10, source, 'mouse');
        queuedFrames.shift()?.(16);

        expect(resolveDropTarget).toHaveBeenCalledTimes(1);
        expect(onFrameMetrics).toHaveBeenCalledTimes(2);
        expect(onFrameMetrics).toHaveBeenLastCalledWith(
            expect.objectContaining({
                evaluated: false,
                skipped: true,
                reused: true,
            })
        );

        manager.destroy();
    });

    it('shows list drop highlight when highlightRect is provided', () => {
        const view = createViewStub();
        const resolveDropTarget = vi.fn(() => ({
            lineNumber: 2,
            indicatorY: 24,
            lineRect: { left: 8, width: 140 },
            highlightRect: { top: 16, left: 10, width: 180, height: 30 },
        }));
        const queuedFrames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            queuedFrames.push(cb);
            return queuedFrames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { });
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({ paddingRight: '0' } as CSSStyleDeclaration);

        const manager = new DropIndicatorManager(view, resolveDropTarget);

        manager.scheduleFromPoint(12, 18, null, 'mouse');
        queuedFrames.shift()?.(0);

        const indicatorEl = document.querySelector('.dnd-drop-indicator');
        const highlightEl = document.querySelector('.dnd-drop-highlight');

        expect(indicatorEl?.classList.contains(HIDDEN_CLASS)).toBe(false);
        expect(highlightEl?.classList.contains(HIDDEN_CLASS)).toBe(false);

        manager.destroy();
    });

    it('hides list drop highlight when disabled by setting callback', () => {
        const view = createViewStub();
        const resolveDropTarget = vi.fn(() => ({
            lineNumber: 2,
            indicatorY: 24,
            lineRect: { left: 8, width: 140 },
            highlightRect: { top: 16, left: 10, width: 180, height: 30 },
        }));
        const queuedFrames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            queuedFrames.push(cb);
            return queuedFrames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { });
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({ paddingRight: '0' } as CSSStyleDeclaration);

        const manager = new DropIndicatorManager(view, resolveDropTarget, {
            isDropHighlightEnabled: () => false,
        });

        manager.scheduleFromPoint(12, 18, null, 'mouse');
        queuedFrames.shift()?.(0);

        const indicatorEl = document.querySelector('.dnd-drop-indicator');
        const highlightEl = document.querySelector('.dnd-drop-highlight');

        expect(indicatorEl?.classList.contains(HIDDEN_CLASS)).toBe(false);
        expect(highlightEl?.classList.contains(HIDDEN_CLASS)).toBe(true);

        manager.destroy();
    });

    it('keeps only one editor indicator visible across manager instances', () => {
        const viewA = createViewStub();
        const viewB = createViewStub();
        const resolveDropTargetA = vi.fn(() => ({
            lineNumber: 1,
            indicatorY: 12,
            lineRect: { left: 6, width: 120 },
        }));
        const resolveDropTargetB = vi.fn(() => ({
            lineNumber: 2,
            indicatorY: 26,
            lineRect: { left: 10, width: 140 },
        }));
        const queuedFrames: FrameRequestCallback[] = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            queuedFrames.push(cb);
            return queuedFrames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { });
        vi.spyOn(window, 'getComputedStyle').mockReturnValue({ paddingRight: '0' } as CSSStyleDeclaration);

        const managerA = new DropIndicatorManager(viewA, resolveDropTargetA);
        const managerB = new DropIndicatorManager(viewB, resolveDropTargetB);

        managerA.scheduleFromPoint(10, 10, null, 'mouse');
        queuedFrames.shift()?.(0);

        managerB.scheduleFromPoint(20, 20, null, 'mouse');
        queuedFrames.shift()?.(16);

        const indicators = Array.from(document.querySelectorAll<HTMLElement>('.dnd-drop-indicator'));
        expect(indicators).toHaveLength(2);
        expect(indicators[0].classList.contains(HIDDEN_CLASS)).toBe(true);
        expect(indicators[1].classList.contains(HIDDEN_CLASS)).toBe(false);

        managerA.destroy();
        managerB.destroy();
    });
});

