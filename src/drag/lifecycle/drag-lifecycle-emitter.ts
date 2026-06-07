import type { DragLifecycleEvent } from './drag-lifecycle';

/**
 * Deduplicating emitter that skips consecutive identical lifecycle events.
 */
export class DragLifecycleEmitter {
    private lastSignature: string | null = null;

    constructor(
        private readonly sink: (event: DragLifecycleEvent) => void
    ) {}

    emit(event: DragLifecycleEvent): void {
        const payload = normalizeEvent(event);
        const signature = buildSignature(payload);
        if (signature === this.lastSignature) return;
        this.lastSignature = signature;
        this.sink(payload);
    }

    reset(): void {
        this.lastSignature = null;
    }
}

function normalizeEvent(event: DragLifecycleEvent): DragLifecycleEvent {
    switch (event.type) {
        case 'drag_idle':
            return {
                type: 'drag_idle',
                phase: 'idle',
                source: null,
                targetLine: null,
                listIntent: null,
                rejectReason: null,
                pointerType: null,
            };
        case 'drag_press_pending':
            return {
                type: 'drag_press_pending',
                phase: 'press_pending',
                source: event.source,
                targetLine: null,
                listIntent: null,
                rejectReason: null,
                pointerType: event.pointerType ?? null,
                pressReady: event.pressReady === true,
            };
        case 'drag_started':
            return {
                type: 'drag_started',
                phase: 'drag_active',
                source: event.source,
                targetLine: null,
                listIntent: null,
                rejectReason: null,
                pointerType: event.pointerType ?? null,
            };
        case 'drag_target_changed':
            return {
                type: 'drag_target_changed',
                phase: 'drag_active',
                source: event.source,
                targetLine: typeof event.targetLine === 'number' ? event.targetLine : null,
                listIntent: event.listIntent ?? null,
                rejectReason: event.rejectReason ?? null,
                pointerType: event.pointerType ?? null,
            };
        case 'drag_drop_commit':
            return {
                type: 'drag_drop_commit',
                phase: 'drop_commit',
                source: event.source,
                targetLine: typeof event.targetLine === 'number' ? event.targetLine : null,
                listIntent: event.listIntent ?? null,
                rejectReason: null,
                pointerType: event.pointerType ?? null,
            };
        case 'drag_cancelled':
            return {
                type: 'drag_cancelled',
                phase: 'cancelled',
                source: event.source ?? null,
                targetLine: typeof event.targetLine === 'number' ? event.targetLine : null,
                listIntent: event.listIntent ?? null,
                rejectReason: event.rejectReason,
                pointerType: event.pointerType ?? null,
            };
    }
}

function buildSignature(event: DragLifecycleEvent): string {
    return JSON.stringify({
        type: event.type,
        phase: event.phase,
        sourceStart: event.source?.anchorBlock.startLine ?? null,
        sourceEnd: event.source?.anchorBlock.endLine ?? null,
        sourceRanges: event.source?.ranges ?? null,
        targetLine: event.targetLine,
        listIntent: event.listIntent,
        rejectReason: event.rejectReason,
        pointerType: event.pointerType,
        pressReady: event.type === 'drag_press_pending' && event.pressReady === true,
    });
}
