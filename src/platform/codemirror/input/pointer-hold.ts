import type { EditorView } from '@codemirror/view';
import { DRAG_HANDLE_CLASS, EMBED_HANDLE_CLASS } from '../../../shared/dom-selectors';
import type { BlockSelection, RangeSelectionOperation } from '../../../domain/selection/block-selection';
import type { BlockSelectionRequest } from '../selection/block-selection-resolver';
import type { CommittedRangeSelection } from '../../../domain/selection/range-selection';
import type { PipelineAdapterDeps } from './pipeline-adapter';
import type { PointerSession } from './pointer-session';

export type RangeSelectionOptions = {
    skipLongPress?: boolean;
    initialOperation?: RangeSelectionOperation;
};

export type PointerDownAction =
    | { type: 'ignore' }
    | { type: 'start_drag'; selectionRequest: BlockSelectionRequest }
    | { type: 'start_range_selection'; selectionRequest: BlockSelectionRequest; options?: RangeSelectionOptions };

export function isSelectionAction(action: PointerDownAction): action is Extract<PointerDownAction, { selectionRequest: BlockSelectionRequest }> {
    return 'selectionRequest' in action;
}

export function decideDesktopPointerDownAction(params: {
    target: HTMLElement;
    event: PointerEvent;
    hasCommittedSelection: boolean;
    multiLineSelectionEnabled: boolean;
}): PointerDownAction {
    const handle = params.target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle || handle.classList.contains(EMBED_HANDLE_CLASS)) return { type: 'ignore' };
    if (params.event.button !== 0) return { type: 'ignore' };

    const selectionRequest = { kind: 'handle' as const, handle };
    if (params.multiLineSelectionEnabled) {
        return {
            type: 'start_range_selection',
            selectionRequest,
            options: params.hasCommittedSelection || params.event.shiftKey
                ? { skipLongPress: true }
                : undefined,
        };
    }

    return { type: 'start_drag', selectionRequest };
}
export type PointerDownActionHost = {
    resolveBlockSelection(request: BlockSelectionRequest): BlockSelection | null;
    isBlockInsideRenderedTableCell(source: BlockSelection): boolean;
    startRangeSelectionFromSource(source: BlockSelection, options?: RangeSelectionOptions): void;
    startDragFromSource(source: BlockSelection): void;
};

function executePointerDownAction(host: PointerDownActionHost, action: PointerDownAction): boolean {
    switch (action.type) {
        case 'ignore':
            return false;
        case 'start_range_selection': {
            const source = host.resolveBlockSelection(action.selectionRequest);
            if (!source || host.isBlockInsideRenderedTableCell(source)) return true;
            host.startRangeSelectionFromSource(source, action.options);
            return true;
        }
        case 'start_drag': {
            const source = host.resolveBlockSelection(action.selectionRequest);
            if (!source || host.isBlockInsideRenderedTableCell(source)) return true;
            host.startDragFromSource(source);
            return true;
        }
    }
}

export interface DesktopPointerDownHost {
    readonly view: EditorView;
    readonly deps: PipelineAdapterDeps;
    readonly pointer: PointerSession;
    committedRangeSelection: CommittedRangeSelection | null;

    resolveBlockSelection: PipelineAdapterDeps['resolveBlockSelection'];
    beginRangeSelectionSession(
        source: BlockSelection,
        e: PointerEvent,
        handle: HTMLElement | null,
        options?: { skipLongPress?: boolean; initialOperation?: RangeSelectionOperation }
    ): void;
    enterDraggingState(
        source: BlockSelection,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): void;
    tryStartCommittedSelectionDrag(e: PointerEvent, target: HTMLElement): boolean;
    isMultiLineSelectionEnabled(): boolean;
}

export function handleDesktopPointerDown(
    host: DesktopPointerDownHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    if (host.tryStartCommittedSelectionDrag(e, target)) return true;

    const action = decideDesktopPointerDownAction({
        target,
        event: e,
        hasCommittedSelection: !!host.committedRangeSelection,
        multiLineSelectionEnabled: host.isMultiLineSelectionEnabled(),
    });

    if (action.type !== 'ignore') {
        e.preventDefault();
        e.stopPropagation();
        const handle = isSelectionAction(action) && action.selectionRequest.kind === 'handle' ? action.selectionRequest.handle : null;
        return executePointerDownAction({
            resolveBlockSelection: (request) => host.resolveBlockSelection(request),
            isBlockInsideRenderedTableCell: (source) => host.deps.isBlockInsideRenderedTableCell(source.anchorBlock),
            startRangeSelectionFromSource: (source, options) => host.beginRangeSelectionSession(source, e, handle, options),
            startDragFromSource: (source) => {
                host.pointer.tryCapturePointer(e);
                host.enterDraggingState(source, e.pointerId, e.clientX, e.clientY, e.pointerType || null);
            },
        }, action);
    }

    return false;
}
