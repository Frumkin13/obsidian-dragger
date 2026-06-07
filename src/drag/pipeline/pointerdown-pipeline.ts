import type { EditorView } from '@codemirror/view';
import type { DragSource } from '../../shared/types/drag';
import type { DragEventHandlerDeps } from './drag-controller';
import type { PointerSessionController } from '../input';
import type { CommittedRangeSelection, RangeSelectionOperation } from '../state/selection';
import { decideDesktopPointerDownIntent } from '../intent/pointer-intent';
import { isSourceIntent } from '../intent';
import { executeDragIntent } from './pointerdown-intent-runner';

export interface PointerDownPipelineHost {
    readonly view: EditorView;
    readonly deps: DragEventHandlerDeps;
    readonly pointer: PointerSessionController;
    committedRangeSelection: CommittedRangeSelection | null;

    resolveDragSource: DragEventHandlerDeps['resolveDragSource'];
    beginRangeSelectionSession(
        source: DragSource,
        e: PointerEvent,
        handle: HTMLElement | null,
        options?: { skipLongPress?: boolean; initialOperation?: RangeSelectionOperation }
    ): void;
    enterDraggingState(
        source: DragSource,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): void;
    tryStartCommittedSelectionDrag(e: PointerEvent, target: HTMLElement): boolean;
    isMultiLineSelectionEnabled(): boolean;
}

export function runDesktopPointerDownPipeline(
    host: PointerDownPipelineHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    const intent = decideDesktopPointerDownIntent({
        target,
        event: e,
        hasCommittedSelection: !!host.committedRangeSelection,
        multiLineSelectionEnabled: host.isMultiLineSelectionEnabled(),
    });

    if (intent.type !== 'ignore') {
        e.preventDefault();
        e.stopPropagation();
        const handle = isSourceIntent(intent) && intent.sourceRequest.kind === 'handle' ? intent.sourceRequest.handle : null;
        return executeDragIntent({
            resolveDragSource: (request) => host.resolveDragSource(request),
            isBlockInsideRenderedTableCell: (source) => host.deps.isBlockInsideRenderedTableCell(source.primaryBlock),
            startRangeSelectionFromSource: (source, options) => host.beginRangeSelectionSession(source, e, handle, options),
            startDragFromSource: (source) => {
                host.pointer.tryCapturePointer(e);
                host.enterDraggingState(source, e.pointerId, e.clientX, e.clientY, e.pointerType || null);
            },
        }, intent);
    }

    if (host.tryStartCommittedSelectionDrag(e, target)) return true;
    return false;
}
