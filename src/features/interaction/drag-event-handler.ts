import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../core/block/block-types';
import { cloneLineRanges } from '../../shared/utils/line-range';
import { DragLifecycleEvent } from '../../shared/types/drag';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    RANGE_SELECTION_DELETE_BUTTON_CLASS,
} from '../../shared/dom-selectors';
import { RangeSelectionVisualManager } from '../selection/selection-visual-manager';
import { MobileGestureController } from './mobile-gesture-controller';
import { PointerSessionController } from './pointer-session-controller';
import {
    type RangeSelectionBoundary,
    type CommittedRangeSelection,
    type MouseRangeSelectState,
} from '../selection/selection-model';
import { resolveRangeBoundaryAtPoint } from '../selection/hit-boundary';
import { resolveDragTransferGuard as resolveDragTransferGuardDecision } from './drag-transfer-guard';
import {
    shouldClearCommittedSelectionOnPointerDown as shouldClearCommittedSelectionOnPointerDownByGrip,
    isCommittedSelectionGripHit as isCommittedSelectionGripHitByGrip,
} from '../selection/selection-grip-hit';
import {
    resolveRangeSelectConfig,
    createInitialRangeSelectionState,
} from '../selection/selection-session-flow';
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
} from '../selection/selection-flow';
import {
    buildCancelledLifecycleEvent,
    buildDragActiveLifecycleEvent,
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
const MOUSE_RANGE_SELECT_CANCEL_MOVE_THRESHOLD_PX = 12;

export interface DragEventHandlerDeps {
    getDragSourceBlock: (e: DragEvent) => BlockInfo | null;
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMultiLineSelectionEnabled?: () => boolean;
    isRangeSelectionDeleteEnabled?: () => boolean;
    getMultiLineSelectionLongPressMs?: () => number;
    isMobileTextLongPressDragEnabled?: () => boolean;
    isCrossEditorDragActive?: () => boolean;
    isCrossFileDragEnabled?: () => boolean;
    beginPointerDragSession: (blockInfo: BlockInfo) => void;
    finishDragSession: () => void;
    scheduleDropIndicatorUpdate: (clientX: number, clientY: number, dragSource: BlockInfo | null, pointerType: string | null) => void;
    hideDropIndicator: () => void;
    performDropAtPoint: (sourceBlock: BlockInfo, clientX: number, clientY: number, pointerType: string | null) => void;
    onDragLifecycleEvent?: (event: DragLifecycleEvent) => void;
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
        if (target.closest(`.${RANGE_SELECTION_DELETE_BUTTON_CLASS}`)) return;
        const pointerType = e.pointerType || null;
        const multiLineSelectionEnabled = this.isMultiLineSelectionEnabled();
        if (!multiLineSelectionEnabled) {
            this.clearCommittedRangeSelection();
        }
        const canHandleCommittedSelection = (
            multiLineSelectionEnabled
            && e.button === 0
            && this.gesture.phase === 'idle'
            && !!this.committedRangeSelection
        );

        if (canHandleCommittedSelection && this.isCommittedSelectionGripHit(target, e.clientX, e.clientY, pointerType)) {
            const committedBlock = this.getCommittedSelectionBlock();
            if (committedBlock) {
                this.beginPressPendingDrag(committedBlock, e, {
                    skipLongPress: pointerType === 'mouse',
                });
                return;
            }
        }
        if (canHandleCommittedSelection && this.shouldClearCommittedSelectionOnPointerDown(target, e.clientX, pointerType)) {
            this.clearCommittedRangeSelection();
        }

        const handle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
        if (handle && !handle.classList.contains(EMBED_HANDLE_CLASS)) {
            this.startPointerDragFromHandle(handle, e);
            return;
        }

        if (!this.shouldStartMobilePressDrag(e)) return;
        const inMobileHotzoneBand = this.mobile.isWithinMobileDragHotzoneBand(e.clientX);
        const inTextLineOrEmbedArea = this.isMobileTextLongPressDragEnabled()
            && this.mobile.isWithinMobileTextLineOrEmbedArea(target, e.clientX, e.clientY);
        if (!inMobileHotzoneBand && !inTextLineOrEmbedArea) return;

        const blockInfo = this.deps.getBlockInfoAtPoint(e.clientX, e.clientY);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

        const useHotzonePath = inMobileHotzoneBand
            && this.mobile.isWithinMobileDragHotzone(blockInfo, e.clientX);
        if (useHotzonePath) {
            this.beginPressPendingDrag(blockInfo, e);
            return;
        }

        if (inTextLineOrEmbedArea) {
            if (this.shouldDisableMobileTextLongPressDragInInputState()) return;
            // Keep native tap-to-focus behavior in text/embed areas.
            this.beginPressPendingDrag(blockInfo, e, { deferInterception: true });
        }
    };

    private readonly onEditorDragEnter = (e: DragEvent) => {
        const transferGuard = this.resolveDragTransferGuard(e);
        if (transferGuard.decision === 'ignore') return;
        if (this.gesture.phase === 'range_selecting') {
            this.clearMouseRangeSelectState();
            this.pointer.detachPointerListeners();
            this.pointer.releasePointerCapture();
        }
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = transferGuard.dropEffect;
        }
        if (transferGuard.decision === 'block') {
            this.deps.hideDropIndicator();
        }
    };

    private readonly onEditorDragOver = (e: DragEvent) => {
        const transferGuard = this.resolveDragTransferGuard(e);
        if (transferGuard.decision === 'ignore') return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = transferGuard.dropEffect;
        if (transferGuard.decision === 'block') {
            this.deps.hideDropIndicator();
            return;
        }
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, this.deps.getDragSourceBlock(e), 'mouse');
    };

    private readonly onEditorDragLeave = (e: DragEvent) => {
        const transferGuard = this.resolveDragTransferGuard(e);
        if (transferGuard.decision === 'ignore') return;
        if (transferGuard.decision === 'block') {
            this.deps.hideDropIndicator();
            return;
        }
        const rect = this.view.dom.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) {
            this.deps.hideDropIndicator();
        }
    };

    private readonly onEditorDrop = (e: DragEvent) => {
        const transferGuard = this.resolveDragTransferGuard(e);
        if (transferGuard.decision === 'ignore') return;
        e.preventDefault();
        e.stopPropagation();
        if (transferGuard.decision === 'block') {
            this.deps.hideDropIndicator();
            return;
        }
        if (!e.dataTransfer) return;
        const sourceBlock = this.deps.getDragSourceBlock(e);
        if (!sourceBlock) return;
        this.deps.performDropAtPoint(sourceBlock, e.clientX, e.clientY, 'mouse');
        this.deps.hideDropIndicator();
        this.deps.finishDragSession();
    };

    private readonly onLostPointerCapture = (e: PointerEvent) => this.handleLostPointerCapture(e);
    private readonly onDocumentFocusIn = (e: FocusEvent) => this.handleDocumentFocusIn(e);
    constructor(
        private readonly view: EditorView,
        private readonly deps: DragEventHandlerDeps
    ) {
        this.rangeVisual = new RangeSelectionVisualManager(
            this.view,
            () => this.refreshRangeSelectionVisual(),
            () => this.deleteCommittedRangeSelection(),
            () => this.deps.isRangeSelectionDeleteEnabled?.() === true
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
        editorDom.addEventListener('dragenter', this.onEditorDragEnter, true);
        editorDom.addEventListener('dragover', this.onEditorDragOver, true);
        editorDom.addEventListener('dragleave', this.onEditorDragLeave, true);
        editorDom.addEventListener('drop', this.onEditorDrop, true);
        editorDom.addEventListener('focusin', this.onDocumentFocusIn, true);
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
            if (!multiLineSelectionEnabled) {
                return;
            }
            this.beginRangeSelectionSession(blockInfo, e, handle);
            return;
        }

        if (this.isMobileEnvironment()) {
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
        editorDom.removeEventListener('dragenter', this.onEditorDragEnter, true);
        editorDom.removeEventListener('dragover', this.onEditorDragOver, true);
        editorDom.removeEventListener('dragleave', this.onEditorDragLeave, true);
        editorDom.removeEventListener('drop', this.onEditorDrop, true);
        editorDom.removeEventListener('focusin', this.onDocumentFocusIn, true);
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

    private resolveDragTransferGuard(e: DragEvent) {
        return resolveDragTransferGuardDecision({
            event: e,
            isCrossEditorDrag: this.deps.isCrossEditorDragActive?.() ?? false,
            isCrossFileDragEnabled: this.deps.isCrossFileDragEnabled?.() ?? false,
        });
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

    private beginRangeSelectionSession(blockInfo: BlockInfo, e: PointerEvent, handle: HTMLElement | null): void {
        const committedRangesSnapshot = cloneLineRanges(this.committedRangeSelection?.ranges ?? []);
        const pointerType = e.pointerType || null;
        const config = resolveRangeSelectConfig(
            pointerType,
            MOUSE_RANGE_SELECT_LONG_PRESS_MS,
            () => this.getTouchRangeSelectLongPressMs()
        );
        const shouldDeferInterception = pointerType === 'mouse';
        const initialRangeSelectState = createInitialRangeSelectionState({
            blockInfo,
            doc: this.view.state.doc,
            committedRangesSnapshot,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            pointerType,
            sourceHandle: handle,
        });
        if (!initialRangeSelectState) return;

        let dragTimeoutId: number | null = null;
        if (pointerType !== 'mouse') {
            dragTimeoutId = window.setTimeout(() => {
                if (this.gesture.phase !== 'range_selecting') return;
                const state = this.gesture.rangeSelect;
                if (state.pointerId !== e.pointerId) return;
                state.dragReady = true;
                this.emitPressPendingLifecycle(state.directDragSourceBlock, state.pointerType, true);
            }, MOBILE_DRAG_LONG_PRESS_MS);
        }
        if (!shouldDeferInterception) {
            e.preventDefault();
            e.stopPropagation();
            this.pointer.tryCapturePointer(e);
            if (handle) {
                handle.setAttribute('draggable', 'false');
            }
        }

        const timeoutId = window.setTimeout(() => {
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
        this.emitPressPendingLifecycle(blockInfo, pointerType, false);
    }

    private activateMouseRangeSelectInterception(state: MouseRangeSelectState): void {
        this.pointer.tryCapturePointerById(state.pointerId);
        if (state.isIntercepting) return;
        state.isIntercepting = true;
        if (state.sourceHandle) {
            state.sourceHandle.setAttribute('draggable', 'false');
        }
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
        if (state.sourceHandle && state.sourceHandle.isConnected) {
            if (state.sourceHandleDraggableAttr === null) {
                state.sourceHandle.removeAttribute('draggable');
            } else {
                state.sourceHandle.setAttribute('draggable', state.sourceHandleDraggableAttr);
            }
        }
        this.gesture = { phase: 'idle' };
        if (!options?.preserveVisual) {
            if (this.committedRangeSelection) {
                this.rangeVisual.render(
                    this.committedRangeSelection.ranges
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
        this.emitDragActiveLifecycle(sourceBlock, pointerType);
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
        if (e.pointerId !== rangeState.pointerId) return;
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

        if (!state.longPressReady) {
            if (pointerType === 'mouse') {
                if (distance > MOUSE_RANGE_SELECT_CANCEL_MOVE_THRESHOLD_PX) {
                    this.abortForGestureCancel('press_cancelled', pointerType);
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

        this.activateMouseRangeSelectInterception(state);
        e.preventDefault();
        e.stopPropagation();

        const targetBoundary = resolveRangeBoundaryAtPoint(this.view, e.clientX, e.clientY, (x, y) => this.deps.getBlockInfoAtPoint(x, y));
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
    }

    private updateMouseRangeSelection(state: MouseRangeSelectState, target: RangeSelectionBoundary): void {
        updateSelectionFromBoundaryByFlow(this.view, state, target, this.rangeVisual);
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

    private isCommittedSelectionGripHit(
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
            isWithinMobileDragHotzoneBand: (x) => this.mobile.isWithinMobileDragHotzoneBand(x),
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
        if (e.pointerId !== rangeState.pointerId) return;
        if (mode === 'cancel') {
            this.abortForGestureCancel('pointer_cancelled', e.pointerType || null);
            return;
        }
        if (!rangeState.longPressReady) {
            this.abortForGestureCancel('press_cancelled', e.pointerType || null);
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

    private emitDragActiveLifecycle(sourceBlock: BlockInfo, pointerType: string | null): void {
        this.emitLifecycle(buildDragActiveLifecycleEvent(sourceBlock, pointerType));
    }

    private emitCancelledLifecycle(
        sourceBlock: BlockInfo,
        rejectReason: string,
        pointerType: string | null
    ): void {
        this.emitLifecycle(buildCancelledLifecycleEvent(sourceBlock, rejectReason, pointerType));
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





