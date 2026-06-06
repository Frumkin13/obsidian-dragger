import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../domain/block/block-types';
import { createDragSource, DragLifecycleEvent, DragSource } from '../../shared/types/drag';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
} from '../../shared/dom-selectors';
import { RangeSelectionVisualManager } from '../state/selection/selection-visual-manager';
import { MobileGestureController } from '../state/mobile-gesture-controller';
import { PointerSessionController } from '../input/pointer-session-controller';
import {
    type RangeSelectionBoundary,
    type CommittedRangeSelection,
    type MouseRangeSelectState,
    type RangeSelectionOperation,
    buildRangeSelectionBoundaryFromBlock,
} from '../state/selection/selection-model';
import { resolveRangeBoundaryAtPoint } from '../state/selection/hit-boundary';
import {
    shouldClearCommittedSelectionOnPointerDown as shouldClearCommittedSelectionOnPointerDownByGrip,
    isCommittedSelectionGripHit as isCommittedSelectionGripHitByGrip,
} from '../state/selection/selection-grip-hit';
import {
    resolveRangeSelectConfig,
    createInitialRangeSelectionState,
} from '../state/selection/selection-session-flow';
import {
    GestureCancelReason,
    InteractionState,
    PointerTerminalMode,
} from '../state/drag-state';
import {
    autoScrollSelectionRange as autoScrollSelectionRangeByFlow,
    clearCommittedSelectionRange as clearCommittedSelectionRangeByFlow,
    cloneCommittedSelectionSource as cloneCommittedSelectionSourceByFlow,
    commitSelectionRange as commitSelectionRangeByFlow,
    deleteCommittedSelectionRange as deleteCommittedSelectionRangeByFlow,
    refreshSelectionVisual as refreshSelectionVisualByFlow,
    updateSelectionFromBoundary as updateSelectionFromBoundaryByFlow,
    updateSelectionFromLine as updateSelectionFromLineByFlow,
} from '../state/selection/selection-flow';
import { cloneSelectedBlocks } from '../state/selection/block-selection';
import {
    buildCancelledLifecycleEvent,
    buildDragStartedLifecycleEvent,
    buildIdleLifecycleEvent,
    buildPressPendingLifecycleEvent,
} from './drag-lifecycle-flow';
import {
    isMobileEnvironment as isMobileEnvironmentByFlow,
} from '../intent/drag-pointer-flow';
import { runDesktopPointerDownPipeline } from '../intent/desktop-intent';
import {
    enterMobileSelectionMode,
    finishMobileSelectionPointer,
    getMobileSelectionTemplateBlock,
    handleMobileSelectingPointerMove,
    runMobilePointerDownPipeline,
} from '../intent/mobile-intent';

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
    beginPointerDragSession: (source: DragSource) => void;
    finishDragSession: () => void;
    scheduleDropIndicatorUpdate: (clientX: number, clientY: number, source: DragSource | null, pointerType: string | null) => void;
    hideDropIndicator: () => void;
    performDropAtPoint: (source: DragSource, clientX: number, clientY: number, pointerType: string | null) => void;
    onDragLifecycleEvent?: (event: DragLifecycleEvent) => void;
    openBlockTypeMenu?: (blockInfo: BlockInfo, event: MouseEvent | PointerEvent | null) => void;
}

export class DragEventHandler {
    gesture: InteractionState = { phase: 'idle' };
    committedRangeSelection: CommittedRangeSelection | null = null;
    readonly rangeVisual: RangeSelectionVisualManager;
    readonly mobile: MobileGestureController;
    readonly pointer: PointerSessionController;

    private readonly onEditorPointerDown = (e: PointerEvent) => {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (!target) return;

        this.runPointerDownPrelude(e, target);

        if (this.resolvePointerDownMode(e) === 'mobile') {
            runMobilePointerDownPipeline(this, e, target);
            return;
        }

        runDesktopPointerDownPipeline(this, e, target);
    };

    private readonly onLostPointerCapture = (e: PointerEvent) => this.handleLostPointerCapture(e);
    private readonly onWindowKeyDown = (e: KeyboardEvent) => this.handleWindowKeyDown(e);
    private readonly onDocumentFocusIn = (e: FocusEvent) => this.handleDocumentFocusIn(e);
    private readonly onEnterMobileSelectionMode = (e: Event) => this.handleEnterMobileSelectionMode(e);
    constructor(
        readonly view: EditorView,
        readonly deps: DragEventHandlerDeps
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
        window.addEventListener('keydown', this.onWindowKeyDown, true);
        editorDom.addEventListener('focusin', this.onDocumentFocusIn, true);
        editorDom.addEventListener('dnd:enter-mobile-selection-mode', this.onEnterMobileSelectionMode);
    }

    destroy(): void {
        this.resetInteractionSession({ shouldFinishDragSession: true, shouldHideDropIndicator: true });
        this.clearCommittedRangeSelection();
        this.rangeVisual.destroy();

        const editorDom = this.view.dom;
        editorDom.removeEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.removeEventListener('lostpointercapture', this.onLostPointerCapture, true);
        window.removeEventListener('keydown', this.onWindowKeyDown, true);
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

    private runPointerDownPrelude(e: PointerEvent, target: HTMLElement): void {
        if (!this.isMultiLineSelectionEnabled()) {
            this.clearCommittedRangeSelection();
            return;
        }

        const pointerType = e.pointerType || null;
        const canHandleCommittedSelection = e.button === 0 && !!this.committedRangeSelection;
        if (canHandleCommittedSelection && this.shouldClearCommittedSelectionOnPointerDown(target, e.clientX, pointerType)) {
            this.clearCommittedRangeSelection();
        }
    }

    private resolvePointerDownMode(e: PointerEvent): 'desktop' | 'mobile' {
        if (e.pointerType === 'mouse') return 'desktop';
        return this.isMobileEnvironment() ? 'mobile' : 'desktop';
    }

    private isMobileEnvironment(): boolean {
        return isMobileEnvironmentByFlow();
    }

    beginRangeSelectionSession(
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
                this.emitPressPendingLifecycle(state.directDragSource, state.pointerType, true);
            }, MOBILE_DRAG_LONG_PRESS_MS);
        } else if (preferLongPressDrag) {
            dragTimeoutId = window.setTimeout(() => {
                if (this.gesture.phase !== 'range_selecting') return;
                const state = this.gesture.rangeSelect;
                if (state.pointerId !== e.pointerId) return;
                if (!state.preferLongPressDrag || state.selectionGestureStarted) return;
                state.dragReady = true;
                this.emitPressPendingLifecycle(state.activeSelectionSource, state.pointerType, true);
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
                this.emitPressPendingLifecycle(state.activeSelectionSource, state.pointerType, true);
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
        this.emitPressPendingLifecycle(initialRangeSelectState.activeSelectionSource, pointerType, isPressReady);
        if (skipLongPress && !preferLongPressDrag) {
            this.updateMouseRangeSelectionFromLine(initialRangeSelectState, initialRangeSelectState.currentLineNumber);
        }
    }

    private activateMouseRangeSelectInterception(state: MouseRangeSelectState): void {
        this.pointer.tryCapturePointerById(state.pointerId);
        if (state.isIntercepting) return;
        state.isIntercepting = true;
    }

    beginPressPendingDrag(
        source: DragSource,
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
                this.emitPressPendingLifecycle(state.source, state.pointerType, true);
            }, longPressMs);
        const startMoveThresholdPx = skipLongPress
            ? 2
            : (pointerType === 'mouse' ? 4 : MOBILE_DRAG_START_MOVE_THRESHOLD_PX);

        this.gesture = { phase: 'press_pending', press: {
            source,
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
        this.emitPressPendingLifecycle(source, pointerType, skipLongPress);
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

    enterDraggingState(
        source: DragSource,
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
        this.gesture = {
            phase: 'dragging',
            drag: {
                source,
                pointerId,
                latestX: clientX,
                latestY: clientY,
                pointerType,
                autoScrollFrameId: null,
            },
        };
        this.deps.beginPointerDragSession(source);
        this.deps.scheduleDropIndicatorUpdate(clientX, clientY, source, pointerType);
        this.emitDragStartedLifecycle(source, pointerType);
    }


    private handlePointerMove(e: PointerEvent): void {
        switch (this.gesture.phase) {
            case 'dragging':
                this.handleDraggingPointerMove(e);
                return;
            case 'range_selecting':
                this.handleRangeSelectingPointerMove(e);
                return;
            case 'mobile_selecting':
                handleMobileSelectingPointerMove(this, e);
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
        dragState.latestX = e.clientX;
        dragState.latestY = e.clientY;
        dragState.pointerType = e.pointerType || dragState.pointerType;
        e.preventDefault();
        e.stopPropagation();
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, dragState.source, e.pointerType || null);
        if (this.autoScrollDrag(dragState)) {
            this.scheduleDragAutoScroll(dragState);
        }
    }

    private autoScrollDrag(dragState: { latestX: number; latestY: number; source: DragSource; pointerType: string | null }): boolean {
        const didScroll = autoScrollSelectionRangeByFlow(this.view, dragState.latestY);
        if (didScroll) {
            this.deps.scheduleDropIndicatorUpdate(dragState.latestX, dragState.latestY, dragState.source, dragState.pointerType);
        }
        return didScroll;
    }

    private scheduleDragAutoScroll(dragState: { autoScrollFrameId: number | null }): void {
        if (dragState.autoScrollFrameId !== null) return;
        dragState.autoScrollFrameId = window.requestAnimationFrame(() => {
            if (this.gesture.phase !== 'dragging') return;
            const state = this.gesture.drag;
            state.autoScrollFrameId = null;
            if (!this.autoScrollDrag(state)) return;
            this.scheduleDragAutoScroll(state);
        });
    }

    private cancelDragAutoScroll(dragState: { autoScrollFrameId: number | null }): void {
        if (dragState.autoScrollFrameId === null) return;
        window.cancelAnimationFrame(dragState.autoScrollFrameId);
        dragState.autoScrollFrameId = null;
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
        const source = pressState.source;
        const pointerId = pressState.pointerId;
        this.clearCommittedRangeSelection();
        this.clearPointerPressState();
        this.enterDraggingState(source, pointerId, e.clientX, e.clientY, e.pointerType || null);
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
                    const source = state.directDragSource;
                    const pointerId = state.pointerId;
                    this.clearCommittedRangeSelection();
                    this.clearMouseRangeSelectState();
                    this.enterDraggingState(source, pointerId, e.clientX, e.clientY, pointerType);
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
                    const source = state.directDragSource;
                    const pointerId = state.pointerId;
                    this.clearCommittedRangeSelection();
                    this.clearMouseRangeSelectState();
                    this.enterDraggingState(source, pointerId, e.clientX, e.clientY, pointerType);
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
                const source = this.getCommittedSelectionSource() ?? state.activeSelectionSource;
                const pointerId = state.pointerId;
                this.clearCommittedRangeSelection();
                this.clearMouseRangeSelectState();
                this.enterDraggingState(source, pointerId, e.clientX, e.clientY, pointerType);
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

    tryStartCommittedSelectionDrag(e: PointerEvent, target: HTMLElement): boolean {
        if (!this.isMultiLineSelectionEnabled()) return false;
        if (e.button !== 0) return false;
        if (!this.committedRangeSelection) return false;

        const pointerType = e.pointerType || null;
        if (!this.isSelectionDragGripHit(target, e.clientX, e.clientY, pointerType)) {
            return false;
        }

        const committedSource = this.getCommittedSelectionSource();
        if (!committedSource) return false;

        if (this.gesture.phase === 'range_selecting') {
            this.retargetMobileRangeSelection(e);
        } else {
            this.beginPressPendingDrag(committedSource, e);
        }
        return true;
    }

    private commitRangeSelection(state: MouseRangeSelectState): void {
        this.committedRangeSelection = commitSelectionRangeByFlow(this.view, state, this.rangeVisual);
    }

    clearCommittedRangeSelection(): void {
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
            const block = this.getCommittedSelectionSource();
            if (block) {
                this.deps.openBlockTypeMenu?.(block.primaryBlock, null);
            }
            return;
        }
        this.clearCommittedRangeSelection();
    };

    getCommittedSelectionSource() {
        return cloneCommittedSelectionSourceByFlow(this.committedRangeSelection);
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
            this.deps.performDropAtPoint(state.source, e.clientX, e.clientY, e.pointerType || null);
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
        if (this.gesture.phase === 'mobile_selecting') {
            finishMobileSelectionPointer(this, e, 'cancel');
            return;
        }
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

    private handleWindowKeyDown(e: KeyboardEvent): void {
        if (e.key !== 'Escape') return;
        if (!this.clearRangeSelectionForEscape()) return;
        e.preventDefault();
        e.stopPropagation();
    }

    private clearRangeSelectionForEscape(): boolean {
        if (this.gesture.phase === 'range_selecting') {
            this.clearMouseRangeSelectState();
            this.pointer.detachPointerListeners();
            this.pointer.releasePointerCapture();
            this.mobile.unlockMobileInteraction();
            this.mobile.detachFocusGuard();
            this.clearCommittedRangeSelection();
            this.emitIdleLifecycle();
            return true;
        }
        if (this.gesture.phase === 'idle' && this.committedRangeSelection) {
            this.clearCommittedRangeSelection();
            return true;
        }
        return false;
    }

    private handlePointerTerminalEvent(e: PointerEvent, mode: PointerTerminalMode): void {
        switch (this.gesture.phase) {
            case 'dragging':
                this.handleDraggingPointerTerminalEvent(e, mode);
                return;
            case 'range_selecting':
                this.handleRangeSelectingPointerTerminalEvent(e, mode);
                return;
            case 'mobile_selecting':
                finishMobileSelectionPointer(this, e, mode);
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
                this.deps.openBlockTypeMenu?.(rangeState.activeSelectionSource.primaryBlock, e);
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
        enterMobileSelectionMode(this, e);
    }

    private handleDocumentFocusIn(e: FocusEvent): void {
        if (
            this.committedRangeSelection
            && this.gesture.phase !== 'mobile_selecting'
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
        switch (this.gesture.phase) {
            case 'dragging':
            case 'range_selecting':
            case 'press_pending':
                return true;
            case 'mobile_selecting':
                return this.gesture.mobileSelect.activeInteraction !== null;
            default:
                return false;
        }
    }

    private shouldSuppressNativeInteractionForActiveGesture(): boolean {
        switch (this.gesture.phase) {
            case 'dragging':
                return true;
            case 'range_selecting':
                return this.gesture.rangeSelect.isIntercepting;
            case 'mobile_selecting':
                return this.gesture.mobileSelect.activeInteraction !== null;
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
        const { source, hadDrag } = this.resolveSessionResetContext();
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
        if (cancelReason && source) {
            this.emitCancelledLifecycle(source, cancelReason, pointerType);
        }
        this.emitIdleLifecycle();
    }

    private resolveSessionResetContext(): { source: DragSource | null; hadDrag: boolean } {
        const gesture = this.gesture;
        switch (gesture.phase) {
            case 'dragging':
                this.cancelDragAutoScroll(gesture.drag);
                return {
                    source: gesture.drag.source,
                    hadDrag: true,
                };
            case 'press_pending':
                this.clearPointerPressState();
                return {
                    source: gesture.press.source,
                    hadDrag: false,
                };
            case 'range_selecting':
                this.clearMouseRangeSelectState();
                return {
                    source: gesture.rangeSelect.activeSelectionSource,
                    hadDrag: false,
                };
            case 'mobile_selecting':
                this.clearCommittedRangeSelection();
                return {
                    source: createDragSource(getMobileSelectionTemplateBlock(this, gesture.mobileSelect), [{ startLine: getMobileSelectionTemplateBlock(this, gesture.mobileSelect).startLine, endLine: getMobileSelectionTemplateBlock(this, gesture.mobileSelect).endLine }]),
                    hadDrag: false,
                };
            default:
                return {
                    source: null,
                    hadDrag: false,
                };
        }
    }

    private emitLifecycle(event: DragLifecycleEvent): void {
        this.deps.onDragLifecycleEvent?.(event);
    }

    emitPressPendingLifecycle(
        source: DragSource,
        pointerType: string | null,
        pressReady: boolean
    ): void {
        this.emitLifecycle(buildPressPendingLifecycleEvent(source, pointerType, pressReady));
    }

    private emitDragStartedLifecycle(source: DragSource, pointerType: string | null): void {
        this.emitLifecycle(buildDragStartedLifecycleEvent(source, pointerType));
    }

    private emitCancelledLifecycle(
        source: DragSource,
        rejectReason: string,
        pointerType: string | null
    ): void {
        this.emitLifecycle(buildCancelledLifecycleEvent({
            source,
            rejectReason,
            pointerType,
        }));
    }

    emitIdleLifecycle(): void {
        this.emitLifecycle(buildIdleLifecycleEvent());
    }

    isMultiLineSelectionEnabled(): boolean {
        if (!this.deps.isMultiLineSelectionEnabled) return true;
        return this.deps.isMultiLineSelectionEnabled();
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





