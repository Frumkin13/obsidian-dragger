import { DragLifecycleEvent, DragListIntent } from '../../../shared/types/drag';

export function buildListIntent(raw: {
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
}): DragListIntent | null {
    if (
        typeof raw.listContextLineNumber !== 'number'
        && typeof raw.listIndentDelta !== 'number'
        && typeof raw.listTargetIndentWidth !== 'number'
    ) {
        return null;
    }
    return {
        listContextLineNumber: raw.listContextLineNumber,
        listIndentDelta: raw.listIndentDelta,
        listTargetIndentWidth: raw.listTargetIndentWidth,
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
