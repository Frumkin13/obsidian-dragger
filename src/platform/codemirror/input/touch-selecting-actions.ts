import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../../domain/block/block-types';
import type { BlockSelection, RangeSelectionOperation } from '../../../domain/selection/block-selection';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import { safePosAtCoords, resolveLineNumberFromPos } from '../../dom/element-probe';
import { TouchInteractionController } from './touch-interaction-controller';
import { PointerSessionController } from './pointer-session-controller';
import { RangeSelectionVisualManager } from '../preview/range-selection-visual-manager';
import {
    buildRangeSelectionBoundaryFromBlock,
    buildSelectedBlockRangeFromBlockInfo,
    type CommittedRangeSelection,
    type RangeSelectionBoundary,
} from '../../../domain/selection/range-selection';
import { resolveRangeBoundaryAtPoint } from './pointer-input';
import {
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    SelectedBlockRange,
} from '../../../domain/selection/block-ranges';
import { autoScrollEditorNearViewportEdge } from './pointer-input';
import { updateMouseRangeSelection } from './pointer-selecting-actions';
import type {
    InteractionState,
    MobileSelectionData,
    MobileSelectionResizeHandle,
    PointerTerminalMode,
} from './interaction-state';
import { shouldStartMobilePressDrag as shouldStartMobilePressDragByInput } from './pointer-input';
import { createRangeSelectionBoundaryResolver } from '../selection/block-boundary-resolver';
import type { BlockSelectionRequest } from '../selection/block-selection-resolver';
import {
    MOBILE_SELECTION_GESTURE_MODE,
    MOBILE_SELECTION_PASSIVE_MODE,
} from './touch-interaction-controller';
import {
    createBlockRangeSelectionState,
    updateBlockRangeSelectionState,
} from '../../../drag/selection/block-range-selection';

const MOBILE_DRAG_LONG_PRESS_MS = 200;
const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;
const MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX = 12;

export interface MobileSelectionActionDeps {
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMobileTextLongPressDragEnabled?: () => boolean;
}

export interface MobileSelectionActionHost {
    readonly view: EditorView;
    readonly deps: MobileSelectionActionDeps;
    readonly rangeVisual: RangeSelectionVisualManager;
    readonly mobile: TouchInteractionController;
    readonly pointer: PointerSessionController;
    gesture: InteractionState;
    committedRangeSelection: CommittedRangeSelection | null;

    resolveBlockSelection(request: BlockSelectionRequest): BlockSelection | null;
    buildCommittedSelectionSelectionRequest(): BlockSelectionRequest | null;
    buildMobileSelectionSelectionRequest(state: { selectedBlocks: SelectedBlockRange[]; activeMovingBoundary: RangeSelectionBoundary }): BlockSelectionRequest | null;

    beginRangeSelectionSession(
        source: BlockSelection,
        e: PointerEvent,
        handle: HTMLElement | null,
        options?: { skipLongPress?: boolean; initialOperation?: RangeSelectionOperation }
    ): void;
    beginPressPendingDrag(
        source: BlockSelection,
        e: PointerEvent,
        options?: { skipLongPress?: boolean; deferInterception?: boolean; mobileSelectionOnHold?: boolean }
    ): void;
    enterDraggingState(
        source: BlockSelection,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): void;
    tryStartCommittedSelectionDrag(e: PointerEvent, target: HTMLElement): boolean;
    clearCommittedRangeSelection(): void;
    emitPressPendingLifecycle(source: BlockSelection, pointerType: string | null, pressReady: boolean): void;
    emitIdleLifecycle(): void;
    isMultiLineSelectionEnabled(): boolean;
    canStartDragForPointer(pointerType: string | null): boolean;
    isMobileDragModeActiveForPointer(pointerType: string | null): boolean;
}

export function handleMobilePointerDown(
    host: MobileSelectionActionHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    if (tryStartMobileSelectionResize(host, e, target)) return true;
    if (tryStartMobileHandleInteraction(host, e, target)) return true;
    if (tryStartMobileSelectionDrag(host, target, e)) return true;
    if (isPassiveMobileSelectionActive(host)) return false;
    if (host.tryStartCommittedSelectionDrag(e, target)) return true;
    if (tryStartMobileTextLongPressDrag(host, e, target)) return true;
    return false;
}

function isPassiveMobileSelectionActive(host: MobileSelectionActionHost): boolean {
    return host.gesture.phase === 'selecting'
        && host.gesture.selection.mode === 'mobile'
        && host.gesture.selection.mobileSelect.activeInteraction === null;
}

function tryStartMobileSelectionResize(
    host: MobileSelectionActionHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return false;
    if (e.pointerType === 'mouse') return false;

    const handleEl = target.closest<HTMLElement>(`.${MOBILE_SELECTION_RESIZE_HANDLE_CLASS}`);
    if (!handleEl) return false;

    const rawHandle = handleEl.getAttribute('data-dnd-mobile-selection-handle');
    if (rawHandle !== 'top' && rawHandle !== 'bottom') return false;

    const state = host.gesture.selection.mobileSelect;
    state.activeInteraction = {
        type: 'resize',
        pointerId: e.pointerId,
    };
    startMobileSelectionResize(host, state, rawHandle);

    e.preventDefault();
    e.stopPropagation();
    host.pointer.tryCapturePointer(e);
    host.pointer.attachPointerListeners();
    host.mobile.applyDragInteractionMode(MOBILE_SELECTION_GESTURE_MODE, e.target);
    return true;
}

function tryStartMobileHandleInteraction(
    host: MobileSelectionActionHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    const handle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle || handle.classList.contains(EMBED_HANDLE_CLASS)) return false;

    if (tryStartMobileSelectionDrag(host, handle, e)) return true;
    if (tryStartMobileSelectionRangeFromHandle(host, handle, e)) return true;
    if (tryRetargetActiveMobileRangeSelectionFromHandle(host, handle, e)) return true;

    const source = host.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return true;
    const blockInfo = source.anchorBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return true;
    if (!host.canStartDragForPointer(e.pointerType || null)) return false;

    if (host.isMultiLineSelectionEnabled() && host.committedRangeSelection) {
        host.beginRangeSelectionSession(source, e, handle, { skipLongPress: true });
        return true;
    }

    host.beginPressPendingDrag(source, e);
    return true;
}

function tryStartMobileSelectionRangeFromHandle(
    host: MobileSelectionActionHost,
    handle: HTMLElement,
    e: PointerEvent
): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return false;
    if (e.pointerType === 'mouse') return false;
    if (targetIsInsideMobileSelection(handle)) return false;

    const source = host.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return false;
    const blockInfo = source.anchorBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return false;

    const state = host.gesture.selection.mobileSelect;
    const selectionState = createBlockRangeSelectionState({
        doc: host.view.state.doc,
        blockInfo,
        selectedBlocks: state.selectedBlocks,
        operation: 'add',
    });
    if (!selectionState) return false;
    state.activeInteraction = {
        type: 'resize',
        pointerId: e.pointerId,
    };
    state.activeFixedBoundary = buildRangeSelectionBoundaryFromBlock(host.view.state.doc, blockInfo);
    state.activeMovingBoundary = state.activeFixedBoundary;
    state.activeRangeBlocks = selectionState.activeBlocks;
    state.selectedBlocks = selectionState.selectionBlocks;
    host.committedRangeSelection = buildCommittedSelectionFromBlocks(host, state.selectedBlocks, blockInfo);
    renderMobileSelection(host, state.selectedBlocks);

    e.preventDefault();
    e.stopPropagation();
    host.pointer.tryCapturePointer(e);
    host.pointer.attachPointerListeners();
    host.mobile.applyDragInteractionMode(MOBILE_SELECTION_GESTURE_MODE, e.target);
    return true;
}

function tryStartMobileSelectionDrag(
    host: MobileSelectionActionHost,
    target: HTMLElement,
    e: PointerEvent
): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return false;
    if (e.pointerType === 'mouse') return false;
    if (!targetIsInsideMobileSelection(target)) return false;

    const committedRequest = host.buildCommittedSelectionSelectionRequest();
    const source = committedRequest ? host.resolveBlockSelection(committedRequest) : null;
    if (!source) return false;

    const state = host.gesture.selection.mobileSelect;
    const timeoutId = window.setTimeout(() => {
        if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return;
        const interaction = host.gesture.selection.mobileSelect.activeInteraction;
        if (!interaction || interaction.type !== 'drag') return;
        if (interaction.pointerId !== e.pointerId) return;
        interaction.longPressReady = true;
        host.emitPressPendingLifecycle(interaction.selection, e.pointerType || null, true);
    }, MOBILE_DRAG_LONG_PRESS_MS);
    state.activeInteraction = {
        type: 'drag',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        selection: source,
        longPressReady: false,
        timeoutId,
    };
    e.preventDefault();
    e.stopPropagation();
    host.pointer.tryCapturePointer(e);
    host.pointer.attachPointerListeners();
    host.mobile.applyDragInteractionMode(MOBILE_SELECTION_GESTURE_MODE, e.target);
    return true;
}

function tryRetargetActiveMobileRangeSelectionFromHandle(
    host: MobileSelectionActionHost,
    handle: HTMLElement,
    e: PointerEvent
): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'range')) return false;
    const state = host.gesture.selection.rangeSelect;
    if (state.pointerType === 'mouse') return false;
    if (e.pointerType === 'mouse') return false;

    const source = host.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return false;
    const blockInfo = source.anchorBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return false;

    retargetMobileRangeSelection(host, e);
    updateMouseRangeSelection(
        host,
        state,
        buildRangeSelectionBoundaryFromBlock(host.view.state.doc, blockInfo)
    );
    return true;
}

function tryStartMobileTextLongPressDrag(
    host: MobileSelectionActionHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    if (!shouldStartMobilePressDrag(host, e)) return false;
    if (!host.canStartDragForPointer(e.pointerType || null)) return false;
    const shouldSuppressInput = host.isMobileDragModeActiveForPointer(e.pointerType || null);

    const inTextLineOrEmbedArea = isMobileTextLongPressDragEnabled(host)
        && host.mobile.isWithinMobileTextLineOrEmbedArea(target, e.clientX, e.clientY);
    if (!inTextLineOrEmbedArea) return false;

    const source = host.resolveBlockSelection({ kind: 'point', clientX: e.clientX, clientY: e.clientY });
    if (!source) return false;
    const blockInfo = source.anchorBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return false;

    host.beginPressPendingDrag(source, e, shouldSuppressInput
        ? (host.isMultiLineSelectionEnabled() ? { mobileSelectionOnHold: true } : undefined)
        : { deferInterception: true });
    return true;
}

function targetIsInsideMobileSelection(target: HTMLElement): boolean {
    return !!target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
}

export function handleMobileSelectingPointerMove(host: MobileSelectionActionHost, e: PointerEvent): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return;
    const state = host.gesture.selection.mobileSelect;
    const interaction = state.activeInteraction;
    if (!interaction || e.pointerId !== interaction.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    if (interaction.type === 'drag') {
        const distance = Math.hypot(e.clientX - interaction.startX, e.clientY - interaction.startY);
        if (!interaction.longPressReady) {
            if (distance > MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX) {
                clearMobileSelectionInteraction(state);
                finishNativeMobileSelectionSession(host);
            }
            return;
        }
        if (distance < MOBILE_DRAG_START_MOVE_THRESHOLD_PX) return;
        const source = interaction.selection;
        clearMobileSelectionInteraction(state);
        host.committedRangeSelection = buildCommittedSelectionFromBlocks(
            host,
            state.selectedBlocks,
            source.anchorBlock
        );
        host.enterDraggingState(source, interaction.pointerId, e.clientX, e.clientY, e.pointerType || null);
        return;
    }

    const targetBoundary = resolveMobileSelectionBoundaryAtPoint(host, e.clientX, e.clientY);
    if (!targetBoundary) return;
    updateMobileSelectionResize(host, state, targetBoundary);
    autoScrollEditorNearViewportEdge(host.view, e.clientY);
}

export function finishMobileSelectionPointer(
    host: MobileSelectionActionHost,
    e: PointerEvent,
    mode: PointerTerminalMode
): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return;
    const state = host.gesture.selection.mobileSelect;
    const interaction = state.activeInteraction;
    if (!interaction || e.pointerId !== interaction.pointerId) return;
    if (mode === 'up') {
        e.preventDefault();
        e.stopPropagation();
    }
    clearMobileSelectionInteraction(state);
    finishNativeMobileSelectionSession(host);
    if (!hasMobileSelection(host)) {
        exitMobileSelectionMode(host);
    }
}

export function enterMobileSelectionMode(host: MobileSelectionActionHost, e: Event): void {
    if (!host.mobile.isMobileEnvironment()) return;
    if (!host.isMultiLineSelectionEnabled()) return;
    if (host.gesture.phase !== 'idle') return;

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
    host: MobileSelectionActionHost,
    blockInfo: BlockInfo,
    e: Event
): void {
    if (!host.mobile.isMobileEnvironment()) return;
    if (!host.isMultiLineSelectionEnabled()) return;
    if (!host.canStartDragForPointer('touch')) return;
    if (host.gesture.phase !== 'idle' && host.gesture.phase !== 'press_pending') return;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

    if (e instanceof CustomEvent && e.detail && typeof e.detail === 'object') {
        (e.detail as { handled?: boolean }).handled = true;
    }
    const boundary = buildRangeSelectionBoundaryFromBlock(host.view.state.doc, blockInfo);
    const selectedBlock = buildSelectedBlockRangeFromBlockInfo(blockInfo);
    host.committedRangeSelection = buildCommittedSelectionFromBlocks(host, [selectedBlock], blockInfo);
    host.gesture = {
        phase: 'selecting',
        selection: { mode: 'mobile', mobileSelect: {
            selectedBlocks: [selectedBlock],
            activeFixedBoundary: boundary,
            activeMovingBoundary: boundary,
            activeRangeBlocks: [selectedBlock],
            activeInteraction: null,
        } },
    };
    renderMobileSelection(host, [selectedBlock]);
    host.mobile.applyDragInteractionMode(MOBILE_SELECTION_PASSIVE_MODE, e.target);
    const source = host.buildMobileSelectionSelectionRequest({ selectedBlocks: [selectedBlock], activeMovingBoundary: boundary });
    const pressSource = source ? host.resolveBlockSelection(source) : null;
    if (pressSource) host.emitPressPendingLifecycle(pressSource, 'touch', true);
}

export function getMobileSelectionTemplateBlock(
    host: MobileSelectionActionHost,
    state: { activeMovingBoundary: RangeSelectionBoundary }
): BlockInfo {
    const line = host.view.state.doc.line(state.activeMovingBoundary.representativeLineNumber);
    return host.resolveBlockSelection({ kind: 'point', clientX: 0, clientY: resolveLineClientY(host, line.number) })?.anchorBlock
        ?? {
            type: BlockType.Paragraph,
            startLine: line.number - 1,
            endLine: line.number - 1,
            from: line.from,
            to: line.to,
            indentLevel: 0,
            content: line.text,
        };
}

function startMobileSelectionResize(
    host: MobileSelectionActionHost,
    state: MobileSelectionData,
    handle: MobileSelectionResizeHandle
): void {
    const selectedBlocks = mergeSelectedBlocks(host.view.state.doc.lines, state.selectedBlocks);
    if (selectedBlocks.length === 0) return;
    const firstBlock = selectedBlocks[0];
    const lastBlock = selectedBlocks[selectedBlocks.length - 1];
    state.activeRangeBlocks = selectedBlocks;
    state.activeFixedBoundary = buildMobileSelectionResizeBoundary(handle === 'top' ? lastBlock : firstBlock);
    state.activeMovingBoundary = buildMobileSelectionResizeBoundary(handle === 'top' ? firstBlock : lastBlock);
}

function updateMobileSelectionResize(
    host: MobileSelectionActionHost,
    state: MobileSelectionData,
    movingBoundary: RangeSelectionBoundary
): void {
    const baseBlocks = subtractSelectedBlocks(host.view.state.doc.lines, state.selectedBlocks, state.activeRangeBlocks);
    const next = updateBlockRangeSelectionState({
        anchorStartLineNumber: state.activeFixedBoundary.startLineNumber,
        anchorEndLineNumber: state.activeFixedBoundary.endLineNumber,
        operation: 'add',
        baseBlocks,
    }, {
        docLines: host.view.state.doc.lines,
        target: movingBoundary,
        resolveBoundary: createRangeSelectionBoundaryResolver(host.view.state),
    });
    state.activeMovingBoundary = movingBoundary;
    state.activeRangeBlocks = next.activeBlocks;
    state.selectedBlocks = next.selectionBlocks;
    host.committedRangeSelection = buildCommittedSelectionFromBlocks(host, state.selectedBlocks, getMobileSelectionTemplateBlock(host, state));
    renderMobileSelection(host, state.selectedBlocks);
}

function buildMobileSelectionResizeBoundary(block: SelectedBlockRange): RangeSelectionBoundary {
    return {
        startLineNumber: block.startLineNumber,
        endLineNumber: block.endLineNumber,
        representativeLineNumber: block.startLineNumber,
    };
}

function finishNativeMobileSelectionSession(host: MobileSelectionActionHost): void {
    host.pointer.detachPointerListeners();
    host.pointer.releasePointerCapture();
    host.mobile.applyDragInteractionMode(MOBILE_SELECTION_PASSIVE_MODE);
}

export function exitMobileSelectionMode(host: MobileSelectionActionHost): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return;
    clearMobileSelectionInteraction(host.gesture.selection.mobileSelect);
    host.pointer.detachPointerListeners();
    host.pointer.releasePointerCapture();
    host.mobile.clearDragInteractionMode();
    host.gesture = { phase: 'idle' };
    host.clearCommittedRangeSelection();
    host.emitIdleLifecycle();
}

function clearMobileSelectionInteraction(state: MobileSelectionData): void {
    const interaction = state.activeInteraction;
    if (interaction?.type === 'drag' && interaction.timeoutId !== null) {
        window.clearTimeout(interaction.timeoutId);
    }
    state.activeInteraction = null;
}

function hasMobileSelection(host: MobileSelectionActionHost): boolean {
    return host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile'
        && host.gesture.selection.mobileSelect.selectedBlocks.length > 0;
}

function resolveMobileSelectionBoundaryAtPoint(
    host: MobileSelectionActionHost,
    clientX: number,
    clientY: number
): RangeSelectionBoundary | null {
    const contentRect = host.view.contentDOM.getBoundingClientRect();
    const probeXs = resolveMobileSelectionProbeXs(clientX, contentRect);
    for (const probeX of probeXs) {
        const lineNumber = resolveLineNumberAtMobileSelectionPoint(host, probeX, clientY, contentRect);
        if (lineNumber === null) continue;
        const boundary = createRangeSelectionBoundaryResolver(host.view.state)(lineNumber);
        return {
            startLineNumber: boundary.startLineNumber,
            endLineNumber: boundary.endLineNumber,
            representativeLineNumber: lineNumber,
        };
    }

    for (const probeX of probeXs) {
        const boundary = resolveRangeBoundaryAtPoint(
            host.view,
            probeX,
            clientY,
            (x, y) => host.resolveBlockSelection({ kind: 'point', clientX: x, clientY: y })?.anchorBlock ?? null
        );
        if (boundary) return boundary;
    }
    return null;
}

function resolveMobileSelectionProbeXs(clientX: number, contentRect: DOMRect): number[] {
    const values = [clientX];
    if (Number.isFinite(contentRect.left) && Number.isFinite(contentRect.right) && contentRect.right > contentRect.left) {
        values.push((contentRect.left + contentRect.right) / 2);
        values.push(contentRect.left + Math.min(48, Math.max(8, (contentRect.right - contentRect.left) * 0.12)));
    }
    return [...new Set(values.map((value) => Math.round(value)))];
}

function resolveLineNumberAtMobileSelectionPoint(
    host: MobileSelectionActionHost,
    clientX: number,
    clientY: number,
    contentRect: DOMRect
): number | null {
    if (Number.isFinite(contentRect.left) && Number.isFinite(contentRect.right) && contentRect.right > contentRect.left) {
        const x = Math.max(contentRect.left + 2, Math.min(contentRect.right - 2, clientX));
        const pos = safePosAtCoords(host.view, { x, y: clientY });
        if (pos !== null) return resolveLineNumberFromPos(host.view, pos);
    }
    const secondaryPos = safePosAtCoords(host.view, { x: clientX, y: clientY });
    return secondaryPos === null ? null : resolveLineNumberFromPos(host.view, secondaryPos);
}

function buildCommittedSelectionFromBlocks(
    host: MobileSelectionActionHost,
    blocks: SelectedBlockRange[],
    template: BlockInfo
): CommittedRangeSelection | null {
    const selectedBlocks = mergeSelectedBlocks(host.view.state.doc.lines, blocks);
    if (selectedBlocks.length === 0) return null;
    return {
        blocks: selectedBlocks,
        templateBlock: template,
    };
}

function renderMobileSelection(host: MobileSelectionActionHost, blocks: SelectedBlockRange[]): void {
    host.rangeVisual.render(blocks, { showSourceOutline: true, showMobileResizeHandles: true });
}

function retargetMobileRangeSelection(host: MobileSelectionActionHost, e: PointerEvent): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'range')) return;
    const state = host.gesture.selection.rangeSelect;
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
    host.pointer.tryCapturePointer(e);
}

function shouldStartMobilePressDrag(host: MobileSelectionActionHost, e: PointerEvent): boolean {
    if (host.gesture.phase !== 'idle') return false;
    if (!host.mobile.isMobileEnvironment()) return false;
    return shouldStartMobilePressDragByInput(e);
}

function isMobileTextLongPressDragEnabled(host: MobileSelectionActionHost): boolean {
    if (!host.deps.isMobileTextLongPressDragEnabled) return true;
    return host.deps.isMobileTextLongPressDragEnabled();
}

function resolveLineClientY(host: MobileSelectionActionHost, lineNumber: number): number {
    const line = host.view.state.doc.line(Math.max(1, Math.min(host.view.state.doc.lines, lineNumber)));
    const coords = host.view.coordsAtPos(line.from, 1);
    return coords ? ((coords.top + coords.bottom) / 2) : 0;
}
