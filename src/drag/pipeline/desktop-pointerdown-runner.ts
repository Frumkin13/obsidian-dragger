import type { EditorView } from '@codemirror/view';
import type { BlockInfo } from '../../domain/block/block-types';
import { createDragSource, type DragSource } from '../../shared/types/drag';
import { DRAG_HANDLE_CLASS, EMBED_HANDLE_CLASS } from '../../shared/dom-selectors';
import type { DragEventHandlerDeps } from './drag-controller';
import type { PointerSessionController } from '../input/pointer-session-controller';
import type { CommittedRangeSelection, RangeSelectionOperation } from '../state/selection/selection-model';

export interface DesktopGesturePipelineHost {
    readonly view: EditorView;
    readonly deps: DragEventHandlerDeps;
    readonly pointer: PointerSessionController;
    committedRangeSelection: CommittedRangeSelection | null;

    beginRangeSelectionSession(
        blockInfo: BlockInfo,
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
    host: DesktopGesturePipelineHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    if (tryStartDesktopHandleInteraction(host, e, target)) return true;
    if (host.tryStartCommittedSelectionDrag(e, target)) return true;
    return false;
}

function tryStartDesktopHandleInteraction(
    host: DesktopGesturePipelineHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    const handle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle || handle.classList.contains(EMBED_HANDLE_CLASS)) return false;
    if (e.button !== 0) return true;

    e.preventDefault();
    e.stopPropagation();

    const blockInfo = host.deps.getBlockInfoForHandle(handle)
        ?? host.deps.getBlockInfoAtPoint(e.clientX, e.clientY);
    if (!blockInfo) return true;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return true;

    if (host.isMultiLineSelectionEnabled()) {
        if (host.committedRangeSelection || e.shiftKey) {
            host.beginRangeSelectionSession(blockInfo, e, handle, { skipLongPress: true });
            return true;
        }

        host.beginRangeSelectionSession(blockInfo, e, handle);
        return true;
    }

    e.preventDefault();
    e.stopPropagation();
    host.pointer.tryCapturePointer(e);
    host.enterDraggingState(
        createDragSource(blockInfo, [{ startLine: blockInfo.startLine, endLine: blockInfo.endLine }]),
        e.pointerId,
        e.clientX,
        e.clientY,
        e.pointerType || null
    );
    return true;
}
