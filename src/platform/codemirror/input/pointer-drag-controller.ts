import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../domain/block/block-types';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { DragDropSnapshot } from '../../../drag/drop/drag-drop-snapshot';
import type { DragEffect } from '../../../drag/effects/drag-effect';
import type { DragEffectExecutor } from '../../../drag/effects/drag-effect-executor';
import { executeDragEffects } from '../../../drag/effects/drag-effect-executor';
import type { DragLifecycleEvent } from '../../../drag/lifecycle/drag-lifecycle';
import type { PointerDropCommitResolution } from './pointer-drag-target-router';
import {
    type RangeSelectionBoundary,
    type CommittedRangeSelection,
    type MouseRangeSelectState,
    type RangeSelectionOperation,
    type SelectedBlockRange,
} from '../../../drag/selection/range-selection-state';
import {
    shouldClearCommittedSelectionOnPointerDown as shouldClearCommittedSelectionOnPointerDownByGrip,
    isCommittedSelectionGripHit as isCommittedSelectionGripHitByGrip,
} from '../selection/selection-grip-hit';
import {
    activateMouseRangeSelectInterception as activateMouseRangeSelectInterceptionAction,
    beginRangeSelectionSessionAction,
    clearMouseRangeSelectState as clearMouseRangeSelectStateAction,
    commitRangeSelection as commitRangeSelectionAction,
    updateMouseRangeSelection as updateMouseRangeSelectionAction,
    updateMouseRangeSelectionFromLine as updateMouseRangeSelectionFromLineAction,
} from './pointer-selecting-actions';
import {
    renderRangeSelectionPreview,
} from '../preview/range-selection-visual-manager';
import { deleteCommittedRangeSelectionFromDocument } from '../command/committed-selection-deleter';
import { RangeSelectionVisualManager } from '../preview/range-selection-visual-manager';
import { TouchInteractionController } from './touch-interaction-controller';
import { PointerSessionController } from './pointer-session-controller';
import { readFocusInput, readKeyboardInput, readPointerInput, readVisibilityInput } from './pointer-input';

import {
    buildCancelledLifecycleEvent,
    buildDragStartedLifecycleEvent,
    buildIdleLifecycleEvent,
    buildPressPendingLifecycleEvent,
} from '../../../drag/lifecycle/drag-lifecycle';
import {
    GestureCancelReason,
    InteractionState,
} from '../../../drag/state/drag-state';
import {
    isMobileEnvironment as isMobileEnvironmentByInput,
} from './pointer-input';
import { type BlockSelectionRequest } from '../selection/block-selection-resolver';
import { cleanupInteractionSession, type InteractionCleanupOptions } from './interaction-cleanup';
import { DragFlowController } from '../../../drag/pipeline/drag-flow-controller';
import { handlePointerMove } from './pointermove-handler';
import { handlePointerCancel, handlePointerUp } from './pointerup-handler';
import { handleDesktopPointerDown } from './pointerdown-handler';
import {
    enterMobileSelectionMode,
    finishMobileSelectionPointer,
    getMobileSelectionTemplateBlock,
    handleMobilePointerDown,
} from './touch-selecting-actions';

const MOBILE_DRAG_LONG_PRESS_MS = 200;
const MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX = 12;
const TOUCH_RANGE_SELECT_LONG_PRESS_MS = 900;
const MIN_TOUCH_RANGE_SELECT_LONG_PRESS_MS = 300;
const MAX_TOUCH_RANGE_SELECT_LONG_PRESS_MS = 2000;
const MOUSE_RANGE_SELECT_LONG_PRESS_MS = 260;

export interface PointerDragControllerDeps {
    resolveBlockSelection: (request: BlockSelectionRequest) => BlockSelection | null;
    getVisibleHandleForBlockStart?: (blockStart: number) => HTMLElement | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMultiLineSelectionEnabled?: () => boolean;
    getMultiLineSelectionLongPressMs?: () => number;
    isMobileTextLongPressDragEnabled?: () => boolean;
    beginPointerDragSession: (source: BlockSelection) => void;
    finishDragSession: () => void;
    resolveDropSnapshotAtPoint: (clientX: number, clientY: number, source: BlockSelection, pointerType: string | null) => DragDropSnapshot;
    buildBlockCommandAtPoint: (source: BlockSelection, clientX: number, clientY: number, pointerType: string | null) => PointerDropCommitResolution;
    dragEffectExecutor: DragEffectExecutor;
    onDragLifecycleEvent?: (event: DragLifecycleEvent) => void;
    openBlockTypeMenu?: (blockInfo: BlockInfo, event: MouseEvent | PointerEvent | null) => void;
}

export class PointerDragController {
    gesture: InteractionState = { phase: 'idle' };
    committedRangeSelection: CommittedRangeSelection | null = null;
    readonly rangeVisual: RangeSelectionVisualManager;
    readonly mobile: TouchInteractionController;
    readonly pointer: PointerSessionController;
    readonly dragFlow = new DragFlowController();
    private activeDragPointer: { clientX: number; clientY: number; pointerType: string | null } | null = null;

    private readonly onEditorPointerDown = (e: PointerEvent) => {
        const input = readPointerInput('down', e);
        const target = input.target;
        if (!target) return;

        this.runPointerDownPrelude(e, target);

        if (this.resolvePointerDownMode(e) === 'mobile') {
            handleMobilePointerDown(this, e, target);
            return;
        }

        handleDesktopPointerDown(this, e, target);
    };

    private readonly onLostPointerCapture = (e: PointerEvent) => this.handleLostPointerCapture(e);
    private readonly onWindowKeyDown = (e: KeyboardEvent) => this.handleWindowKeyDown(e);
    private readonly onDocumentFocusIn = (e: FocusEvent) => this.handleDocumentFocusIn(e);
    private readonly onEnterMobileSelectionMode = (e: Event) => this.handleEnterMobileSelectionMode(e);
    constructor(
        readonly view: EditorView,
        readonly deps: PointerDragControllerDeps
    ) {
        this.rangeVisual = new RangeSelectionVisualManager(
            this.view,
            () => this.refreshRangeSelectionVisual(),
            (blockStart) => this.deps.getVisibleHandleForBlockStart?.(blockStart) ?? null,
            this.handleSelectionOverlayAction
        );
        this.mobile = new TouchInteractionController(this.view, (e) => this.handleDocumentFocusIn(e));
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
        this.resetInteractionSession({ shouldFinishDragSession: true, shouldHideDropPreview: true });
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
        return isMobileEnvironmentByInput();
    }

    beginRangeSelectionSession(
        source: BlockSelection,
        e: PointerEvent,
        handle: HTMLElement | null,
        options?: { skipLongPress?: boolean; initialOperation?: RangeSelectionOperation }
    ): void {
        void handle;
        beginRangeSelectionSessionAction(this, source, e, options);
    }

    activateMouseRangeSelectInterception(state: MouseRangeSelectState): void {
        activateMouseRangeSelectInterceptionAction(this, state);
    }

    beginPressPendingDrag(
        source: BlockSelection,
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
                this.emitPressPendingLifecycle(state.selection, state.pointerType, true);
            }, longPressMs);
        const startMoveThresholdPx = skipLongPress
            ? 2
            : (pointerType === 'mouse' ? 4 : 8);

        this.gesture = { phase: 'press_pending', press: {
            selection: source,
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

    clearPointerPressState(): void {
        if (this.gesture.phase !== 'press_pending') return;
        const state = this.gesture.press;
        if (state.timeoutId !== null) {
            window.clearTimeout(state.timeoutId);
        }
        this.gesture = { phase: 'idle' };
    }

    clearMouseRangeSelectState(options?: { preserveVisual?: boolean }): void {
        clearMouseRangeSelectStateAction(this, options);
    }

    enterDraggingState(
        source: BlockSelection,
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
        this.activeDragPointer = { clientX, clientY, pointerType };
        const drop = this.deps.resolveDropSnapshotAtPoint(clientX, clientY, source, pointerType);
        const result = this.dragFlow.begin({
            selection: source,
            pointerId,
            pointerType,
            drop,
        });
        this.gesture = {
            phase: 'dragging',
            drag: result.drag,
        };
        this.deps.beginPointerDragSession(source);
        this.applyDragEffects(result.effects);
    }


    private handlePointerMove(e: PointerEvent): void {
        handlePointerMove(this, e);
    }

    cancelDragAutoScroll(dragState: { autoScrollFrameId: number | null }): void {
        if (dragState.autoScrollFrameId === null) return;
        window.cancelAnimationFrame(dragState.autoScrollFrameId);
        dragState.autoScrollFrameId = null;
    }

    updateActiveDragPointer(clientX: number, clientY: number, pointerType: string | null): void {
        this.activeDragPointer = { clientX, clientY, pointerType };
    }

    getActiveDragPointer(): { clientX: number; clientY: number; pointerType: string | null } | null {
        return this.activeDragPointer;
    }

    resolveActiveDragDropSnapshot(selection: BlockSelection): DragDropSnapshot {
        if (!this.activeDragPointer) return { target: null, rejectReason: 'no_target' };
        return this.deps.resolveDropSnapshotAtPoint(
            this.activeDragPointer.clientX,
            this.activeDragPointer.clientY,
            selection,
            this.activeDragPointer.pointerType
        );
    }

    previewActiveDrag(params: {
        pointerId: number;
        pointerType: string | null;
        drop: DragDropSnapshot;
    }): DragEffect[] {
        return this.dragFlow.preview(params);
    }

    commitActiveDrag(params: {
        pointerId: number;
        pointerType: string | null;
        resolved: PointerDropCommitResolution;
    }): DragEffect[] {
        return this.dragFlow.commit({
            pointerId: params.pointerId,
            pointerType: params.pointerType,
            resolution: params.resolved,
        });
    }

    cancelActiveDrag(params: {
        pointerId: number;
        pointerType: string | null;
        reason: GestureCancelReason;
    }): DragEffect[] {
        return this.dragFlow.cancel(params);
    }

    buildActiveDragCommand(selection: BlockSelection): PointerDropCommitResolution {
        if (!this.activeDragPointer) {
            return { type: 'cancel', drop: { target: null, rejectReason: 'no_target' }, reason: 'no_target' };
        }
        return this.deps.buildBlockCommandAtPoint(
            selection,
            this.activeDragPointer.clientX,
            this.activeDragPointer.clientY,
            this.activeDragPointer.pointerType
        );
    }

    applyDragEffects(effects: DragEffect[]): void {
        executeDragEffects(this.deps.dragEffectExecutor, effects);
    }

    private updateMouseRangeSelectionFromLine(state: MouseRangeSelectState, lineNumber: number): void {
        updateMouseRangeSelectionFromLineAction(this, state, lineNumber);
    }

    updateMouseRangeSelection(state: MouseRangeSelectState, target: RangeSelectionBoundary): void {
        updateMouseRangeSelectionAction(this, state, target);
    }

    private retargetMobileRangeSelection(e: PointerEvent): void {
        if (!(this.gesture.phase === 'selecting' && this.gesture.selection.mode === 'range')) return;
        const state = this.gesture.selection.rangeSelect;
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

        const committedSource = this.getCommittedSelection();
        if (!committedSource) return false;

        if (this.gesture.phase === 'selecting' && this.gesture.selection.mode === 'range') {
            this.retargetMobileRangeSelection(e);
        } else {
            this.beginPressPendingDrag(committedSource, e);
        }
        return true;
    }

    commitRangeSelection(state: MouseRangeSelectState): void {
        this.committedRangeSelection = commitRangeSelectionAction(this.view, state, this.rangeVisual);
    }

    clearCommittedRangeSelection(): void {
        this.committedRangeSelection = null;
        this.rangeVisual.clear();
    }

    private deleteCommittedRangeSelection(): void {
        if (deleteCommittedRangeSelectionFromDocument(this.view, this.committedRangeSelection)) {
            this.committedRangeSelection = null;
            this.rangeVisual.clear();
            return;
        }
        this.clearCommittedRangeSelection();
    }

    private handleSelectionOverlayAction = (action: 'delete' | 'done' | 'convert'): void => {
        if (action === 'delete') {
            this.deleteCommittedRangeSelection();
            return;
        }
        if (action === 'convert') {
            const block = this.getCommittedSelection();
            if (block) {
                this.deps.openBlockTypeMenu?.(block.anchorBlock, null);
            }
            return;
        }
        this.clearCommittedRangeSelection();
    };

    getCommittedSelection(): BlockSelection | null {
        const request = this.buildCommittedSelectionSelectionRequest();
        return request ? this.resolveBlockSelection(request) : null;
    }

    buildCommittedSelectionSelectionRequest(): BlockSelectionRequest | null {
        if (!this.committedRangeSelection) return null;
        return {
            kind: 'selection',
            doc: this.view.state.doc,
            blocks: this.committedRangeSelection.blocks,
            templateBlock: this.committedRangeSelection.templateBlock,
        };
    }

    buildActiveRangeSelectionSelectionRequest(state: MouseRangeSelectState): BlockSelectionRequest {
        return {
            kind: 'selection',
            doc: this.view.state.doc,
            blocks: state.selectionBlocks,
            templateBlock: state.anchorBlock,
        };
    }

    buildDirectRangeSelectionSelectionRequest(state: MouseRangeSelectState): BlockSelectionRequest {
        return { kind: 'block', block: state.directBlock };
    }

    buildMobileSelectionSelectionRequest(state: { selectedBlocks: SelectedBlockRange[]; activeMovingBoundary: RangeSelectionBoundary }): BlockSelectionRequest | null {
        const templateBlock = getMobileSelectionTemplateBlock(this, state);
        if (state.selectedBlocks.length === 0) return null;
        return {
            kind: 'selection',
            doc: this.view.state.doc,
            blocks: state.selectedBlocks,
            templateBlock,
        };
    }

    resolveBlockSelection(request: BlockSelectionRequest): BlockSelection | null {
        return this.deps.resolveBlockSelection(request);
    }

    private refreshRangeSelectionVisual(): void {
        renderRangeSelectionPreview(this.gesture, this.committedRangeSelection, this.rangeVisual);
    }

    finishRangeSelectionSession(): void {
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

    cleanupAfterPointerDrag(options?: InteractionCleanupOptions): void {
        this.resetInteractionSession(options);
    }

    private handlePointerUp(e: PointerEvent): void {
        handlePointerUp(this, e);
    }

    private handlePointerCancel(e: PointerEvent): void {
        handlePointerCancel(this, e);
    }

    private handleLostPointerCapture(e: PointerEvent): void {
        readPointerInput('lost_capture', e);
        if (!this.hasActivePointerSession()) return;
        if (this.gesture.phase === 'selecting' && this.gesture.selection.mode === 'mobile') {
            finishMobileSelectionPointer(this, e, 'cancel');
            return;
        }
        this.abortForSessionInterrupted(e.pointerType || null);
    }

    private handleWindowBlur(): void {
        readFocusInput('blur', new FocusEvent('blur'));
        if (!this.hasActivePointerSession()) return;
        this.abortForSessionInterrupted(null);
    }

    private handleDocumentVisibilityChange(e: Event = new Event('visibilitychange')): void {
        const input = readVisibilityInput(e);
        if (input.visibilityState !== 'hidden') return;
        if (!this.hasActivePointerSession()) return;
        this.abortForSessionInterrupted(null);
    }

    private handleWindowKeyDown(e: KeyboardEvent): void {
        const input = readKeyboardInput('keydown', e);
        if (input.key !== 'Escape') return;
        if (!this.clearRangeSelectionForEscape()) return;
        e.preventDefault();
        e.stopPropagation();
    }

    private clearRangeSelectionForEscape(): boolean {
        if (this.gesture.phase === 'selecting' && this.gesture.selection.mode === 'range') {
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

    abortForGestureCancel(
        cancelReason: GestureCancelReason,
        pointerType: string | null
    ): void {
        this.resetInteractionSession({
            shouldFinishDragSession: false,
            shouldHideDropPreview: false,
            cancelReason,
            pointerType,
        });
    }

    private abortForSessionInterrupted(pointerType: string | null): void {
        this.resetInteractionSession({
            shouldFinishDragSession: true,
            shouldHideDropPreview: true,
            cancelReason: 'session_interrupted',
            pointerType,
        });
    }

    private handleEnterMobileSelectionMode(e: Event): void {
        enterMobileSelectionMode(this, e);
    }

    private handleDocumentFocusIn(e: FocusEvent): void {
        const input = readFocusInput('focusin', e);
        if (
            this.committedRangeSelection
            && !(this.gesture.phase === 'selecting' && this.gesture.selection.mode === 'mobile')
            && this.isMobileEnvironment()
            && input.target instanceof HTMLElement
            && this.mobile.shouldSuppressFocusTarget(input.target)
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
            case 'press_pending':
                return true;
            case 'selecting':
                return this.gesture.selection.mode === 'mobile'
                    ? this.gesture.selection.mobileSelect.activeInteraction !== null
                    : true;
            default:
                return false;
        }
    }

    private shouldSuppressNativeInteractionForActiveGesture(): boolean {
        switch (this.gesture.phase) {
            case 'dragging':
                return true;
            case 'selecting':
                return this.gesture.selection.mode === 'mobile'
                    ? this.gesture.selection.mobileSelect.activeInteraction !== null
                    : this.gesture.selection.rangeSelect.isIntercepting;
            case 'press_pending':
                return this.gesture.press.suppressNativeInteraction;
            default:
                return false;
        }
    }

    private resetInteractionSession(options?: InteractionCleanupOptions): void {
        cleanupInteractionSession(this, options);
        this.activeDragPointer = null;
        this.dragFlow.clear();
    }

    resolveActiveRangeSelection(): BlockSelection | null {
        if (!(this.gesture.phase === 'selecting' && this.gesture.selection.mode === 'range')) return null;
        return this.resolveBlockSelection(this.buildActiveRangeSelectionSelectionRequest(this.gesture.selection.rangeSelect));
    }

    resolveMobileSelection(): BlockSelection | null {
        if (!(this.gesture.phase === 'selecting' && this.gesture.selection.mode === 'mobile')) return null;
        const request = this.buildMobileSelectionSelectionRequest(this.gesture.selection.mobileSelect);
        return request ? this.resolveBlockSelection(request) : null;
    }

    private emitLifecycle(event: DragLifecycleEvent): void {
        this.deps.onDragLifecycleEvent?.(event);
    }

    emitPressPendingLifecycle(
        source: BlockSelection,
        pointerType: string | null,
        pressReady: boolean
    ): void {
        this.emitLifecycle(buildPressPendingLifecycleEvent(source, pointerType, pressReady));
    }

    private emitDragStartedLifecycle(source: BlockSelection, pointerType: string | null): void {
        this.emitLifecycle(buildDragStartedLifecycleEvent(source, pointerType));
    }

    emitCancelledLifecycle(
        source: BlockSelection,
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

    getTouchRangeSelectLongPressMs(): number {
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





