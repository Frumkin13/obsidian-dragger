import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../shared/types/block-types';
import { DragLifecycleEvent } from '../../../shared/types/drag-events';
import {
    getHandleColumnCenterX,
} from '../../../infra/dom/handle/handle-positioner';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
    RANGE_SELECTION_LINK_CLASS,
} from '../../../shared/dom-selectors';
import { RangeSelectionVisualManager } from '../../drag-handle/view/HandleEvents';
import { MobileGestureController } from './TouchHandler';
import { PointerSessionController } from './pointer-session-controller';
import {
    type RangeSelectionBoundary,
    type RangeSelectConfig,
    type CommittedRangeSelection,
    type MouseRangeSelectState,
    normalizeLineRange,
    mergeLineRanges,
    cloneLineRanges,
    cloneBlockInfo,
    buildDragSourceBlockFromRanges,
    expandToBlockAlignedRange,
    resolveBlockBoundaryAtLine,
} from '../../../core/services/state/selection-model';
import { resolveRangeBoundaryAtPoint } from './range-selection-hit';

const MOBILE_DRAG_LONG_PRESS_MS = 200;
const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;
const MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX = 12;
const TOUCH_RANGE_SELECT_LONG_PRESS_MS = 900;
const MOUSE_RANGE_SELECT_LONG_PRESS_MS = 260;
const MOUSE_RANGE_SELECT_CANCEL_MOVE_THRESHOLD_PX = 12;
const RANGE_SELECTION_GRIP_HIT_PADDING_PX = 20;
const RANGE_SELECTION_GRIP_HIT_X_PADDING_PX = 28;

type PointerDragData = {
    sourceBlock: BlockInfo;
    pointerId: number;
};

type PointerPressData = {
    sourceBlock: BlockInfo;
    pointerId: number;
    startX: number;
    startY: number;
    latestX: number;
    latestY: number;
    pointerType: string | null;
    longPressReady: boolean;
    timeoutId: number | null;
    cancelMoveThresholdPx: number;
    startMoveThresholdPx: number;
};

type PointerTerminalMode = 'up' | 'cancel';
type GestureCancelReason = 'press_cancelled' | 'pointer_cancelled';

type InteractionState =
    | { phase: 'idle' }
    | { phase: 'press_pending'; press: PointerPressData }
    | { phase: 'range_selecting'; rangeSelect: MouseRangeSelectState }
    | { phase: 'dragging'; drag: PointerDragData };

export interface DragEventHandlerDeps {
    getDragSourceBlock: (e: DragEvent) => BlockInfo | null;
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMultiLineSelectionEnabled?: () => boolean;
    isMobileTextLongPressDragEnabled?: () => boolean;
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

        // Mobile interaction hit should be consumed first to avoid editor focus/keyboard side effects.
        e.preventDefault();
        e.stopPropagation();

        const blockInfo = this.deps.getBlockInfoAtPoint(e.clientX, e.clientY);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

        const useHotzonePath = inMobileHotzoneBand
            && this.mobile.isWithinMobileDragHotzone(blockInfo, e.clientX);
        if (useHotzonePath) {
            if (multiLineSelectionEnabled) {
                this.beginRangeSelectionSession(blockInfo, e, null);
            } else {
                this.beginPressPendingDrag(blockInfo, e);
            }
            return;
        }

        if (inTextLineOrEmbedArea) {
            this.beginPressPendingDrag(blockInfo, e);
        }
    };

    private readonly onEditorDragEnter = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        if (this.gesture.phase === 'range_selecting') {
            this.clearMouseRangeSelectState();
            this.pointer.detachPointerListeners();
            this.pointer.releasePointerCapture();
        }
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
    };

    private readonly onEditorDragOver = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = 'move';
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, this.deps.getDragSourceBlock(e), 'mouse');
    };

    private readonly onEditorDragLeave = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        const rect = this.view.dom.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) {
            this.deps.hideDropIndicator();
        }
    };

    private readonly onEditorDrop = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
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
        this.rangeVisual = new RangeSelectionVisualManager(this.view, () => this.refreshRangeSelectionVisual());
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
            if (multiLineSelectionEnabled) {
                this.beginRangeSelectionSession(blockInfo, e, handle);
            } else {
                this.beginPressPendingDrag(blockInfo, e);
            }
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

    private shouldHandleDrag(e: DragEvent): boolean {
        if (!e.dataTransfer) return false;
        return Array.from(e.dataTransfer.types).includes('application/dnd-block');
    }

    private isMobileEnvironment(): boolean {
        return this.mobile.isMobileEnvironment();
    }

    private shouldStartMobilePressDrag(e: PointerEvent): boolean {
        if (this.gesture.phase !== 'idle') return false;
        if (e.button !== 0) return false;
        if (e.pointerType === 'mouse') return false;
        if (!this.mobile.isMobileEnvironment()) return false;
        return true;
    }

    private getRangeSelectConfig(pointerType: string | null): RangeSelectConfig {
        if (pointerType === 'mouse') {
            return {
                longPressMs: MOUSE_RANGE_SELECT_LONG_PRESS_MS,
            };
        }

        return {
            longPressMs: TOUCH_RANGE_SELECT_LONG_PRESS_MS,
        };
    }

    private beginRangeSelectionSession(blockInfo: BlockInfo, e: PointerEvent, handle: HTMLElement | null): void {
        const anchorStartLineNumber = blockInfo.startLine + 1;
        const anchorEndLineNumber = blockInfo.endLine + 1;
        if (
            anchorStartLineNumber < 1
            || anchorEndLineNumber > this.view.state.doc.lines
            || anchorStartLineNumber > anchorEndLineNumber
        ) {
            return;
        }

        const committedRangesSnapshot = cloneLineRanges(this.committedRangeSelection?.ranges ?? []);
        const docLines = this.view.state.doc.lines;
        const anchorRange = normalizeLineRange(docLines, anchorStartLineNumber, anchorEndLineNumber);
        const initialRanges = mergeLineRanges(docLines, [...committedRangesSnapshot, anchorRange]);
        const anchorBlock = buildDragSourceBlockFromRanges(this.view.state.doc, initialRanges, blockInfo);
        const pointerType = e.pointerType || null;
        const config = this.getRangeSelectConfig(pointerType);
        const sourceHandleDraggableAttr = handle?.getAttribute('draggable') ?? null;
        const shouldDeferInterception = pointerType === 'mouse';
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

        this.gesture = { phase: 'range_selecting', rangeSelect: {
            anchorSelectionBlock: anchorBlock,
            directDragSourceBlock: cloneBlockInfo(blockInfo),
            activeSelectionBlock: anchorBlock,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            latestX: e.clientX,
            latestY: e.clientY,
            pointerType,
            dragReady: pointerType === 'mouse',
            longPressReady: false,
            isIntercepting: !shouldDeferInterception,
            timeoutId,
            dragTimeoutId,
            sourceHandle: handle,
            sourceHandleDraggableAttr,
            anchorStartLineNumber,
            anchorEndLineNumber,
            currentLineNumber: anchorEndLineNumber,
            committedRangesSnapshot,
            selectionRanges: initialRanges,
        } };
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
        options?: { skipLongPress?: boolean }
    ): void {
        const pointerType = e.pointerType || null;
        e.preventDefault();
        e.stopPropagation();
        this.pointer.tryCapturePointer(e);
        if (pointerType !== 'mouse') {
            this.mobile.lockMobileInteraction();
            this.mobile.attachFocusGuard();
            this.mobile.suppressMobileKeyboard();
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
        const scroller = this.view.scrollDOM
            ?? this.view.dom.querySelector<HTMLElement>('.cm-scroller')
            ?? null;
        if (!scroller) return;

        const rect = scroller.getBoundingClientRect();
        const edgeZone = 44;
        let delta = 0;
        if (clientY < rect.top + edgeZone) {
            delta = -Math.min(22, ((rect.top + edgeZone) - clientY) * 0.35 + 2);
        } else if (clientY > rect.bottom - edgeZone) {
            delta = Math.min(22, (clientY - (rect.bottom - edgeZone)) * 0.35 + 2);
        }
        if (delta === 0) return;
        scroller.scrollTop += delta;
    }

    private updateMouseRangeSelectionFromLine(state: MouseRangeSelectState, lineNumber: number): void {
        const doc = this.view.state.doc;
        const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
        const boundary = resolveBlockBoundaryAtLine(this.view.state, clampedLine);
        this.updateMouseRangeSelection(state, {
            ...boundary,
            representativeLineNumber: clampedLine,
        });
    }

    private updateMouseRangeSelection(state: MouseRangeSelectState, target: RangeSelectionBoundary): void {
        state.currentLineNumber = target.representativeLineNumber;
        const {
            startLineNumber: rangeStartLineNumber,
            endLineNumber: rangeEndLineNumber,
        } = expandToBlockAlignedRange(
            this.view.state,
            state.anchorStartLineNumber,
            state.anchorEndLineNumber,
            target.startLineNumber,
            target.endLineNumber
        );

        const docLines = this.view.state.doc.lines;
        const activeRange = normalizeLineRange(docLines, rangeStartLineNumber, rangeEndLineNumber);
        state.selectionRanges = mergeLineRanges(docLines, [
            ...state.committedRangesSnapshot,
            activeRange,
        ]);
        state.activeSelectionBlock = buildDragSourceBlockFromRanges(
            this.view.state.doc,
            state.selectionRanges,
            state.anchorSelectionBlock
        );

        this.rangeVisual.render(state.selectionRanges);
    }

    private commitRangeSelection(state: MouseRangeSelectState): void {
        const docLines = this.view.state.doc.lines;
        const committedRanges = mergeLineRanges(docLines, state.selectionRanges);
        const committedBlock = buildDragSourceBlockFromRanges(this.view.state.doc, committedRanges, state.anchorSelectionBlock);
        this.committedRangeSelection = {
            selectedBlock: committedBlock,
            ranges: committedRanges,
        };
        this.rangeVisual.render(committedRanges);
    }

    private clearCommittedRangeSelection(): void {
        if (!this.committedRangeSelection) return;
        this.committedRangeSelection = null;
        this.rangeVisual.clear();
    }

    private getCommittedSelectionBlock(): BlockInfo | null {
        if (!this.committedRangeSelection) return null;
        return cloneBlockInfo(this.committedRangeSelection.selectedBlock);
    }

    private refreshRangeSelectionVisual(): void {
        if (this.gesture.phase === 'range_selecting') {
            this.rangeVisual.render(this.gesture.rangeSelect.selectionRanges);
            return;
        }
        if (this.committedRangeSelection) {
            this.rangeVisual.render(this.committedRangeSelection.ranges);
        }
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
        if (!this.committedRangeSelection) return false;
        if (target.closest(`.${RANGE_SELECTION_LINK_CLASS}`)) return false;
        if (target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`)) return false;
        if (target.closest(`.${DRAG_HANDLE_CLASS}`)) return false;

        if (pointerType && pointerType !== 'mouse') {
            if (!this.mobile.isWithinContentTolerance(clientX)) {
                return true;
            }
            const inContent = this.view.contentDOM.contains(target) || !!target.closest('.cm-content');
            const inGutter = !!target.closest('.cm-gutters');
            return !inContent && !inGutter;
        }
        const centerX = getHandleColumnCenterX(this.view);
        return clientX > centerX + RANGE_SELECTION_GRIP_HIT_X_PADDING_PX;
    }

    private isCommittedSelectionGripHit(
        target: HTMLElement,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): boolean {
        const committedSelection = this.committedRangeSelection;
        if (!committedSelection) return false;

        const hitLink = target.closest(`.${RANGE_SELECTION_LINK_CLASS}`);
        if (hitLink) return true;

        const hitHandle = target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
        if (hitHandle) return true;

        if (pointerType && pointerType !== 'mouse') {
            if (!this.mobile.isWithinMobileDragHotzoneBand(clientX)) {
                return false;
            }
        } else {
            const centerX = getHandleColumnCenterX(this.view);
            if (Math.abs(clientX - centerX) > RANGE_SELECTION_GRIP_HIT_X_PADDING_PX) {
                return false;
            }
        }

        for (const range of committedSelection.ranges) {
            const startAnchorY = this.rangeVisual.getAnchorY(range.startLineNumber);
            const endAnchorY = this.rangeVisual.getAnchorY(range.endLineNumber);
            if (startAnchorY === null || endAnchorY === null) continue;
            const top = Math.min(startAnchorY, endAnchorY) - RANGE_SELECTION_GRIP_HIT_PADDING_PX;
            const bottom = Math.max(startAnchorY, endAnchorY) + RANGE_SELECTION_GRIP_HIT_PADDING_PX;
            if (clientY >= top && clientY <= bottom) {
                return true;
            }
        }
        return false;
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
        if (!this.hasActivePointerSession()) return;
        this.mobile.suppressMobileKeyboard(e.target);
    }

    private handleTouchMove(e: TouchEvent): void {
        if (!this.hasActivePointerSession()) return;
        if (e.cancelable) {
            e.preventDefault();
        }
    }

    private hasActivePointerSession(): boolean {
        return this.gesture.phase !== 'idle';
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
        this.emitLifecycle({
            state: 'press_pending',
            sourceBlock,
            targetLine: null,
            listIntent: null,
            rejectReason: null,
            pointerType,
            pressReady,
        });
    }

    private emitDragActiveLifecycle(sourceBlock: BlockInfo, pointerType: string | null): void {
        this.emitLifecycle({
            state: 'drag_active',
            sourceBlock,
            targetLine: null,
            listIntent: null,
            rejectReason: null,
            pointerType,
        });
    }

    private emitCancelledLifecycle(
        sourceBlock: BlockInfo,
        rejectReason: string,
        pointerType: string | null
    ): void {
        this.emitLifecycle({
            state: 'cancelled',
            sourceBlock,
            targetLine: null,
            listIntent: null,
            rejectReason,
            pointerType,
        });
    }

    private emitIdleLifecycle(): void {
        this.emitLifecycle({
            state: 'idle',
            sourceBlock: null,
            targetLine: null,
            listIntent: null,
            rejectReason: null,
            pointerType: null,
        });
    }

    private isMultiLineSelectionEnabled(): boolean {
        if (!this.deps.isMultiLineSelectionEnabled) return true;
        return this.deps.isMultiLineSelectionEnabled();
    }

    private isMobileTextLongPressDragEnabled(): boolean {
        if (!this.deps.isMobileTextLongPressDragEnabled) return true;
        return this.deps.isMobileTextLongPressDragEnabled();
    }
}
