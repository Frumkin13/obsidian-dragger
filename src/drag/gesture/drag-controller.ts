import { EditorView } from '@codemirror/view';
import { detectBlock } from '../../domain/block/block-detector';
import { BlockInfo, BlockType } from '../../domain/block/block-types';
import { DragLifecycleEvent } from '../../shared/types/drag';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    MOBILE_SELECTION_CONVERT_CLASS,
    MOBILE_SELECTION_DELETE_CLASS,
    MOBILE_SELECTION_DONE_CLASS,
    RANGE_SELECTION_FLOATING_GRIP_CLASS,
} from '../../shared/dom-selectors';
import { RangeSelectionVisualManager } from './range-selection/selection-visual-manager';
import { MobileGestureController } from './mobile-gesture-controller';
import { PointerSessionController } from './pointer-session-controller';
import {
    type RangeSelectionBoundary,
    type CommittedRangeSelection,
    type MouseRangeSelectState,
    type RangeSelectionOperation,
    buildRangeSelectionBoundaryFromBlock,
} from './range-selection/selection-model';
import { resolveRangeBoundaryAtPoint } from './range-selection/hit-boundary';
import {
    shouldClearCommittedSelectionOnPointerDown as shouldClearCommittedSelectionOnPointerDownByGrip,
    isCommittedSelectionGripHit as isCommittedSelectionGripHitByGrip,
} from './range-selection/selection-grip-hit';
import {
    resolveRangeSelectConfig,
    createInitialRangeSelectionState,
} from './range-selection/selection-session-flow';
import {
    GestureCancelReason,
    InteractionState,
    PointerTerminalMode,
} from './drag-interaction-state';
import {
    autoScrollSelectionRange as autoScrollSelectionRangeByFlow,
    clearCommittedSelectionRange as clearCommittedSelectionRangeByFlow,
    cloneCommittedSelectionBlock as cloneCommittedSelectionBlockByFlow,
    commitSelectionRange as commitSelectionRangeByFlow,
    deleteCommittedSelectionRange as deleteCommittedSelectionRangeByFlow,
    refreshSelectionVisual as refreshSelectionVisualByFlow,
    updateSelectionFromBoundary as updateSelectionFromBoundaryByFlow,
    updateSelectionFromLine as updateSelectionFromLineByFlow,
} from './range-selection/selection-flow';
import { cloneSelectedBlocks } from './range-selection/block-selection';
import {
    buildCancelledLifecycleEvent,
    buildDragStartedLifecycleEvent,
    buildIdleLifecycleEvent,
    buildPressPendingLifecycleEvent,
} from './drag-lifecycle-flow';
import {
    isMobileEnvironment as isMobileEnvironmentByFlow,
    shouldStartMobilePressDrag as shouldStartMobilePressDragByFlow,
} from './drag-pointer-flow';

const MOBILE_DRAG_LONG_PRESS_MS = 200;
const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;
const MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX = 12;
const TOUCH_RANGE_SELECT_LONG_PRESS_MS = 900;
const MIN_TOUCH_RANGE_SELECT_LONG_PRESS_MS = 300;
const MAX_TOUCH_RANGE_SELECT_LONG_PRESS_MS = 2000;
const MOUSE_RANGE_SELECT_LONG_PRESS_MS = 260;
const MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX = 4;

export interface DragEventHandlerDeps {
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null;
    getVisibleHandleForBlockStart?: (blockStart: number) => HTMLElement | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMultiLineSelectionEnabled?: () => boolean;
    getMultiLineSelectionLongPressMs?: () => number;
    isMobileTextLongPressDragEnabled?: () => boolean;
    beginPointerDragSession: (blockInfo: BlockInfo) => void;
    finishDragSession: () => void;
    scheduleDropIndicatorUpdate: (clientX: number, clientY: number, dragSource: BlockInfo | null, pointerType: string | null) => void;
    hideDropIndicator: () => void;
    performDropAtPoint: (sourceBlock: BlockInfo, clientX: number, clientY: number, pointerType: string | null) => void;
    onDragLifecycleEvent?: (event: DragLifecycleEvent) => void;
    openBlockTypeMenu?: (blockInfo: BlockInfo, event: MouseEvent | PointerEvent | null) => void;
}

export class DragEventHandler {
    private gesture: InteractionState = { phase: 'idle' };
    private committedRangeSelection: CommittedRangeSelection | null = null;
    readonly rangeVisual: RangeSelectionVisualManager;
    readonly mobile: MobileGestureController;
    readonly pointer: PointerSessionController;

    private readonly onEditorPointerDown = (e: PointerEvent) => {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (!target) return;
        if (target.closest(`.${MOBILE_SELECTION_DELETE_CLASS}`)) return;
        if (target.closest(`.${MOBILE_SELECTION_CONVERT_CLASS}`)) return;
        if (target.closest(`.${MOBILE_SELECTION_DONE_CLASS}`)) return;
        const pointerType = e.pointerType || null;
        const multiLineSelectionEnabled = this.isMultiLineSelectionEnabled();
        if (!multiLineSelectionEnabled) {
            this.clearCommittedRangeSelection();
        }
        const canHandleCommittedSelection = (
            multiLineSelectionEnabled
            && e.button === 0
            && !!this.committedRangeSelection
        );
        if (canHandleCommittedSelection && this.shouldClearCommittedSelectionOnPointerDown(target, e.clientX, pointerType)) {
            this.clearCommittedRangeSelection();
        }

        const handle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
        if (handle && !handle.classList.contains(EMBED_HANDLE_CLASS)) {
            if (this.retargetActiveMobileRangeSelectionFromHandle(handle, e)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this.startPointerDragFromHandle(handle, e);
            return;
        }

        if (canHandleCommittedSelection && this.isSelectionDragGripHit(target, e.clientX, e.clientY, pointerType)) {
            const committedBlock = this.getCommittedSelectionBlock();
            if (committedBlock) {
                if (this.gesture.phase === 'range_selecting') {
                    this.retargetMobileRangeSelection(e);
                } else {
                    this.beginPressPendingDrag(committedBlock, e);
                }
                return;
            }
        }

        if (!this.shouldStartMobilePressDrag(e)) return;
        const inTextLineOrEmbedArea = this.isMobileTextLongPressDragEnabled()
            && this.mobile.isWithinMobileTextLineOrEmbedArea(target, e.clientX, e.clientY);
        if (!inTextLineOrEmbedArea) return;

        const blockInfo = this.deps.getBlockInfoAtPoint(e.clientX, e.clientY);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

        if (this.shouldDisableMobileTextLongPressDragInInputState()) return;
        // Keep native tap-to-focus behavior in text/embed areas.
        this.beginPressPendingDrag(blockInfo, e, { deferInterception: true });
    };

    private readonly onLostPointerCapture = (e: PointerEvent) => this.handleLostPointerCapture(e);
    private readonly onDocumentFocusIn = (e: FocusEvent) => this.handleDocumentFocusIn(e);
    private readonly onEnterMobileSelectionMode = (e: Event) => this.handleEnterMobileSelectionMode(e);
    constructor(
        private readonly view: EditorView,
        private readonly deps: DragEventHandlerDeps
    ) {
        this.rangeVisual = new RangeSelectionVisualManager(
            this.view,
            () => this.refreshRangeSelectionVisual(),
            (blockStart) => this.deps.getVisibleHandleForBlockStart?.(blockStart) ?? null,
            this.handleSelectionOverlayAction
        );
        this.mobile = new MobileGestureController(this.view, (e) => this.handleDocumentFocusIn(e));
        this.pointer = new PointerSessionController(this.view, {
            onPointerMove: (e) => this.handlePointerMove(e),
            onPointerUp: (e) => this.handlePointerUp(e),
            onPointerCancel: (e) => this.handlePointerCancel(e),
            onWindowBlur: () => this.handleWindowBlur(),
            onDocumentVisibilityChange: () => this.handleDocumentVisibilityChange(),
            onTouchMove: (e) => this.handleTouchMove(e),
        });
    }

    attach(): void {
        const editorDom = this.view.dom;
        editorDom.addEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.addEventListener('lostpointercapture', this.onLostPointerCapture, true);
        editorDom.addEventListener('focusin', this.onDocumentFocusIn, true);
        editorDom.addEventListener('dnd:enter-mobile-selection-mode', this.onEnterMobileSelectionMode);
    }

    startPointerDragFromHandle(handle: HTMLElement, e: PointerEvent, getBlockInfo?: () => BlockInfo | null): void {
        if (this.gesture.phase !== 'idle') return;

        const blockInfo = (getBlockInfo ? getBlockInfo() : null)
            ?? this.deps.getBlockInfoForHandle(handle)
            ?? this.deps.getBlockInfoAtPoint(e.clientX, e.clientY);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

        const multiLineSelectionEnabled = this.isMultiLineSelectionEnabled();
        if (e.pointerType === 'mouse') {
            if (e.button !== 0) return;
            if (multiLineSelectionEnabled) {
                if (this.committedRangeSelection) {
                    this.beginRangeSelectionSession(blockInfo, e, handle, { skipLongPress: true });
                    return;
                }

                if (this.isShiftRangeSelectionPointerDown(e)) {
                    this.beginRangeSelectionSession(blockInfo, e, handle, { skipLongPress: true });
                    return;
                }

                this.beginRangeSelectionSession(blockInfo, e, handle);
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            this.pointer.tryCapturePointer(e);
            this.enterDraggingState(blockInfo, e.pointerId, e.clientX, e.clientY, e.pointerType || null);
            return;
        }

        if (this.isMobileEnvironment()) {
            if (multiLineSelectionEnabled && this.committedRangeSelection) {
                this.beginRangeSelectionSession(blockInfo, e, handle, { skipLongPress: true });
                return;
            }
            this.beginPressPendingDrag(blockInfo, e);
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        this.pointer.tryCapturePointer(e);
        this.enterDraggingState(blockInfo, e.pointerId, e.clientX, e.clientY, e.pointerType || null);
    }

    destroy(): void {
        this.resetInteractionSession({ shouldFinishDragSession: true, shouldHideDropIndicator: true });
        this.clearCommittedRangeSelection();
        this.rangeVisual.destroy();

        const editorDom = this.view.dom;
        editorDom.removeEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.removeEventListener('lostpointercapture', this.onLostPointerCapture, true);
        editorDom.removeEventListener('focusin', this.onDocumentFocusIn, true);
        editorDom.removeEventListener('dnd:enter-mobile-selection-mode', this.onEnterMobileSelectionMode);
    }

    isGestureActive(): boolean {
        return this.hasActivePointerSession();
    }

    refreshSelectionVisual(): void {
        if (!this.isMultiLineSelectionEnabled()) {
            this.clearCommittedRangeSelection();
            return;
        }
        this.rangeVisual.scheduleRefresh();
    }

    private isMobileEnvironment(): boolean {
        return isMobileEnvironmentByFlow();
    }

    private shouldStartMobilePressDrag(e: PointerEvent): boolean {
        if (this.gesture.phase !== 'idle') return false;
        if (!this.isMobileEnvironment()) return false;
        return shouldStartMobilePressDragByFlow(e);
    }

    private shouldDisableMobileTextLongPressDragInInputState(): boolean {
        if (!this.view.hasFocus) return false;
        return this.view.state.selection.main.empty;
    }

    private isShiftRangeSelectionPointerDown(e: PointerEvent): boolean {
        return e.shiftKey === true;
    }

    private beginRangeSelectionSession(
        blockInfo: BlockInfo,
        e: PointerEvent,
        handle: HTMLElement | null,
        options?: { skipLongPress?: boolean; initialOperation?: RangeSelectionOperation }
    ): void {
        const committedBlocksSnapshot = cloneSelectedBlocks(this.committedRangeSelection?.blocks ?? []);
        const pointerType = e.pointerType || null;
        const skipLongPress = options?.skipLongPress === true;
        const config = resolveRangeSelectConfig(
            pointerType,
            MOUSE_RANGE_SELECT_LONG_PRESS_MS,
            () => this.getTouchRangeSelectLongPressMs()
        );
        const shouldDeferInterception = pointerType === 'mouse' && !skipLongPress;
        const initialRangeSelectState = createInitialRangeSelectionState({
            blockInfo,
            doc: this.view.state.doc,
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
            && !!this.committedRangeSelection
        );
        initialRangeSelectState.preferLongPressDrag = preferLongPressDrag;
        if (preferLongPressDrag) {
            initialRangeSelectState.dragReady = false;
        }
        initialRangeSelectState.longPressReady = skipLongPress;

        let dragTimeoutId: number | null = null;
        if (pointerType !== 'mouse') {
            dragTimeoutId = window.setTimeout(() => {
                if (this.gesture.phase !== 'range_selecting') return;
                const state = this.gesture.rangeSelect;
                if (state.pointerId !== e.pointerId) return;
                state.dragReady = true;
                this.emitPressPendingLifecycle(state.directDragSourceBlock, state.pointerType, true);
            }, MOBILE_DRAG_LONG_PRESS_MS);
        } else if (preferLongPressDrag) {
            dragTimeoutId = window.setTimeout(() => {
                if (this.gesture.phase !== 'range_selecting') return;
                const state = this.gesture.rangeSelect;
                if (state.pointerId !== e.pointerId) return;
                if (!state.preferLongPressDrag || state.selectionGestureStarted) return;
                state.dragReady = true;
                this.emitPressPendingLifecycle(state.activeSelectionBlock, state.pointerType, true);
            }, MOUSE_RANGE_SELECT_LONG_PRESS_MS);
        }
        if (!shouldDeferInterception) {
            e.preventDefault();
            e.stopPropagation();
            this.pointer.tryCapturePointer(e);
        }

        const timeoutId = skipLongPress
            ? null
            : window.setTimeout(() => {
                if (this.gesture.phase !== 'range_selecting') return;
                const state = this.gesture.rangeSelect;
                if (state.pointerId !== e.pointerId) return;
                state.longPressReady = true;
                this.emitPressPendingLifecycle(state.activeSelectionBlock, state.pointerType, true);
                this.activateMouseRangeSelectInterception(state);
                this.updateMouseRangeSelectionFromLine(state, state.currentLineNumber);
            }, config.longPressMs);

        initialRangeSelectState.isIntercepting = !shouldDeferInterception;
        initialRangeSelectState.timeoutId = timeoutId;
        initialRangeSelectState.dragTimeoutId = dragTimeoutId;
        this.gesture = {
            phase: 'range_selecting',
            rangeSelect: initialRangeSelectState,
        };
        this.pointer.attachPointerListeners();
        const isPressReady = skipLongPress && !preferLongPressDrag;
        this.emitPressPendingLifecycle(blockInfo, pointerType, isPressReady);
        if (skipLongPress && !preferLongPressDrag) {
            this.updateMouseRangeSelectionFromLine(initialRangeSelectState, initialRangeSelectState.currentLineNumber);
        }
    }

    private activateMouseRangeSelectInterception(state: MouseRangeSelectState): void {
        this.pointer.tryCapturePointerById(state.pointerId);
        if (state.isIntercepting) return;
        state.isIntercepting = true;
    }

    private beginPressPendingDrag(
        blockInfo: BlockInfo,
        e: PointerEvent,
        options?: { skipLongPress?: boolean; deferInterception?: boolean }
    ): void {
        const pointerType = e.pointerType || null;
        const suppressNativeInteraction = options?.deferInterception !== true;
        if (suppressNativeInteraction) {
            e.preventDefault();
            e.stopPropagation();
            this.pointer.tryCapturePointer(e);
            if (pointerType !== 'mouse') {
                this.mobile.lockMobileInteraction();
                this.mobile.attachFocusGuard();
                this.mobile.suppressMobileKeyboard();
            }
        }
        const skipLongPress = options?.skipLongPress === true;
        const longPressMs = pointerType === 'mouse'
            ? MOUSE_RANGE_SELECT_LONG_PRESS_MS
            : MOBILE_DRAG_LONG_PRESS_MS;
        const timeoutId = skipLongPress
            ? null
            : window.setTimeout(() => {
                if (this.gesture.phase !== 'press_pending') return;
                const state = this.gesture.press;
                if (state.pointerId !== e.pointerId) return;
                state.longPressReady = true;
                if (!state.suppressNativeInteraction) {
                    state.suppressNativeInteraction = true;
                    if (state.pointerType !== 'mouse') {
                        this.mobile.lockMobileInteraction();
                        this.mobile.attachFocusGuard();
                        this.mobile.suppressMobileKeyboard();
                    }
                    this.pointer.tryCapturePointerById(state.pointerId);
                }
                this.emitPressPendingLifecycle(state.sourceBlock, state.pointerType, true);
            }, longPressMs);
        const startMoveThresholdPx = skipLongPress
            ? 2
            : (pointerType === 'mouse' ? 4 : MOBILE_DRAG_START_MOVE_THRESHOLD_PX);

        this.gesture = { phase: 'press_pending', press: {
            sourceBlock: blockInfo,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            latestX: e.clientX,
            latestY: e.clientY,
            pointerType,
            longPressReady: skipLongPress,
            timeoutId,
            cancelMoveThresholdPx: MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX,
            startMoveThresholdPx,
            suppressNativeInteraction,
        } };
        this.pointer.attachPointerListeners();
        this.emitPressPendingLifecycle(blockInfo, pointerType, skipLongPress);
    }

    private clearPointerPressState(): void {
        if (this.gesture.phase !== 'press_pending') return;
        const state = this.gesture.press;
        if (state.timeoutId !== null) {
            window.clearTimeout(state.timeoutId);
        }
        this.gesture = { phase: 'idle' };
    }

    private clearMouseRangeSelectState(options?: { preserveVisual?: boolean }): void {
        if (this.gesture.phase !== 'range_selecting') return;
        const state = this.gesture.rangeSelect;
        if (state.timeoutId !== null) {
            window.clearTimeout(state.timeoutId);
        }
        if (state.dragTimeoutId !== null) {
            window.clearTimeout(state.dragTimeoutId);
        }
        this.gesture = { phase: 'idle' };
        if (!options?.preserveVisual) {
            if (this.committedRangeSelection) {
                this.rangeVisual.render(
                    this.committedRangeSelection.blocks
                );
            } else {
                this.rangeVisual.clear();
            }
        }
    }

    private enterDraggingState(
        sourceBlock: BlockInfo,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): void {
        if (this.mobile.isMobileEnvironment()) {
            this.mobile.lockMobileInteraction();
            this.mobile.attachFocusGuard();
            this.mobile.suppressMobileKeyboard();
            this.mobile.triggerMobileHapticFeedback();
        }
        this.pointer.tryCapturePointerById(pointerId);
        this.pointer.attachPointerListeners();
        this.gesture = { phase: 'dragging', drag: { sourceBlock, pointerId } };
        this.deps.beginPointerDragSession(sourceBlock);
        this.deps.scheduleDropIndicatorUpdate(clientX, clientY, sourceBlock, pointerType);
        this.emitDragStartedLifecycle(sourceBlock, pointerType);
    }


    private handlePointerMove(e: PointerEvent): void {
        switch (this.gesture.phase) {
            case 'dragging':
                this.handleDraggingPointerMove(e);
                return;
            case 'range_selecting':
                this.handleRangeSelectingPointerMove(e);
                return;
            case 'press_pending':
                this.handlePressPendingPointerMove(e);
                return;
            default:
                return;
        }
    }

    private handleDraggingPointerMove(e: PointerEvent): void {
        if (this.gesture.phase !== 'dragging') return;
        const dragState = this.gesture.drag;
        if (e.pointerId !== dragState.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, dragState.sourceBlock, e.pointerType || null);
    }

    private handleRangeSelectingPointerMove(e: PointerEvent): void {
        if (this.gesture.phase !== 'range_selecting') return;
        const rangeState = this.gesture.rangeSelect;
        if (rangeState.pointerId !== -1 && e.pointerId !== rangeState.pointerId) return;
        this.handleRangeSelectionPointerMove(e, rangeState);
    }

    private handlePressPendingPointerMove(e: PointerEvent): void {
        if (this.gesture.phase !== 'press_pending') return;
        const pressState = this.gesture.press;
        if (e.pointerId !== pressState.pointerId) return;

        pressState.latestX = e.clientX;
        pressState.latestY = e.clientY;

        const dx = e.clientX - pressState.startX;
        const dy = e.clientY - pressState.startY;
        const distance = Math.hypot(dx, dy);

        if (!pressState.longPressReady) {
            if (distance > pressState.cancelMoveThresholdPx) {
                this.abortForGestureCancel('press_cancelled', e.pointerType || null);
            }
            return;
        }

        if (distance < pressState.startMoveThresholdPx) return;

        e.preventDefault();
        e.stopPropagation();
        const sourceBlock = pressState.sourceBlock;
        const pointerId = pressState.pointerId;
        this.clearCommittedRangeSelection();
        this.clearPointerPressState();
        this.enterDraggingState(sourceBlock, pointerId, e.clientX, e.clientY, e.pointerType || null);
    }

    private handleRangeSelectionPointerMove(e: PointerEvent, state: MouseRangeSelectState): void {
        state.latestX = e.clientX;
        state.latestY = e.clientY;
        const pointerType = state.pointerType ?? (e.pointerType || null);
        const distance = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;

        if (state.pointerId === -1 && pointerType !== 'mouse' && this.mobile.isMostlyVerticalScrollGesture(dx, dy)) {
            this.commitRangeSelection(state);
            this.finishRangeSelectionSession();
            return;
        }

        if (!state.longPressReady) {
            if (pointerType === 'mouse') {
                if (distance >= MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX) {
                    e.preventDefault();
                    e.stopPropagation();
                    const sourceBlock = state.directDragSourceBlock;
                    const pointerId = state.pointerId;
                    this.clearCommittedRangeSelection();
                    this.clearMouseRangeSelectState();
                    this.enterDraggingState(sourceBlock, pointerId, e.clientX, e.clientY, pointerType);
                }
            } else {
                if (!state.dragReady) {
                    if (distance > MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX) {
                        this.abortForGestureCancel('press_cancelled', pointerType);
                    }
                    return;
                }
                if (distance >= MOBILE_DRAG_START_MOVE_THRESHOLD_PX) {
                    e.preventDefault();
                    e.stopPropagation();
                    const sourceBlock = state.directDragSourceBlock;
                    const pointerId = state.pointerId;
                    this.clearCommittedRangeSelection();
                    this.clearMouseRangeSelectState();
                    this.enterDraggingState(sourceBlock, pointerId, e.clientX, e.clientY, pointerType);
                }
            }
            return;
        }

        if (
            pointerType === 'mouse'
            && state.preferLongPressDrag
            && !state.selectionGestureStarted
        ) {
            if (!state.dragReady) {
                if (distance < MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX) {
                    return;
                }
            } else {
                if (distance < MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                const sourceBlock = this.getCommittedSelectionBlock() ?? state.activeSelectionBlock;
                const pointerId = state.pointerId;
                this.clearCommittedRangeSelection();
                this.clearMouseRangeSelectState();
                this.enterDraggingState(sourceBlock, pointerId, e.clientX, e.clientY, pointerType);
                return;
            }
        }

        this.activateMouseRangeSelectInterception(state);
        e.preventDefault();
        e.stopPropagation();

        const targetBoundary = this.resolveHandleRangeBoundaryAtPoint(e.clientX, e.clientY)
            ?? resolveRangeBoundaryAtPoint(this.view, e.clientX, e.clientY, (x, y) => this.deps.getBlockInfoAtPoint(x, y));
        if (targetBoundary) {
            this.updateMouseRangeSelection(state, targetBoundary);
        }

        this.maybeAutoScrollRangeSelection(e.clientY);
    }

    private maybeAutoScrollRangeSelection(clientY: number): void {
        autoScrollSelectionRangeByFlow(this.view, clientY);
    }

    private updateMouseRangeSelectionFromLine(state: MouseRangeSelectState, lineNumber: number): void {
        updateSelectionFromLineByFlow(this.view, state, lineNumber, this.rangeVisual);
        state.selectionGestureStarted = true;
    }

    private updateMouseRangeSelection(state: MouseRangeSelectState, target: RangeSelectionBoundary): void {
        updateSelectionFromBoundaryByFlow(this.view, state, target, this.rangeVisual);
        state.selectionGestureStarted = true;
    }

    private resolveHandleRangeBoundaryAtPoint(clientX: number, clientY: number): RangeSelectionBoundary | null {
        if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
            return null;
        }
        const hit = document.elementFromPoint(clientX, clientY);
        if (!(hit instanceof HTMLElement)) return null;

        const handle = hit.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
        if (!handle || handle.classList.contains(EMBED_HANDLE_CLASS)) return null;
        if (!this.view.dom.contains(handle)) return null;

        const blockInfo = this.deps.getBlockInfoForHandle(handle);
        if (!blockInfo) return null;
        return buildRangeSelectionBoundaryFromBlock(this.view.state.doc, blockInfo);
    }

    private retargetMobileRangeSelection(e: PointerEvent): void {
        if (this.gesture.phase !== 'range_selecting') return;
        const state = this.gesture.rangeSelect;
        if (state.pointerType === 'mouse') return;
        state.pointerId = e.pointerId;
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.latestX = e.clientX;
        state.latestY = e.clientY;
        state.longPressReady = true;
        state.dragReady = false;
        state.isIntercepting = true;
        if (state.dragTimeoutId !== null) {
            window.clearTimeout(state.dragTimeoutId);
            state.dragTimeoutId = null;
        }
        e.preventDefault();
        e.stopPropagation();
        this.pointer.tryCapturePointer(e);
    }

    private retargetActiveMobileRangeSelectionFromHandle(handle: HTMLElement, e: PointerEvent): boolean {
        if (this.gesture.phase !== 'range_selecting') return false;
        const state = this.gesture.rangeSelect;
        if (state.pointerType === 'mouse') return false;
        if (e.pointerType === 'mouse') return false;
        const blockInfo = this.deps.getBlockInfoForHandle(handle)
            ?? this.deps.getBlockInfoAtPoint(e.clientX, e.clientY);
        if (!blockInfo) return false;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return false;
        this.retargetMobileRangeSelection(e);
        this.updateMouseRangeSelection(state, buildRangeSelectionBoundaryFromBlock(this.view.state.doc, blockInfo));
        return true;
    }

    private commitRangeSelection(state: MouseRangeSelectState): void {
        this.committedRangeSelection = commitSelectionRangeByFlow(this.view, state, this.rangeVisual);
    }

    private clearCommittedRangeSelection(): void {
        this.committedRangeSelection = clearCommittedSelectionRangeByFlow(this.committedRangeSelection, this.rangeVisual);
    }

    private deleteCommittedRangeSelection(): void {
        this.committedRangeSelection = deleteCommittedSelectionRangeByFlow(
            this.view,
            this.committedRangeSelection,
            this.rangeVisual
        );
    }

    private handleSelectionOverlayAction = (action: 'delete' | 'done' | 'convert'): void => {
        if (action === 'delete') {
            this.deleteCommittedRangeSelection();
            return;
        }
        if (action === 'convert') {
            const block = this.getCommittedSelectionBlock();
            if (block) {
                this.deps.openBlockTypeMenu?.(block, null);
            }
            return;
        }
        this.clearCommittedRangeSelection();
    };

    private getCommittedSelectionBlock(): BlockInfo | null {
        return cloneCommittedSelectionBlockByFlow(this.committedRangeSelection);
    }

    private refreshRangeSelectionVisual(): void {
        refreshSelectionVisualByFlow(this.gesture, this.committedRangeSelection, this.rangeVisual);
    }

    private finishRangeSelectionSession(): void {
        this.clearMouseRangeSelectState({ preserveVisual: true });
        this.pointer.detachPointerListeners();
        this.pointer.releasePointerCapture();
        this.mobile.unlockMobileInteraction();
        this.mobile.detachFocusGuard();
        this.emitIdleLifecycle();
    }

    private shouldClearCommittedSelectionOnPointerDown(
        target: HTMLElement,
        clientX: number,
        pointerType: string | null
    ): boolean {
        return shouldClearCommittedSelectionOnPointerDownByGrip({
            committedSelection: this.committedRangeSelection,
            target,
            clientX,
            pointerType,
            resolveAnchorSpan: (range) => this.rangeVisual.resolveRangeAnchorSpan(range),
            isWithinContentTolerance: (x) => this.mobile.isWithinContentTolerance(x),
            contentDOM: this.view.contentDOM,
        });
    }

    private isSelectionDragGripHit(
        target: HTMLElement,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): boolean {
        if (target.closest(`.${RANGE_SELECTION_FLOATING_GRIP_CLASS}`)) return true;
        return isCommittedSelectionGripHitByGrip({
            committedSelection: this.committedRangeSelection,
            target,
            clientX,
            clientY,
            pointerType,
            resolveAnchorSpan: (range) => this.rangeVisual.resolveRangeAnchorSpan(range),
            isWithinMobileDragHotzoneBand: () => true,
        });
    }

    private finishPointerDrag(e: PointerEvent, shouldDrop: boolean): void {
        if (this.gesture.phase !== 'dragging') return;
        const state = this.gesture.drag;
        if (e.pointerId !== state.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        if (shouldDrop) {
            this.deps.performDropAtPoint(state.sourceBlock, e.clientX, e.clientY, e.pointerType || null);
        }
        this.resetInteractionSession({
            shouldFinishDragSession: true,
            shouldHideDropIndicator: true,
            cancelReason: shouldDrop ? null : 'pointer_cancelled',
            pointerType: e.pointerType || null,
        });
    }

    private handlePointerUp(e: PointerEvent): void {
        this.handlePointerTerminalEvent(e, 'up');
    }

    private handlePointerCancel(e: PointerEvent): void {
        this.handlePointerTerminalEvent(e, 'cancel');
    }

    private handleLostPointerCapture(e: PointerEvent): void {
        if (!this.hasActivePointerSession()) return;
        this.abortForSessionInterrupted(e.pointerType || null);
    }

    private handleWindowBlur(): void {
        if (!this.hasActivePointerSession()) return;
        this.abortForSessionInterrupted(null);
    }

    private handleDocumentVisibilityChange(): void {
        if (document.visibilityState !== 'hidden') return;
        if (!this.hasActivePointerSession()) return;
        this.abortForSessionInterrupted(null);
    }

    private handlePointerTerminalEvent(e: PointerEvent, mode: PointerTerminalMode): void {
        switch (this.gesture.phase) {
            case 'dragging':
                this.handleDraggingPointerTerminalEvent(e, mode);
                return;
            case 'range_selecting':
                this.handleRangeSelectingPointerTerminalEvent(e, mode);
                return;
            case 'press_pending':
                this.handlePressPendingPointerTerminalEvent(e, mode);
                return;
            default:
                return;
        }
    }

    private handleDraggingPointerTerminalEvent(e: PointerEvent, mode: PointerTerminalMode): void {
        this.finishPointerDrag(e, mode === 'up');
    }

    private handleRangeSelectingPointerTerminalEvent(e: PointerEvent, mode: PointerTerminalMode): void {
        if (this.gesture.phase !== 'range_selecting') return;
        const rangeState = this.gesture.rangeSelect;
        if (rangeState.pointerId !== -1 && e.pointerId !== rangeState.pointerId) return;
        if (mode === 'cancel') {
            this.abortForGestureCancel('pointer_cancelled', e.pointerType || null);
            return;
        }
        if (!rangeState.longPressReady) {
            if (mode === 'up' && rangeState.pointerType === 'mouse') {
                e.preventDefault();
                e.stopPropagation();
                this.deps.openBlockTypeMenu?.(rangeState.activeSelectionBlock, e);
                this.finishRangeSelectionSession();
                return;
            }
            this.abortForGestureCancel('press_cancelled', e.pointerType || null);
            return;
        }
        if (
            rangeState.preferLongPressDrag
            && rangeState.dragReady
            && !rangeState.selectionGestureStarted
        ) {
            this.finishRangeSelectionSession();
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        this.commitRangeSelection(rangeState);
        this.finishRangeSelectionSession();
    }

    private handlePressPendingPointerTerminalEvent(e: PointerEvent, mode: PointerTerminalMode): void {
        if (this.gesture.phase !== 'press_pending') return;
        const pressState = this.gesture.press;
        if (e.pointerId !== pressState.pointerId) return;
        this.abortForGestureCancel(mode === 'up' ? 'press_cancelled' : 'pointer_cancelled', e.pointerType || null);
    }

    private abortForGestureCancel(
        cancelReason: GestureCancelReason,
        pointerType: string | null
    ): void {
        this.resetInteractionSession({
            shouldFinishDragSession: false,
            shouldHideDropIndicator: false,
            cancelReason,
            pointerType,
        });
    }

    private abortForSessionInterrupted(pointerType: string | null): void {
        this.resetInteractionSession({
            shouldFinishDragSession: true,
            shouldHideDropIndicator: true,
            cancelReason: 'session_interrupted',
            pointerType,
        });
    }

    private handleEnterMobileSelectionMode(e: Event): void {
        if (!this.isMobileEnvironment()) return;
        if (!this.isMultiLineSelectionEnabled()) return;
        if (this.gesture.phase !== 'idle') return;

        const line = this.view.state.doc.lineAt(this.view.state.selection.main.head);
        const detectedBlock = detectBlock(this.view.state, line.number);
        const blockInfo = detectedBlock ?? {
            type: BlockType.Paragraph,
            startLine: line.number - 1,
            endLine: line.number - 1,
            from: line.from,
            to: line.to,
            indentLevel: 0,
            content: line.text,
        };
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

        if (e instanceof CustomEvent && e.detail && typeof e.detail === 'object') {
            (e.detail as { handled?: boolean }).handled = true;
        }
        this.beginRangeSelectionSession(blockInfo, this.createSyntheticMobileSelectionPointerEvent(blockInfo), null, {
            skipLongPress: true,
            initialOperation: 'add',
        });
        this.mobile.lockMobileInteraction();
        this.mobile.attachFocusGuard();
        this.mobile.suppressMobileKeyboard(document.activeElement);
        this.emitPressPendingLifecycle(blockInfo, 'touch', true);
    }

    private createSyntheticMobileSelectionPointerEvent(blockInfo: BlockInfo): PointerEvent {
        const line = this.view.state.doc.line(Math.max(1, Math.min(this.view.state.doc.lines, blockInfo.startLine + 1)));
        const coords = this.view.coordsAtPos(line.from, 1);
        return {
            pointerId: -1,
            pointerType: 'touch',
            clientX: coords?.left ?? 0,
            clientY: coords ? ((coords.top + coords.bottom) / 2) : 0,
            button: 0,
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
        } as unknown as PointerEvent;
    }

    private handleDocumentFocusIn(e: FocusEvent): void {
        if (
            this.committedRangeSelection
            && this.isMobileEnvironment()
            && e.target instanceof HTMLElement
            && this.mobile.shouldSuppressFocusTarget(e.target)
        ) {
            this.clearCommittedRangeSelection();
        }
        if (!this.shouldSuppressNativeInteractionForActiveGesture()) return;
        this.mobile.suppressMobileKeyboard(e.target);
    }

    private handleTouchMove(e: TouchEvent): void {
        if (!this.shouldSuppressNativeInteractionForActiveGesture()) return;
        if (e.cancelable) {
            e.preventDefault();
        }
    }

    private hasActivePointerSession(): boolean {
        return this.gesture.phase !== 'idle';
    }

    private shouldSuppressNativeInteractionForActiveGesture(): boolean {
        switch (this.gesture.phase) {
            case 'dragging':
                return true;
            case 'range_selecting':
                return this.gesture.rangeSelect.isIntercepting;
            case 'press_pending':
                return this.gesture.press.suppressNativeInteraction;
            default:
                return false;
        }
    }

    private resetInteractionSession(options?: {
        shouldFinishDragSession?: boolean;
        shouldHideDropIndicator?: boolean;
        cancelReason?: string | null;
        pointerType?: string | null;
    }): void {
        const { sourceBlock, hadDrag } = this.resolveSessionResetContext();
        const shouldFinishDragSession = options?.shouldFinishDragSession ?? hadDrag;
        const shouldHideDropIndicator = options?.shouldHideDropIndicator ?? hadDrag;
        const cancelReason = options?.cancelReason ?? null;
        const pointerType = options?.pointerType ?? null;

        this.gesture = { phase: 'idle' };
        this.pointer.detachPointerListeners();
        this.pointer.releasePointerCapture();
        this.mobile.unlockMobileInteraction();
        this.mobile.detachFocusGuard();

        if (shouldHideDropIndicator) {
            this.deps.hideDropIndicator();
        }
        if (hadDrag && shouldFinishDragSession) {
            this.deps.finishDragSession();
        }
        if (cancelReason && sourceBlock) {
            this.emitCancelledLifecycle(sourceBlock, cancelReason, pointerType);
        }
        this.emitIdleLifecycle();
    }

    private resolveSessionResetContext(): { sourceBlock: BlockInfo | null; hadDrag: boolean } {
        const gesture = this.gesture;
        switch (gesture.phase) {
            case 'dragging':
                return {
                    sourceBlock: gesture.drag.sourceBlock,
                    hadDrag: true,
                };
            case 'press_pending':
                this.clearPointerPressState();
                return {
                    sourceBlock: gesture.press.sourceBlock,
                    hadDrag: false,
                };
            case 'range_selecting':
                this.clearMouseRangeSelectState();
                return {
                    sourceBlock: gesture.rangeSelect.activeSelectionBlock,
                    hadDrag: false,
                };
            default:
                return {
                    sourceBlock: null,
                    hadDrag: false,
                };
        }
    }

    private emitLifecycle(event: DragLifecycleEvent): void {
        this.deps.onDragLifecycleEvent?.(event);
    }

    private emitPressPendingLifecycle(
        sourceBlock: BlockInfo,
        pointerType: string | null,
        pressReady: boolean
    ): void {
        this.emitLifecycle(buildPressPendingLifecycleEvent(sourceBlock, pointerType, pressReady));
    }

    private emitDragStartedLifecycle(sourceBlock: BlockInfo, pointerType: string | null): void {
        this.emitLifecycle(buildDragStartedLifecycleEvent(sourceBlock, pointerType));
    }

    private emitCancelledLifecycle(
        sourceBlock: BlockInfo,
        rejectReason: string,
        pointerType: string | null
    ): void {
        this.emitLifecycle(buildCancelledLifecycleEvent({
            sourceBlock,
            rejectReason,
            pointerType,
        }));
    }

    private emitIdleLifecycle(): void {
        this.emitLifecycle(buildIdleLifecycleEvent());
    }

    private isMultiLineSelectionEnabled(): boolean {
        if (!this.deps.isMultiLineSelectionEnabled) return true;
        return this.deps.isMultiLineSelectionEnabled();
    }

    private isMobileTextLongPressDragEnabled(): boolean {
        if (!this.deps.isMobileTextLongPressDragEnabled) return true;
        return this.deps.isMobileTextLongPressDragEnabled();
    }

    private getTouchRangeSelectLongPressMs(): number {
        if (!this.deps.getMultiLineSelectionLongPressMs) {
            return TOUCH_RANGE_SELECT_LONG_PRESS_MS;
        }
        const value = this.deps.getMultiLineSelectionLongPressMs();
        if (!Number.isFinite(value)) {
            return TOUCH_RANGE_SELECT_LONG_PRESS_MS;
        }
        return Math.max(
            MIN_TOUCH_RANGE_SELECT_LONG_PRESS_MS,
            Math.min(MAX_TOUCH_RANGE_SELECT_LONG_PRESS_MS, Math.round(value))
        );
    }
}





