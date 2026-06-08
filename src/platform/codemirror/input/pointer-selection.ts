import type { EditorView } from '@codemirror/view';
import { BlockType, type BlockInfo } from '../../../domain/block/block-types';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { RangeSelectionOperation } from '../../../domain/selection/block-selection';
import type { BlockSelectionRequest } from '../selection/block-selection-resolver';
import {
    type SelectedBlockRange,
} from '../../../domain/selection/block-ranges';
import type {
    CommittedRangeSelection,
    RangeSelectionBoundary,
} from '../../../domain/selection/range-selection';
import {
    buildCommittedRangeSelection,
    buildRangeSelectionBoundaryFromBlock,
} from '../../../domain/selection/range-selection';
import { RangeSelectionVisualManager } from '../preview/range-selection-visual-manager';
import type { HoldTarget, PipelineState } from '../../../drag/pipeline/pipeline-state';
import type { GuardId } from '../../../drag/pipeline/pipeline-event';
import { createRangeSelectionBoundaryResolver } from '../selection/block-boundary-resolver';
import { InputGuardController } from './input-guards';
import { PointerSession } from './pointer-session';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import {
    shouldStartMobilePressDrag as shouldStartMobilePressDragByInput,
} from './pointer-hit-test';
import {
    INPUT_GUARD_MOBILE_SELECTION_GESTURE,
    INPUT_GUARD_MOBILE_SELECTION_PASSIVE,
} from './input-guards';
import type { PipelineEvent } from '../../../drag/pipeline/pipeline-event';
import {
    MOBILE_DRAG_LONG_PRESS_MS,
    MOUSE_RANGE_SELECT_LONG_PRESS_MS,
} from './touch-delay-policy';
import {
    createInitialRangeSelectionState,
    type MouseRangeSelectState,
    resolveRangeSelectConfig,
} from './range-selection-gesture-state';

export interface RangeSelectionActionHost {
    readonly view: EditorView;
    readonly rangeVisual: RangeSelectionVisualManager;
    pipelineState: PipelineState;
    rangePointerSession: MouseRangeSelectState | null;
    committedRangeSelection: CommittedRangeSelection | null;
    pointer: {
        tryCapturePointer(e: PointerEvent): void;
        tryCapturePointerById(pointerId: number): void;
        attachPointerListeners(): void;
    };

    getTouchRangeSelectLongPressMs(): number;
    resolveBlockSelection(request: BlockSelectionRequest): BlockSelection | null;
    dispatchPipeline(event: PipelineEvent): unknown;
}

export type RangeSelectionSessionOptions = {
    skipLongPress?: boolean;
    initialOperation?: RangeSelectionOperation;
    guardDeps?: GuardId[];
    sourceKind?: HoldTarget['source'];
    deferPipelineStart?: boolean;
    deferInterception?: boolean;
    allowSecondaryDrag?: boolean;
};

export function beginRangeSelectionSessionAction(
    host: RangeSelectionActionHost,
    source: BlockSelection,
    e: PointerEvent,
    options?: RangeSelectionSessionOptions
): void {
    const blockInfo = source.anchorBlock;
    const committedBlocksSnapshot = host.committedRangeSelection?.blocks.map((block) => ({ ...block })) ?? [];
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
        sourceSelection: source,
        baseSelectedBlocks: committedBlocksSnapshot,
        initialOperation: options?.initialOperation,
        guardDeps: options?.guardDeps,
        sourceKind: options?.sourceKind,
        doc: host.view.state.doc,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        pointerType,
    });
    if (!initialRangeSelectState) return;
    initialRangeSelectState.longPressReady = skipLongPress;

    const allowSecondaryDrag = options?.allowSecondaryDrag !== false;
    let dragTimeoutId: number | null = null;
    if (pointerType !== 'mouse' && allowSecondaryDrag) {
        dragTimeoutId = window.setTimeout(() => {
            const state = host.rangePointerSession;
            if (!state) return;
            if (state.pipelineStarted && host.pipelineState.type !== 'selecting') return;
            if (state.pointerId !== e.pointerId) return;
            state.dragReady = true;
            activateMouseRangeSelectInterception(host, state);
        }, MOBILE_DRAG_LONG_PRESS_MS);
    }
    const shouldDeferNativeInterception = options?.deferInterception === true || shouldDeferInterception;
    if (!shouldDeferNativeInterception) {
        e.preventDefault();
        e.stopPropagation();
        host.pointer.tryCapturePointer(e);
    }

    const timeoutId = skipLongPress
        ? null
        : window.setTimeout(() => {
            const state = host.rangePointerSession;
            if (!state) return;
            if (state.pipelineStarted && host.pipelineState.type !== 'selecting') return;
            if (state.pointerId !== e.pointerId) return;
            state.longPressReady = true;
            startRangeSelectionPipeline(host, state);
            activateMouseRangeSelectInterception(host, state);
            updateMouseRangeSelectionFromLine(host, state, state.currentLineNumber);
        }, config.longPressMs);

    initialRangeSelectState.isIntercepting = !shouldDeferNativeInterception;
    initialRangeSelectState.timeoutId = timeoutId;
    initialRangeSelectState.dragTimeoutId = dragTimeoutId;
    host.rangePointerSession = initialRangeSelectState;
    host.pointer.attachPointerListeners();

    if (!options?.deferPipelineStart) {
        startRangeSelectionPipeline(host, initialRangeSelectState);
    }
    if (skipLongPress) {
        initialRangeSelectState.longPressReady = true;
        startRangeSelectionPipeline(host, initialRangeSelectState);
        updateMouseRangeSelectionFromLine(host, initialRangeSelectState, initialRangeSelectState.currentLineNumber);
    }
}

function startRangeSelectionPipeline(host: RangeSelectionActionHost, state: MouseRangeSelectState): void {
    if (state.pipelineStarted) return;
    state.pipelineStarted = true;
    host.dispatchPipeline({
        type: 'selection_start',
        seed: {
            selection: state.sourceSelection,
            range: {
                type: 'range',
                doc: host.view.state.doc,
                blockInfo: state.anchorBlock,
                selectedBlocks: state.baseSelectedBlocks,
                operation: state.initialOperation,
            },
        },
        guardDeps: state.guardDeps,
    });
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
    host: Pick<RangeSelectionActionHost, 'rangePointerSession' | 'rangeVisual' | 'committedRangeSelection'>,
    options?: { preserveVisual?: boolean }
): void {
    const state = host.rangePointerSession;
    if (!state) return;
    if (state.timeoutId !== null) window.clearTimeout(state.timeoutId);
    if (state.dragTimeoutId !== null) window.clearTimeout(state.dragTimeoutId);
    host.rangePointerSession = null;
    if (!options?.preserveVisual) {
        if (host.committedRangeSelection) {
            host.rangeVisual.render(host.committedRangeSelection.blocks);
        } else {
            host.rangeVisual.clear();
        }
    }
}

export function updateMouseRangeSelectionFromLine(
    host: Pick<RangeSelectionActionHost, 'view' | 'dispatchPipeline' | 'pipelineState'>,
    state: MouseRangeSelectState,
    lineNumber: number
): void {
    const doc = host.view.state.doc;
    const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
    const boundary = createRangeSelectionBoundaryResolver(host.view.state)(clampedLine);
    updateMouseRangeSelection(host, state, {
        ...boundary,
        representativeLineNumber: clampedLine,
    });
}

export function updateMouseRangeSelection(
    host: Pick<RangeSelectionActionHost, 'view' | 'dispatchPipeline' | 'pipelineState'>,
    state: MouseRangeSelectState,
    target: RangeSelectionBoundary
): void {
    host.dispatchPipeline({
        type: 'selection_change',
        boundary: target,
        docLines: host.view.state.doc.lines,
        resolveBoundary: createRangeSelectionBoundaryResolver(host.view.state),
    });
    state.currentLineNumber = target.representativeLineNumber;
    state.selectionGestureStarted = true;
}

export function commitRangeSelection(
    view: EditorView,
    state: MouseRangeSelectState,
    rangeVisual: RangeSelectionVisualManager,
    pipelineState: PipelineState
): CommittedRangeSelection | null {
    if (pipelineState.type !== 'selecting') {
        rangeVisual.clear();
        return null;
    }
    const committed = buildCommittedRangeSelection(
        view.state.doc,
        selectedBlocksFromSelection(pipelineState.selection.selection),
        state.anchorBlock
    );
    if (!committed) {
        rangeVisual.clear();
        return null;
    }
    rangeVisual.render(committed.blocks);
    return committed;
}

export interface PointerInteractionDeps {
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMobileTextLongPressDragEnabled?: () => boolean;
}

export interface PointerInteractionHost {
    readonly view: EditorView;
    readonly deps: PointerInteractionDeps;
    readonly rangeVisual: RangeSelectionVisualManager;
    readonly mobile: InputGuardController;
    readonly pointer: PointerSession;
    pipelineState: PipelineState;
    rangePointerSession: MouseRangeSelectState | null;
    committedRangeSelection: CommittedRangeSelection | null;

    dispatchPipeline(event: PipelineEvent): unknown;
    resolveBlockSelection(request: BlockSelectionRequest): BlockSelection | null;

    beginRangeSelectionSession(
        source: BlockSelection,
        e: PointerEvent,
        handle: HTMLElement | null,
        options?: RangeSelectionSessionOptions
    ): void;
    beginPressPendingDrag(
        source: BlockSelection,
        e: PointerEvent,
        options?: { longPressMs?: number; skipLongPress?: boolean; deferInterception?: boolean; sourceKind?: 'handle' | 'text' | 'selected_text' | 'command' }
    ): void;
    enterDraggingState(
        source: BlockSelection,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType: string | null,
        sourceKind?: 'handle' | 'text' | 'selected_text' | 'command'
    ): void;
    tryStartCommittedSelectionDrag(e: PointerEvent, target: HTMLElement): boolean;
    clearCommittedRangeSelection(): void;
    isMultiLineSelectionEnabled(): boolean;
    canStartDragForPointer(pointerType: string | null, source?: 'handle' | 'text' | 'selected_text' | 'command'): boolean;
    isMobileDragModeActiveForPointer(pointerType: string | null): boolean;
}

export function handlePointerDown(
    host: PointerInteractionHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    const policy = resolvePointerInputPolicy(host, e);
    if (tryStartSelectionResize(host, e, target, policy)) return true;
    if (host.tryStartCommittedSelectionDrag(e, target)) return true;

    const handle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (handle && !handle.classList.contains(EMBED_HANDLE_CLASS)) {
        return startHandlePointerDown(host, e, handle, policy);
    }

    if (tryStartTextRangeSelection(host, e, target, policy)) return true;
    if (isPassiveSelectionActive(host)) return false;
    if (tryStartTextLongPressDrag(host, e, target, policy)) return true;
    return false;
}

type PointerPlatform = 'desktop' | 'mobile';

type PointerInputPolicy = {
    platform: PointerPlatform;
    pointerType: string | null;
    canResizeSelection: boolean;
    canUseTextLongPress: boolean;
    handleLongPressMs: number;
};

function resolvePointerInputPolicy(host: PointerInteractionHost, e: PointerEvent): PointerInputPolicy {
    const pointerType = e.pointerType || null;
    const platform = pointerType !== 'mouse' && host.mobile.isMobileEnvironment() ? 'mobile' : 'desktop';
    return {
        platform,
        pointerType,
        canResizeSelection: platform === 'mobile',
        canUseTextLongPress: platform === 'mobile',
        handleLongPressMs: platform === 'desktop' ? 0 : MOBILE_DRAG_LONG_PRESS_MS,
    };
}

function isPassiveSelectionActive(host: PointerInteractionHost): boolean {
    return host.pipelineState.type === 'selecting'
        && host.pipelineState.selection.phase === 'passive';
}

function tryStartSelectionResize(
    host: PointerInteractionHost,
    e: PointerEvent,
    target: HTMLElement,
    policy: PointerInputPolicy
): boolean {
    if (!policy.canResizeSelection) return false;
    if (host.pipelineState.type !== 'selecting' || host.pipelineState.selection.phase !== 'passive') return false;

    const handleEl = target.closest<HTMLElement>(`.${MOBILE_SELECTION_RESIZE_HANDLE_CLASS}`);
    if (!handleEl) return false;

    const rawHandle = handleEl.getAttribute('data-dnd-mobile-selection-handle');
    if (rawHandle !== 'top' && rawHandle !== 'bottom') return false;

    if (!startMobileSelectionResize(host, e, rawHandle)) return false;

    e.preventDefault();
    e.stopPropagation();
    host.pointer.tryCapturePointer(e);
    host.pointer.attachPointerListeners();
    host.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_SELECTION_GESTURE, e.target);
    return true;
}

function startHandlePointerDown(
    host: PointerInteractionHost,
    e: PointerEvent,
    handle: HTMLElement,
    policy: PointerInputPolicy
): boolean {
    if (e.button !== 0) return false;
    if (policy.platform === 'mobile') {
        if (tryStartRangeSelectionFromHandleWhileSelecting(host, handle, e)) return true;
        if (tryRetargetRangeSelectionFromHandleWhileSelecting(host, handle, e)) return true;
    }

    const source = host.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return true;
    const blockInfo = source.anchorBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return true;

    const rangePolicy = resolveHandleRangeSelectionPolicy(host, e, policy);
    if (rangePolicy) {
        if (policy.handleLongPressMs === 0) {
            e.preventDefault();
            e.stopPropagation();
        }
        host.beginRangeSelectionSession(source, e, handle, rangePolicy);
        return true;
    }

    host.beginPressPendingDrag(source, e, {
        sourceKind: 'handle',
        longPressMs: policy.handleLongPressMs,
    });
    return true;
}

function resolveHandleRangeSelectionPolicy(
    host: PointerInteractionHost,
    e: PointerEvent,
    policy: PointerInputPolicy
): RangeSelectionSessionOptions | null {
    if (!host.isMultiLineSelectionEnabled()) return null;
    if (policy.platform === 'mobile') {
        if (host.committedRangeSelection) return { skipLongPress: true };
        return { deferPipelineStart: true, guardDeps: ['mobile-text-drag-mode'], sourceKind: 'handle' };
    }
    return host.committedRangeSelection || e.shiftKey
        ? { skipLongPress: true }
        : { deferPipelineStart: true };
}

function tryStartRangeSelectionFromHandleWhileSelecting(
    host: PointerInteractionHost,
    handle: HTMLElement,
    e: PointerEvent
): boolean {
    if (host.pipelineState.type !== 'selecting' || host.pipelineState.selection.phase !== 'passive') return false;
    if (e.pointerType === 'mouse') return false;
    if (targetIsInsideMobileSelection(handle)) return false;

    const source = host.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return false;
    return startRangeSelectionThroughSharedSession(host, source, e, { skipLongPress: true });
}

function startRangeSelectionThroughSharedSession(
    host: PointerInteractionHost,
    source: BlockSelection,
    e: PointerEvent,
    options?: Pick<RangeSelectionSessionOptions, 'skipLongPress' | 'deferPipelineStart' | 'deferInterception' | 'allowSecondaryDrag' | 'sourceKind'>
): boolean {
    if (host.pipelineState.type !== 'selecting' || host.pipelineState.selection.phase !== 'passive') return false;
    if (e.pointerType === 'mouse') return false;
    const blockInfo = source.anchorBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return false;

    host.beginRangeSelectionSession(source, e, null, {
        ...options,
        initialOperation: 'add',
        guardDeps: ['mobile-text-drag-mode'],
    });
    return true;
}

function tryStartTextRangeSelection(
    host: PointerInteractionHost,
    e: PointerEvent,
    target: HTMLElement,
    policy: PointerInputPolicy
): boolean {
    if (!isPassiveSelectionActive(host)) return false;
    if (!policy.canUseTextLongPress) return false;
    if (!shouldStartMobilePressDragByInput(e)) return false;
    if (!host.canStartDragForPointer(e.pointerType || null, 'text')) return false;
    if (!isMobileTextLongPressDragEnabled(host)) return false;
    if (!host.mobile.isWithinMobileTextLineOrEmbedArea(target, e.clientX, e.clientY)) return false;

    const source = host.resolveBlockSelection({ kind: 'point', clientX: e.clientX, clientY: e.clientY });
    if (!source) return false;
    return startRangeSelectionThroughSharedSession(host, source, e, {
        deferPipelineStart: true,
        deferInterception: true,
        allowSecondaryDrag: false,
        sourceKind: 'text',
    });
}

function tryRetargetRangeSelectionFromHandleWhileSelecting(
    host: PointerInteractionHost,
    handle: HTMLElement,
    e: PointerEvent
): boolean {
    if (host.pipelineState.type !== 'selecting') return false;
    if (e.pointerType === 'mouse') return false;

    const source = host.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return false;
    const blockInfo = source.anchorBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return false;

    const targetBoundary = buildRangeSelectionBoundaryFromBlock(host.view.state.doc, blockInfo);
    host.dispatchPipeline({
        type: 'selection_change',
        boundary: targetBoundary,
        docLines: host.view.state.doc.lines,
        resolveBoundary: createRangeSelectionBoundaryResolver(host.view.state),
    });
    e.preventDefault();
    e.stopPropagation();
    host.pointer.tryCapturePointer(e);
    return true;
}

function tryStartTextLongPressDrag(
    host: PointerInteractionHost,
    e: PointerEvent,
    target: HTMLElement,
    policy: PointerInputPolicy
): boolean {
    if (!policy.canUseTextLongPress) return false;
    if (!shouldStartMobilePressDrag(host, e)) return false;
    if (!host.canStartDragForPointer(e.pointerType || null, 'text')) return false;
    const shouldSuppressInput = host.isMobileDragModeActiveForPointer(e.pointerType || null);

    const inTextLineOrEmbedArea = isMobileTextLongPressDragEnabled(host)
        && host.mobile.isWithinMobileTextLineOrEmbedArea(target, e.clientX, e.clientY);
    if (!inTextLineOrEmbedArea) return false;

    const source = host.resolveBlockSelection({ kind: 'point', clientX: e.clientX, clientY: e.clientY });
    if (!source) return false;
    const blockInfo = source.anchorBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return false;

    if (host.isMultiLineSelectionEnabled()) {
        host.beginRangeSelectionSession(source, e, null, {
            deferPipelineStart: true,
            deferInterception: !shouldSuppressInput,
            guardDeps: ['mobile-text-drag-mode'],
            sourceKind: 'text',
        });
        return true;
    }

    host.beginPressPendingDrag(source, e, shouldSuppressInput
        ? { sourceKind: 'text' }
        : { deferInterception: true, sourceKind: 'text' });
    return true;
}

function targetIsInsideMobileSelection(target: HTMLElement): boolean {
    return !!target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
}

export function enterMobileSelectionMode(host: PointerInteractionHost, e: Event): void {
    if (!host.mobile.isMobileEnvironment()) return;
    if (!host.isMultiLineSelectionEnabled()) return;
    if (host.pipelineState.type !== 'idle') return;

    const line = host.view.state.doc.lineAt(host.view.state.selection.main.head);
    const boundaryAtCursor = createRangeSelectionBoundaryResolver(host.view.state)(line.number);
    const startLine = host.view.state.doc.line(boundaryAtCursor.startLineNumber);
    const endLine = host.view.state.doc.line(boundaryAtCursor.endLineNumber);
    enterMobileSelectionModeFromBlock(host, {
        type: BlockType.Paragraph,
        startLine: boundaryAtCursor.startLineNumber - 1,
        endLine: boundaryAtCursor.endLineNumber - 1,
        from: startLine.from,
        to: endLine.to,
        indentLevel: 0,
        content: host.view.state.doc.sliceString(startLine.from, endLine.to),
    }, e);
}

export function enterMobileSelectionModeFromBlock(
    host: PointerInteractionHost,
    blockInfo: BlockInfo,
    e: Event
): void {
    if (!host.mobile.isMobileEnvironment()) return;
    if (!host.isMultiLineSelectionEnabled()) return;
    if (!host.canStartDragForPointer('touch', 'text')) return;
    if (host.pipelineState.type !== 'idle' && host.pipelineState.type !== 'holding' && host.pipelineState.type !== 'ready_to_drag') return;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

    if (e instanceof CustomEvent && e.detail && typeof e.detail === 'object') {
        (e.detail as { handled?: boolean }).handled = true;
    }
    const selection = host.resolveBlockSelection({ kind: 'block', block: blockInfo });
    if (!selection) return;

    host.dispatchPipeline({
        type: 'selection_start',
        seed: {
            selection,
            range: {
                type: 'range',
                doc: host.view.state.doc,
                blockInfo,
                selectedBlocks: [],
                operation: 'add',
            },
        },
        guardDeps: ['mobile-text-drag-mode'],
    });
    host.dispatchPipeline({ type: 'selection_finish' });
    host.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_SELECTION_PASSIVE, e.target);
}

function startMobileSelectionResize(
    host: PointerInteractionHost,
    e: PointerEvent,
    handle: 'top' | 'bottom'
): boolean {
    if (host.pipelineState.type !== 'selecting') return false;
    const selectedBlocks = selectedBlocksFromPipeline(host.pipelineState);
    if (selectedBlocks.length === 0) return false;
    const firstBlock = selectedBlocks[0];
    const lastBlock = selectedBlocks[selectedBlocks.length - 1];
    const fixedBoundary = buildMobileSelectionResizeBoundary(handle === 'top' ? lastBlock : firstBlock);
    const movingBoundary = buildMobileSelectionResizeBoundary(handle === 'top' ? firstBlock : lastBlock);
    const sourceSelection = host.pipelineState.selection.selection;
    host.dispatchPipeline({
        type: 'selection_start',
        seed: {
            selection: sourceSelection,
            range: {
                type: 'resize',
                doc: host.view.state.doc,
                selectedBlocks,
                fixedBoundary,
                movingBoundary,
                resolveBoundary: createRangeSelectionBoundaryResolver(host.view.state),
            },
        },
        guardDeps: ['mobile-text-drag-mode'],
    });
    host.rangePointerSession = createMobileResizeRangeSession({
        sourceSelection,
        selectedBlocks,
        movingBoundary,
        e,
    });
    return true;
}

function createMobileResizeRangeSession(options: {
    sourceSelection: BlockSelection;
    selectedBlocks: SelectedBlockRange[];
    movingBoundary: RangeSelectionBoundary;
    e: PointerEvent;
}): MouseRangeSelectState {
    const pointerType = options.e.pointerType || null;
    return {
        anchorBlock: options.sourceSelection.anchorBlock,
        sourceSelection: options.sourceSelection,
        baseSelectedBlocks: options.selectedBlocks,
        sourceKind: 'handle',
        pipelineStarted: true,
        selectionGestureStarted: true,
        pointerId: options.e.pointerId,
        startX: options.e.clientX,
        startY: options.e.clientY,
        latestX: options.e.clientX,
        latestY: options.e.clientY,
        pointerType,
        dragReady: false,
        longPressReady: true,
        isIntercepting: true,
        timeoutId: null,
        dragTimeoutId: null,
        currentLineNumber: options.movingBoundary.representativeLineNumber,
    };
}

function buildMobileSelectionResizeBoundary(block: SelectedBlockRange): RangeSelectionBoundary {
    return {
        startLineNumber: block.startLineNumber,
        endLineNumber: block.endLineNumber,
        representativeLineNumber: block.startLineNumber,
    };
}

export function exitMobileSelectionMode(host: PointerInteractionHost): void {
    if (!host.committedRangeSelection && host.pipelineState.type !== 'selecting') return;
    host.rangePointerSession = null;
    host.pointer.detachPointerListeners();
    host.pointer.releasePointerCapture();
    host.mobile.clearInputGuardMode();
    host.clearCommittedRangeSelection();
    if (host.pipelineState.type === 'selecting') {
        host.dispatchPipeline({ type: 'selection_clear' });
    }
}

function shouldStartMobilePressDrag(host: PointerInteractionHost, e: PointerEvent): boolean {
    if (host.pipelineState.type !== 'idle') return false;
    if (!host.mobile.isMobileEnvironment()) return false;
    return shouldStartMobilePressDragByInput(e);
}

function isMobileTextLongPressDragEnabled(host: PointerInteractionHost): boolean {
    if (!host.deps.isMobileTextLongPressDragEnabled) return true;
    return host.deps.isMobileTextLongPressDragEnabled();
}

function selectedBlocksFromPipeline(state: PipelineState): SelectedBlockRange[] {
    if (state.type !== 'selecting') return [];
    return selectedBlocksFromSelection(state.selection.selection);
}

function selectedBlocksFromSelection(selection: BlockSelection): SelectedBlockRange[] {
    return selection.ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));
}
