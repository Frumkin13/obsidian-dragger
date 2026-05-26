import { DragLifecycleEvent } from '../shared/types/drag';
import { ListDropIntent } from '../shared/types/protocol-types';

export function buildListIntent(intent?: ListDropIntent): ListDropIntent | null {
    if (
        typeof intent?.contextLineNumber !== 'number'
        && typeof intent?.indentDelta !== 'number'
        && typeof intent?.targetIndentWidth !== 'number'
    ) {
        return null;
    }
    return {
        contextLineNumber: intent?.contextLineNumber,
        indentDelta: intent?.indentDelta,
        targetIndentWidth: intent?.targetIndentWidth,
    };
}

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
    return {
        state: event.state,
        sourceBlock: event.sourceBlock ?? null,
        targetLine: typeof event.targetLine === 'number' ? event.targetLine : null,
        listIntent: event.listIntent ?? null,
        rejectReason: event.rejectReason ?? null,
        pointerType: event.pointerType ?? null,
        pressReady: event.pressReady === true,
    };
}

function buildSignature(event: DragLifecycleEvent): string {
    return JSON.stringify({
        state: event.state,
        sourceStart: event.sourceBlock?.startLine ?? null,
        sourceEnd: event.sourceBlock?.endLine ?? null,
        targetLine: event.targetLine,
        listIntent: event.listIntent,
        rejectReason: event.rejectReason,
        pointerType: event.pointerType,
        pressReady: event.pressReady === true,
    });
}
