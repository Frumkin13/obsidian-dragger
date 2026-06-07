import type { EditorView } from '@codemirror/view';
import type { DragSource } from '../../shared/types/drag';
import type { DragSourceRequest } from '../source';
import { cloneSelectedBlocks } from '../state/selection/block-selection';
import type {
    CommittedRangeSelection,
    MouseRangeSelectState,
    RangeSelectionBoundary,
    RangeSelectionOperation,
} from '../state/selection/selection-model';
import {
    createInitialRangeSelectionState,
    resolveRangeSelectConfig,
} from '../state/selection/selection-session-flow';
import {
    updateSelectionFromBoundary as updateSelectionFromBoundaryByFlow,
    updateSelectionFromLine as updateSelectionFromLineByFlow,
} from './range-selection-flow';
import { RangeSelectionVisualManager } from '../preview/range-selection-visual-manager';
import type { InteractionState } from '../state/drag-state';

const MOBILE_DRAG_LONG_PRESS_MS = 200;
const MOUSE_RANGE_SELECT_LONG_PRESS_MS = 260;

export interface RangeSelectionActionHost {
    readonly view: EditorView;
    readonly rangeVisual: RangeSelectionVisualManager;
    gesture: InteractionState;
    committedRangeSelection: CommittedRangeSelection | null;
    pointer: {
        tryCapturePointer(e: PointerEvent): void;
        tryCapturePointerById(pointerId: number): void;
        attachPointerListeners(): void;
    };

    getTouchRangeSelectLongPressMs(): number;
    resolveDragSource(request: DragSourceRequest): DragSource | null;
    buildDirectRangeSelectionSourceRequest(state: MouseRangeSelectState): DragSourceRequest;
    buildActiveRangeSelectionSourceRequest(state: MouseRangeSelectState): DragSourceRequest;
    emitPressPendingLifecycle(source: DragSource, pointerType: string | null, pressReady: boolean): void;
}

export function beginRangeSelectionSessionAction(
    host: RangeSelectionActionHost,
    source: DragSource,
    e: PointerEvent,
    options?: { skipLongPress?: boolean; initialOperation?: RangeSelectionOperation }
): void {
    const blockInfo = source.primaryBlock;
    const committedBlocksSnapshot = cloneSelectedBlocks(host.committedRangeSelection?.blocks ?? []);
    const pointerType = e.pointerType || null;
    const skipLongPress = options?.skipLongPress === true;
    const config = resolveRangeSelectConfig(
        pointerType,
        MOUSE_RANGE_SELECT_LONG_PRESS_MS,
        () => host.getTouchRangeSelectLongPressMs()
    );
    const shouldDeferInterception = pointerType === 'mouse' && !skipLongPress;
    const initialRangeSelectState = createInitialRangeSelectionState({
        blockInfo,
        doc: host.view.state.doc,
        committedBlocksSnapshot,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        pointerType,
        initialOperation: options?.initialOperation,
    });
    if (!initialRangeSelectState) return;
    const preferLongPressDrag = (
        pointerType === 'mouse'
        && skipLongPress
        && initialRangeSelectState.operation === 'remove'
        && !!host.committedRangeSelection
    );
    initialRangeSelectState.preferLongPressDrag = preferLongPressDrag;
    if (preferLongPressDrag) {
        initialRangeSelectState.dragReady = false;
    }
    initialRangeSelectState.longPressReady = skipLongPress;

    let dragTimeoutId: number | null = null;
    if (pointerType !== 'mouse') {
        dragTimeoutId = window.setTimeout(() => {
            if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'range')) return;
            const state = host.gesture.selection.rangeSelect;
            const nextSource = host.resolveDragSource(host.buildDirectRangeSelectionSourceRequest(state));
            if (!nextSource) return;
            if (state.pointerId !== e.pointerId) return;
            state.dragReady = true;
            host.emitPressPendingLifecycle(nextSource, state.pointerType, true);
        }, MOBILE_DRAG_LONG_PRESS_MS);
    } else if (preferLongPressDrag) {
        dragTimeoutId = window.setTimeout(() => {
            if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'range')) return;
            const state = host.gesture.selection.rangeSelect;
            if (state.pointerId !== e.pointerId) return;
            if (!state.preferLongPressDrag || state.selectionGestureStarted) return;
            state.dragReady = true;
            const nextSource = host.resolveDragSource(host.buildActiveRangeSelectionSourceRequest(state));
            if (!nextSource) return;
            host.emitPressPendingLifecycle(nextSource, state.pointerType, true);
        }, MOUSE_RANGE_SELECT_LONG_PRESS_MS);
    }
    if (!shouldDeferInterception) {
        e.preventDefault();
        e.stopPropagation();
        host.pointer.tryCapturePointer(e);
    }

    const timeoutId = skipLongPress
        ? null
        : window.setTimeout(() => {
            if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'range')) return;
            const state = host.gesture.selection.rangeSelect;
            if (state.pointerId !== e.pointerId) return;
            state.longPressReady = true;
            const nextSource = host.resolveDragSource(host.buildActiveRangeSelectionSourceRequest(state));
            if (nextSource) host.emitPressPendingLifecycle(nextSource, state.pointerType, true);
            activateMouseRangeSelectInterception(host, state);
            updateMouseRangeSelectionFromLine(host, state, state.currentLineNumber);
        }, config.longPressMs);

    initialRangeSelectState.isIntercepting = !shouldDeferInterception;
    initialRangeSelectState.timeoutId = timeoutId;
    initialRangeSelectState.dragTimeoutId = dragTimeoutId;
    host.gesture = {
        phase: 'selecting',
        selection: { mode: 'range', rangeSelect: initialRangeSelectState },
    };
    host.pointer.attachPointerListeners();
    const isPressReady = skipLongPress && !preferLongPressDrag;
    const initialSource = host.resolveDragSource(host.buildActiveRangeSelectionSourceRequest(initialRangeSelectState));
    if (initialSource) host.emitPressPendingLifecycle(initialSource, pointerType, isPressReady);
    if (skipLongPress && !preferLongPressDrag) {
        updateMouseRangeSelectionFromLine(host, initialRangeSelectState, initialRangeSelectState.currentLineNumber);
    }
}

export function activateMouseRangeSelectInterception(
    host: RangeSelectionActionHost,
    state: MouseRangeSelectState
): void {
    host.pointer.tryCapturePointerById(state.pointerId);
    if (state.isIntercepting) return;
    state.isIntercepting = true;
}

export function clearMouseRangeSelectState(
    host: Pick<RangeSelectionActionHost, 'gesture' | 'rangeVisual' | 'committedRangeSelection'>,
    options?: { preserveVisual?: boolean }
): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'range')) return;
    const state = host.gesture.selection.rangeSelect;
    if (state.timeoutId !== null) {
        window.clearTimeout(state.timeoutId);
    }
    if (state.dragTimeoutId !== null) {
        window.clearTimeout(state.dragTimeoutId);
    }
    host.gesture = { phase: 'idle' };
    if (!options?.preserveVisual) {
        if (host.committedRangeSelection) {
            host.rangeVisual.render(host.committedRangeSelection.blocks);
        } else {
            host.rangeVisual.clear();
        }
    }
}

export function updateMouseRangeSelectionFromLine(
    host: Pick<RangeSelectionActionHost, 'view' | 'rangeVisual'>,
    state: MouseRangeSelectState,
    lineNumber: number
): void {
    updateSelectionFromLineByFlow(host.view, state, lineNumber, host.rangeVisual);
    state.selectionGestureStarted = true;
}

export function updateMouseRangeSelection(
    host: Pick<RangeSelectionActionHost, 'view' | 'rangeVisual'>,
    state: MouseRangeSelectState,
    target: RangeSelectionBoundary
): void {
    updateSelectionFromBoundaryByFlow(host.view, state, target, host.rangeVisual);
    state.selectionGestureStarted = true;
}
