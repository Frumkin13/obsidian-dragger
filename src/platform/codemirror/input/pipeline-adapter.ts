import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../domain/block/block-types';
import type { BlockCommand } from '../../../domain/command/block-command';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { SelectedBlockRange } from '../../../domain/selection/block-ranges';
import type { RangeSelectionBoundary, CommittedRangeSelection } from '../../../domain/selection/range-selection';
import type { DragDropSnapshot } from '../../../drag/pipeline/pipeline-drop';
import type { DragCancelReason, PipelineEvent } from '../../../drag/pipeline/pipeline-event';
import { reducePipeline } from '../../../drag/pipeline/pipeline-reducer';
import { IDLE_PIPELINE_STATE, type HoldTarget, type PipelineState } from '../../../drag/pipeline/pipeline-state';
import type { DragLifecycleEvent, PipelineOutput } from '../../../drag/pipeline/pipeline-output';
import type { PointerDropCommitResolution } from './pointer-hit-test';
import type { MouseRangeSelectState } from './range-selection-gesture-state';
import {
    shouldClearCommittedSelectionOnPointerDown as shouldClearCommittedSelectionOnPointerDownByGrip,
    isCommittedSelectionGripHit as isCommittedSelectionGripHitByGrip,
} from '../selection/selection-grip-hit';
import {
    activateMouseRangeSelectInterception as activateMouseRangeSelectInterceptionAction,
    beginRangeSelectionSessionAction,
    clearMouseRangeSelectState as clearMouseRangeSelectStateAction,
    commitRangeSelection as commitRangeSelectionAction,
    type RangeSelectionSessionOptions,
    updateMouseRangeSelection as updateMouseRangeSelectionAction,
} from './pointer-selection';
import { renderRangeSelectionPreview, RangeSelectionVisualManager } from '../preview/range-selection-visual-manager';
import { InputGuardController } from './input-guards';
import {
    PointerSession,
    type ActivePointerDrag,
    type PointerPressSession,
    type RangeSelectionPointerSession,
} from './pointer-session';
import { readFocusInput, readKeyboardInput, readPointerInput, readVisibilityInput } from './pointer-hit-test';
import {
    isMobileEnvironment as isMobileEnvironmentByInput,
} from './pointer-hit-test';
import { type BlockSelectionRequest } from '../selection/block-selection-resolver';
import {
    INPUT_GUARD_MOBILE_DRAG_GESTURE,
    INPUT_GUARD_MOBILE_SELECTION_GESTURE,
    INPUT_GUARD_MOBILE_SELECTION_PASSIVE,
} from './input-guards';
import { RANGE_SELECTED_HANDLE_CLASS } from '../../../shared/dom-selectors';
import { handlePointerCancel, handlePointerMove, handlePointerUp } from './pointer-drag';
import {
    enterMobileSelectionMode,
    exitMobileSelectionMode,
    handlePointerDown,
} from './pointer-selection';
import {
    clampTouchRangeSelectLongPressMs,
    MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX,
    MOBILE_DRAG_LONG_PRESS_MS,
    MOUSE_RANGE_SELECT_LONG_PRESS_MS,
} from './touch-delay-policy';

const GUARD_MOBILE_TEXT_DRAG = 'mobile-text-drag-mode';

export interface PipelineAdapterDeps {
    resolveBlockSelection: (request: BlockSelectionRequest) => BlockSelection | null;
    getVisibleHandleForBlockStart?: (blockStart: number) => HTMLElement | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMultiLineSelectionEnabled?: () => boolean;
    getMultiLineSelectionLongPressMs?: () => number;
    isMobileDragModeRequired?: () => boolean;
    isMobileDragModeEnabled?: () => boolean;
    isMobileTextLongPressDragEnabled?: () => boolean;
    beginPointerDragSession: (source: BlockSelection) => void;
    finishDragSession: () => void;
    resolveDropSnapshotAtPoint: (clientX: number, clientY: number, source: BlockSelection, pointerType: string | null) => DragDropSnapshot;
    buildBlockCommandAtPoint: (source: BlockSelection, clientX: number, clientY: number, pointerType: string | null) => PointerDropCommitResolution;
    pipelineOutputExecutor: PipelineOutputExecutor;
    openBlockTypeMenu?: (blockInfo: BlockInfo, event: MouseEvent | PointerEvent | null) => void;
}

export interface PipelineOutputExecutor<TPreview = unknown> {
    showDropPreview(selection: BlockSelection, drop: DragDropSnapshot<TPreview>, pointerType: string | null): void;
    hideDropPreview(): void;
    applyCommand(command: BlockCommand): void;
    emitLifecycle(event: DragLifecycleEvent): void;
}

export type InteractionCleanupOptions = {
    shouldFinishDragSession?: boolean;
    shouldHideDropPreview?: boolean;
    cancelReason?: DragCancelReason | null;
    pointerType?: string | null;
};

export class PipelineAdapter {
    pipelineState: PipelineState = IDLE_PIPELINE_STATE;
    pressSession: PointerPressSession | null = null;
    activeDragSession: ActivePointerDrag | null = null;
    rangePointerSession: RangeSelectionPointerSession | null = null;
    committedRangeSelection: CommittedRangeSelection | null = null;
    readonly rangeVisual: RangeSelectionVisualManager;
    readonly mobile: InputGuardController;
    readonly pointer: PointerSession;
    private activeDragPointer: { clientX: number; clientY: number; pointerType: string | null } | null = null;

    private readonly onEditorPointerDown = (e: PointerEvent) => {
        const input = readPointerInput('down', e);
        const target = input.target;
        if (!target) return;

        if (!this.isMultiLineSelectionEnabled()) {
            this.clearCommittedRangeSelection();
        }

        const handled = handlePointerDown(this, e, target);
        if (!handled) {
            this.clearCommittedSelectionForPointerDown(e, target);
        }
    };
    private readonly onLostPointerCapture = (e: PointerEvent) => this.handleLostPointerCapture(e);
    private readonly onWindowKeyDown = (e: KeyboardEvent) => this.handleWindowKeyDown(e);
    private readonly onDocumentFocusIn = (e: FocusEvent) => this.handleDocumentFocusIn(e);
    private readonly onEnterMobileSelectionMode = (e: Event) => this.handleEnterMobileSelectionMode(e);

    constructor(
        readonly view: EditorView,
        readonly deps: PipelineAdapterDeps
    ) {
        this.rangeVisual = new RangeSelectionVisualManager(
            this.view,
            () => this.refreshRangeSelectionVisual(),
            (blockStart) => this.deps.getVisibleHandleForBlockStart?.(blockStart) ?? null
        );
        this.mobile = new InputGuardController(this.view, (e) => this.handleDocumentFocusIn(e));
        this.pointer = new PointerSession(this.view, {
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
        this.dispatchPipeline({ type: 'destroy' });
        this.clearCommittedRangeSelection();
        this.rangeVisual.destroy();

        const editorDom = this.view.dom;
        editorDom.removeEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.removeEventListener('lostpointercapture', this.onLostPointerCapture, true);
        window.removeEventListener('keydown', this.onWindowKeyDown, true);
        editorDom.removeEventListener('focusin', this.onDocumentFocusIn, true);
        editorDom.removeEventListener('dnd:enter-mobile-selection-mode', this.onEnterMobileSelectionMode);
    }

    dispatchPipeline(event: PipelineEvent): PipelineOutput[] {
        const result = reducePipeline(this.pipelineState, event);
        this.pipelineState = result.state;
        this.applyPipelineOutputs(result.outputs);
        return result.outputs;
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
        return isMobileEnvironmentByInput();
    }

    beginRangeSelectionSession(
        source: BlockSelection,
        e: PointerEvent,
        handle: HTMLElement | null,
        options?: RangeSelectionSessionOptions
    ): void {
        void handle;
        beginRangeSelectionSessionAction(this, source, e, options);
        if (e.pointerType !== 'mouse' && this.rangePointerSession?.isIntercepting) {
            this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_SELECTION_GESTURE, e.target);
        }
    }

    activateMouseRangeSelectInterception(state: MouseRangeSelectState): void {
        activateMouseRangeSelectInterceptionAction(this, state);
    }

    beginPressPendingDrag(
        source: BlockSelection,
        e: PointerEvent,
        options?: {
            longPressMs?: number;
            skipLongPress?: boolean;
            deferInterception?: boolean;
            sourceKind?: HoldTarget['source'];
        }
    ): void {
        const pointerType = e.pointerType || null;
        const sourceKind = options?.sourceKind ?? 'handle';
        if (!this.canStartDragForPointer(pointerType, sourceKind)) return;

        const suppressNativeInteraction = options?.deferInterception !== true;
        if (suppressNativeInteraction) {
            e.preventDefault();
            e.stopPropagation();
            this.pointer.tryCapturePointer(e);
            if (pointerType !== 'mouse') {
                this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_DRAG_GESTURE, e.target);
            }
        }

        const sessionId = this.createSessionId();
        const skipLongPress = options?.skipLongPress === true || options?.longPressMs === 0;
        const longPressMs = options?.longPressMs ?? (pointerType === 'mouse'
            ? MOUSE_RANGE_SELECT_LONG_PRESS_MS
            : MOBILE_DRAG_LONG_PRESS_MS);
        const timeoutId = skipLongPress
            ? null
            : window.setTimeout(() => this.markPressReady(sessionId, e.pointerId, pointerType, e.target), longPressMs);
        const startMoveThresholdPx = skipLongPress
            ? 2
            : (pointerType === 'mouse' ? 4 : 8);

        this.pressSession = {
            sessionId,
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
        };
        this.pointer.attachPointerListeners();
        this.dispatchPipeline({
            type: 'hold_start',
            sessionId,
            target: { selection: source, source: sourceKind },
            guardDeps: this.guardDepsForSource(sourceKind, pointerType),
            pointerType,
        });
        if (skipLongPress) {
            this.dispatchPipeline({ type: 'hold_ready', sessionId, pointerType });
        }
    }

    private markPressReady(sessionId: string, pointerId: number, pointerType: string | null, target: EventTarget | null): void {
        const state = this.pressSession;
        if (!state || state.sessionId !== sessionId || state.pointerId !== pointerId) return;
        state.longPressReady = true;
        if (!state.suppressNativeInteraction) {
            state.suppressNativeInteraction = true;
            if (state.pointerType !== 'mouse') {
                this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_DRAG_GESTURE, target);
            }
            this.pointer.tryCapturePointerById(state.pointerId);
        }
        this.dispatchPipeline({ type: 'hold_ready', sessionId, pointerType });
    }

    clearPointerPressState(): void {
        const state = this.pressSession;
        if (!state) return;
        if (state.timeoutId !== null) window.clearTimeout(state.timeoutId);
        this.pressSession = null;
    }

    clearMouseRangeSelectState(options?: { preserveVisual?: boolean }): void {
        clearMouseRangeSelectStateAction(this, options);
    }

    enterDraggingState(
        source: BlockSelection,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType: string | null,
        sourceKind: HoldTarget['source'] = 'handle'
    ): void {
        if (!this.canStartDragForPointer(pointerType, sourceKind)) {
            this.resetInteractionSession({ shouldFinishDragSession: false, shouldHideDropPreview: true });
            return;
        }
        const sessionId = this.pipelineState.type === 'ready_to_drag'
            ? this.pipelineState.hold.sessionId
            : (this.pressSession?.sessionId ?? this.createSessionId());
        if (this.pipelineState.type !== 'ready_to_drag') {
            this.dispatchPipeline({
                type: 'hold_start',
                sessionId,
                target: { selection: source, source: sourceKind },
                guardDeps: this.guardDepsForSource(sourceKind, pointerType),
                pointerType,
            });
            this.dispatchPipeline({ type: 'hold_ready', sessionId, pointerType });
        }
        const drop = this.deps.resolveDropSnapshotAtPoint(clientX, clientY, source, pointerType);
        this.dispatchPipeline({ type: 'drag_start', sessionId, drop, pointerType });
        if (this.pipelineState.type !== 'dragging') return;

        if (this.mobile.isMobileEnvironment()) {
            this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_DRAG_GESTURE);
            this.mobile.triggerMobileHapticFeedback();
        }
        this.pointer.tryCapturePointerById(pointerId);
        this.pointer.attachPointerListeners();
        this.activeDragPointer = { clientX, clientY, pointerType };
        this.activeDragSession = {
            sessionId,
            pointerId,
            pointerType,
            autoScrollFrameId: null,
        };
        this.deps.beginPointerDragSession(source);
        this.clearPointerPressState();
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
    }): PipelineOutput[] {
        const drag = this.activeDragSession;
        if (!drag || this.pipelineState.type !== 'dragging' || drag.pointerId !== params.pointerId) return [];
        drag.pointerType = params.pointerType || drag.pointerType;
        return this.dispatchPipeline({
            type: 'drag_over',
            sessionId: drag.sessionId,
            drop: params.drop,
            pointerType: params.pointerType,
        });
    }

    commitActiveDrag(params: {
        pointerId: number;
        pointerType: string | null;
        resolved: PointerDropCommitResolution;
    }): PipelineOutput[] {
        const drag = this.activeDragSession;
        if (!drag || this.pipelineState.type !== 'dragging' || drag.pointerId !== params.pointerId) return [];
        return this.dispatchPipeline({
            type: 'drop',
            sessionId: drag.sessionId,
            resolution: params.resolved,
            pointerType: params.pointerType,
        });
    }

    cancelActiveDrag(params: {
        pointerId: number;
        pointerType: string | null;
        reason: DragCancelReason;
    }): PipelineOutput[] {
        const drag = this.activeDragSession;
        if (!drag || this.pipelineState.type !== 'dragging' || drag.pointerId !== params.pointerId) return [];
        return this.dispatchPipeline({
            type: 'cancel',
            sessionId: drag.sessionId,
            reason: params.reason,
            pointerType: params.pointerType,
        });
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

    applyPipelineOutputs(outputs: PipelineOutput[]): void {
        for (const output of outputs) {
            switch (output.type) {
                case 'drag_over':
                    this.deps.pipelineOutputExecutor.showDropPreview(output.selection, output.drop, output.pointerType);
                    break;
                case 'dropped':
                    break;
                case 'cancelled':
                    this.deps.pipelineOutputExecutor.hideDropPreview();
                    break;
                case 'command_ready':
                    this.deps.pipelineOutputExecutor.applyCommand(output.command);
                    break;
                case 'lifecycle':
                    this.deps.pipelineOutputExecutor.emitLifecycle(output.event);
                    break;
                case 'state_changed':
                    this.pipelineState = output.state;
                    break;
                case 'selection_changed':
                    this.applySelectionOutput(output.selection);
                    break;
            }
        }
    }

    private applySelectionOutput(selection: BlockSelection | null): void {
        if (!selection) {
            this.committedRangeSelection = null;
            this.rangeVisual.clear();
            return;
        }
        this.committedRangeSelection = {
            blocks: selectedBlocksFromSelection(selection),
            templateBlock: selection.anchorBlock,
        };
        this.refreshRangeSelectionVisual();
    }

    updateMouseRangeSelection(state: MouseRangeSelectState, target: RangeSelectionBoundary): void {
        updateMouseRangeSelectionAction(this, state, target);
    }

    retargetMobileRangeSelection(e: PointerEvent): void {
        const state = this.rangePointerSession;
        if (this.pipelineState.type !== 'selecting' || !state || state.pointerType === 'mouse') return;
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
        const selectedHandleHit = !!target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
        const sourceKind: HoldTarget['source'] = selectedHandleHit ? 'handle' : 'selected_text';
        if (!this.canStartDragForPointer(pointerType, sourceKind)) return false;

        const committedSource = this.getCommittedSelection();
        if (!committedSource) return false;

        if (this.pipelineState.type === 'selecting' && this.rangePointerSession) {
            this.retargetMobileRangeSelection(e);
        } else {
            this.beginPressPendingDrag(committedSource, e, selectedHandleHit
                ? { sourceKind }
                : { sourceKind, deferInterception: true });
        }
        return true;
    }

    commitRangeSelection(state: MouseRangeSelectState): void {
        this.committedRangeSelection = commitRangeSelectionAction(this.view, state, this.rangeVisual, this.pipelineState);
    }

    clearCommittedRangeSelection(): void {
        this.committedRangeSelection = null;
        this.rangeVisual.clear();
    }

    handleMobileDragAvailabilityChanged(mobileDragAvailable: boolean): void {
        if (mobileDragAvailable) {
            return;
        }
        const previousState = this.pipelineState;
        this.dispatchPipeline({ type: 'guard_unavailable', guardId: GUARD_MOBILE_TEXT_DRAG });
        if (previousState.type !== 'idle' && this.pipelineState.type === 'idle') {
            this.clearTechnicalSessions();
            this.pointer.detachPointerListeners();
            this.pointer.releasePointerCapture();
            this.mobile.clearInputGuardMode();
            this.clearCommittedRangeSelection();
        }
    }

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

    resolveBlockSelection(request: BlockSelectionRequest): BlockSelection | null {
        return this.deps.resolveBlockSelection(request);
    }

    private refreshRangeSelectionVisual(): void {
        renderRangeSelectionPreview(this.pipelineState, this.committedRangeSelection, this.rangeVisual);
    }

    finishRangeSelectionSession(): void {
        this.clearMouseRangeSelectState({ preserveVisual: true });
        this.pointer.detachPointerListeners();
        this.pointer.releasePointerCapture();
        this.dispatchPipeline({ type: 'selection_finish' });
        if (this.mobile.isMobileEnvironment() && this.pipelineState.type === 'selecting') {
            this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_SELECTION_PASSIVE);
        } else {
            this.mobile.clearInputGuardMode();
        }
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

    private clearCommittedSelectionForPointerDown(e: PointerEvent, target: HTMLElement): void {
        if (!this.isMultiLineSelectionEnabled()) return;
        if (e.button !== 0 || !this.committedRangeSelection) return;

        const pointerType = e.pointerType || null;
        if (this.isSelectionDragGripHit(target, e.clientX, e.clientY, pointerType)) return;
        if (!this.shouldClearCommittedSelectionOnPointerDown(target, e.clientX, pointerType)) return;
        this.clearCommittedRangeSelection();
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
        if (this.pipelineState.type === 'selecting') {
            this.clearMouseRangeSelectState();
            exitMobileSelectionMode(this);
            this.pointer.detachPointerListeners();
            this.pointer.releasePointerCapture();
            this.mobile.clearInputGuardMode();
            this.dispatchPipeline({ type: 'selection_clear' });
            this.clearCommittedRangeSelection();
            return true;
        }
        if (this.pipelineState.type === 'idle' && this.committedRangeSelection) {
            this.clearCommittedRangeSelection();
            return true;
        }
        return false;
    }

    abortForGestureCancel(
        cancelReason: DragCancelReason,
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
            && this.pipelineState.type !== 'selecting'
            && this.isMobileEnvironment()
            && input.target instanceof HTMLElement
            && this.mobile.shouldSuppressFocusTarget(input.target)
        ) {
            this.clearCommittedRangeSelection();
        }
        if (!this.shouldSuppressTextInputForActiveInteraction()) return;
        this.mobile.suppressMobileKeyboard(e.target);
    }

    private handleTouchMove(e: TouchEvent): void {
        if (!this.shouldSuppressScrollForActiveInteraction()) return;
        if (e.cancelable) {
            e.preventDefault();
        }
    }

    private hasActivePointerSession(): boolean {
        if (this.activeDragSession || this.pressSession) return true;
        if (this.pipelineState.type === 'selecting') {
            return !!this.rangePointerSession;
        }
        return false;
    }

    private shouldSuppressTextInputForActiveInteraction(): boolean {
        if (this.pipelineState.type === 'dragging') return true;
        if (this.pipelineState.type === 'selecting') return true;
        if (this.rangePointerSession?.isIntercepting) return true;
        if (this.pressSession) return this.pressSession.suppressNativeInteraction;
        return false;
    }

    private shouldSuppressScrollForActiveInteraction(): boolean {
        if (this.pipelineState.type === 'dragging') return true;
        if (this.pipelineState.type === 'selecting') {
            return !!this.rangePointerSession?.isIntercepting;
        }
        if (this.rangePointerSession?.isIntercepting) return true;
        if (this.pressSession) return this.pressSession.suppressNativeInteraction;
        return false;
    }

    private resetInteractionSession(options?: InteractionCleanupOptions): void {
        const hadDrag = !!this.activeDragSession || this.pipelineState.type === 'dragging';
        const activeDrag = this.activeDragSession;
        if (activeDrag) this.cancelDragAutoScroll(activeDrag);

        const shouldFinishDragSession = options?.shouldFinishDragSession ?? hadDrag;
        const shouldHideDropPreview = options?.shouldHideDropPreview ?? hadDrag;
        const cancelReason = options?.cancelReason ?? null;
        const pointerType = options?.pointerType ?? null;

        this.clearTechnicalSessions();
        this.pointer.detachPointerListeners();
        this.pointer.releasePointerCapture();
        this.mobile.clearInputGuardMode();

        if (cancelReason) {
            this.dispatchPipeline({ type: 'cancel', reason: cancelReason, pointerType });
        } else if (this.pipelineState.type !== 'idle') {
            this.dispatchPipeline({ type: 'destroy' });
        }
        if (shouldHideDropPreview) {
            this.deps.pipelineOutputExecutor.hideDropPreview();
        }
        if (hadDrag && shouldFinishDragSession) {
            this.deps.finishDragSession();
        }
        this.activeDragPointer = null;
    }

    isMultiLineSelectionEnabled(): boolean {
        if (!this.deps.isMultiLineSelectionEnabled) return true;
        return this.deps.isMultiLineSelectionEnabled();
    }

    canStartDragForPointer(pointerType: string | null, source: HoldTarget['source'] = 'handle'): boolean {
        if (source === 'handle' || source === 'command') return true;
        if (pointerType === 'mouse') return true;
        if (!this.mobile.isMobileEnvironment()) return true;
        if (this.deps.isMobileDragModeRequired?.() !== true) return true;
        return this.deps.isMobileDragModeEnabled?.() === true;
    }

    isMobileDragModeActiveForPointer(pointerType: string | null): boolean {
        if (pointerType === 'mouse') return false;
        if (!this.mobile.isMobileEnvironment()) return false;
        return this.deps.isMobileDragModeRequired?.() === true
            && this.deps.isMobileDragModeEnabled?.() === true;
    }

    getTouchRangeSelectLongPressMs(): number {
        return clampTouchRangeSelectLongPressMs(this.deps.getMultiLineSelectionLongPressMs?.());
    }

    private clearTechnicalSessions(): void {
        this.clearPointerPressState();
        if (this.rangePointerSession?.timeoutId !== null && this.rangePointerSession?.timeoutId !== undefined) {
            window.clearTimeout(this.rangePointerSession.timeoutId);
        }
        if (this.rangePointerSession?.dragTimeoutId !== null && this.rangePointerSession?.dragTimeoutId !== undefined) {
            window.clearTimeout(this.rangePointerSession.dragTimeoutId);
        }
        this.rangePointerSession = null;
        this.activeDragSession = null;
    }

    private guardDepsForSource(source: HoldTarget['source'], pointerType: string | null): string[] {
        if ((source === 'text' || source === 'selected_text') && pointerType !== 'mouse' && this.mobile.isMobileEnvironment()) {
            return [GUARD_MOBILE_TEXT_DRAG];
        }
        return [];
    }

    private createSessionId(): string {
        return `drag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
}

function selectedBlocksFromSelection(selection: BlockSelection): SelectedBlockRange[] {
    return selection.ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));
}
