import type { EditorView } from '@codemirror/view';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { PointerDownAction } from './pointerdown-action';
import type { BlockSelectionRequest } from '../selection/block-selection-resolver';
import type { PointerDragControllerDeps } from './pointer-drag-controller';
import type { PointerSessionController } from './pointer-session-controller';
import type { RangeSelectionOperation } from '../../../domain/selection/block-selection';
import type { CommittedRangeSelection } from '../../../domain/selection/range-selection';
import { decideDesktopPointerDownAction } from './pointerdown-action';
import { isSelectionAction } from './pointerdown-action';
import type { RangeSelectionOptions } from './pointerdown-action';

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
    readonly deps: PointerDragControllerDeps;
    readonly pointer: PointerSessionController;
    committedRangeSelection: CommittedRangeSelection | null;

    resolveBlockSelection: PointerDragControllerDeps['resolveBlockSelection'];
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

    if (host.tryStartCommittedSelectionDrag(e, target)) return true;
    return false;
}
