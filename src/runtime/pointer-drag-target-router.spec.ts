import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlockInfo } from '../domain/block/block-types';
import {
    hidePointerDropIndicators,
    performPointerDropAtPoint,
    registerPointerDragTargetClient,
    resetPointerDragTargetRouterForTests,
    renderPointerDropPreviewAtPoint,
    type PointerDragTargetClient,
} from './pointer-drag-target-router';

function createClient(name: string, hitRect: { left: number; top: number; right: number; bottom: number }): PointerDragTargetClient {
    return {
        containsPoint: (x, y) => x >= hitRect.left && x <= hitRect.right && y >= hitRect.top && y <= hitRect.bottom,
        renderDropPreviewAtPoint: vi.fn(),
        hideDropIndicator: vi.fn(),
        performDropAtPoint: vi.fn(),
    } satisfies PointerDragTargetClient & { name?: string };
}

const sourceBlock = { startLine: 1, endLine: 1 } as BlockInfo;

afterEach(() => {
    resetPointerDragTargetRouterForTests();
});

describe('pointer-drag-target-router', () => {
    it('routes drop indicator updates to the client under the pointer and hides the previous target', () => {
        const fallback = createClient('fallback', { left: 0, top: 0, right: 100, bottom: 100 });
        const other = createClient('other', { left: 200, top: 0, right: 300, bottom: 100 });
        registerPointerDragTargetClient(fallback);
        registerPointerDragTargetClient(other);

        renderPointerDropPreviewAtPoint(fallback, 10, 10, sourceBlock, 'mouse');
        expect(fallback.renderDropPreviewAtPoint).toHaveBeenCalledWith(10, 10, sourceBlock, 'mouse');
        expect(other.renderDropPreviewAtPoint).not.toHaveBeenCalled();

        renderPointerDropPreviewAtPoint(fallback, 220, 10, sourceBlock, 'mouse');
        expect(fallback.hideDropIndicator).toHaveBeenCalledTimes(1);
        expect(other.renderDropPreviewAtPoint).toHaveBeenCalledWith(220, 10, sourceBlock, 'mouse');
    });

    it('uses the active target for drop when the pointer leaves registered editors', () => {
        const fallback = createClient('fallback', { left: 0, top: 0, right: 100, bottom: 100 });
        const other = createClient('other', { left: 200, top: 0, right: 300, bottom: 100 });
        registerPointerDragTargetClient(fallback);
        registerPointerDragTargetClient(other);

        renderPointerDropPreviewAtPoint(fallback, 220, 10, sourceBlock, 'mouse');
        performPointerDropAtPoint(fallback, sourceBlock, 500, 500, 'mouse');

        expect(other.performDropAtPoint).toHaveBeenCalledWith(sourceBlock, 500, 500, 'mouse');
        expect(fallback.performDropAtPoint).not.toHaveBeenCalled();
    });

    it('clears all visible target indicators', () => {
        const fallback = createClient('fallback', { left: 0, top: 0, right: 100, bottom: 100 });
        const other = createClient('other', { left: 200, top: 0, right: 300, bottom: 100 });
        registerPointerDragTargetClient(fallback);
        registerPointerDragTargetClient(other);

        hidePointerDropIndicators();

        expect(fallback.hideDropIndicator).toHaveBeenCalledTimes(1);
        expect(other.hideDropIndicator).toHaveBeenCalledTimes(1);
    });
});
