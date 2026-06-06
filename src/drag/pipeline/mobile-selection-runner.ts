import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../domain/block/block-types';
import { DragSource } from '../../shared/types/drag';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_CLASS,
} from '../../shared/dom-selectors';
import { safePosAtCoords, resolveLineNumberFromPos } from '../../platform/dom/element-probe';
import type { DragEventHandlerDeps } from './drag-controller';
import { MobileGestureController } from '../state/mobile-gesture-controller';
import { PointerSessionController } from '../input/pointer-session-controller';
import { RangeSelectionVisualManager } from '../state/selection/selection-visual-manager';
import {
    buildRangeSelectionBoundaryFromBlock,
    collectSelectedBlocksBetween,
    CommittedRangeSelection,
    RangeSelectionBoundary,
    RangeSelectionOperation,
    resolveBlockBoundaryAtLine,
} from '../state/selection/selection-model';
import { resolveRangeBoundaryAtPoint } from '../state/selection/hit-boundary';
import {
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    SelectedBlockRange,
    subtractSelectedBlocks,
} from '../state/selection/block-selection';
import {
    autoScrollSelectionRange as autoScrollSelectionRangeByFlow,
    updateSelectionFromBoundary as updateSelectionFromBoundaryByFlow,
} from '../state/selection/selection-flow';
import {
    InteractionState,
    MobileSelectionData,
    MobileSelectionResizeHandle,
    PointerTerminalMode,
} from '../state/drag-state';
import { shouldStartMobilePressDrag as shouldStartMobilePressDragByFlow } from '../intent/drag-pointer-flow';
import type { DragSourceRequest } from '../source';

const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;

export interface MobileGesturePipelineHost {
    readonly view: EditorView;
    readonly deps: DragEventHandlerDeps;
    readonly rangeVisual: RangeSelectionVisualManager;
    readonly mobile: MobileGestureController;
    readonly pointer: PointerSessionController;
    gesture: InteractionState;
    committedRangeSelection: CommittedRangeSelection | null;

    resolveDragSource(request: DragSourceRequest): DragSource | null;
    buildCommittedSelectionSourceRequest(): DragSourceRequest | null;
    buildMobileSelectionSourceRequest(state: { selectedBlocks: SelectedBlockRange[]; activeMovingBoundary: RangeSelectionBoundary }): DragSourceRequest | null;

    beginRangeSelectionSession(
        source: DragSource,
        e: PointerEvent,
        handle: HTMLElement | null,
        options?: { skipLongPress?: boolean; initialOperation?: RangeSelectionOperation }
    ): void;
    beginPressPendingDrag(
        source: DragSource,
        e: PointerEvent,
        options?: { skipLongPress?: boolean; deferInterception?: boolean }
    ): void;
    enterDraggingState(
        source: DragSource,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): void;
    tryStartCommittedSelectionDrag(e: PointerEvent, target: HTMLElement): boolean;
    clearCommittedRangeSelection(): void;
    emitPressPendingLifecycle(source: DragSource, pointerType: string | null, pressReady: boolean): void;
    emitIdleLifecycle(): void;
    isMultiLineSelectionEnabled(): boolean;
}

export function runMobilePointerDownPipeline(
    host: MobileGesturePipelineHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    if (tryStartMobileSelectionResize(host, e, target)) return true;
    if (tryStartMobileHandleInteraction(host, e, target)) return true;
    if (tryHandleActiveMobileSelection(host, e)) return true;
    if (host.tryStartCommittedSelectionDrag(e, target)) return true;
    if (tryStartMobileTextLongPressDrag(host, e, target)) return true;
    return false;
}

function tryStartMobileSelectionResize(
    host: MobileGesturePipelineHost,
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
    host.mobile.lockMobileInteraction();
    host.mobile.attachFocusGuard();
    host.mobile.suppressMobileKeyboard(e.target);
    return true;
}

function tryStartMobileHandleInteraction(
    host: MobileGesturePipelineHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    const handle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle || handle.classList.contains(EMBED_HANDLE_CLASS)) return false;

    if (tryStartMobileSelectionDrag(host, handle, e)) return true;
    if (tryRetargetActiveMobileRangeSelectionFromHandle(host, handle, e)) return true;

    const source = host.resolveDragSource({ kind: 'handle', handle });
    if (!source) return true;
    const blockInfo = source.primaryBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return true;

    if (host.isMultiLineSelectionEnabled() && host.committedRangeSelection) {
        host.beginRangeSelectionSession(source, e, handle, { skipLongPress: true });
        return true;
    }

    host.beginPressPendingDrag(source, e);
    return true;
}

function tryStartMobileSelectionDrag(
    host: MobileGesturePipelineHost,
    handleEl: HTMLElement,
    e: PointerEvent
): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return false;
    if (e.pointerType === 'mouse') return false;
    if (!handleEl.classList.contains('dnd-range-selected-handle')) return false;

    const committedRequest = host.buildCommittedSelectionSourceRequest();
    const source = committedRequest ? host.resolveDragSource(committedRequest) : null;
    if (!source) return false;

    const state = host.gesture.selection.mobileSelect;
    state.activeInteraction = {
        type: 'drag',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        source,
    };
    e.preventDefault();
    e.stopPropagation();
    host.pointer.tryCapturePointer(e);
    host.pointer.attachPointerListeners();
    host.mobile.lockMobileInteraction();
    host.mobile.attachFocusGuard();
    host.mobile.suppressMobileKeyboard(e.target);
    return true;
}

function tryRetargetActiveMobileRangeSelectionFromHandle(
    host: MobileGesturePipelineHost,
    handle: HTMLElement,
    e: PointerEvent
): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'range')) return false;
    const state = host.gesture.selection.rangeSelect;
    if (state.pointerType === 'mouse') return false;
    if (e.pointerType === 'mouse') return false;

    const source = host.resolveDragSource({ kind: 'handle', handle });
    if (!source) return false;
    const blockInfo = source.primaryBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return false;

    retargetMobileRangeSelection(host, e);
    updateSelectionFromBoundaryByFlow(
        host.view,
        state,
        buildRangeSelectionBoundaryFromBlock(host.view.state.doc, blockInfo),
        host.rangeVisual
    );
    state.selectionGestureStarted = true;
    return true;
}

function tryHandleActiveMobileSelection(host: MobileGesturePipelineHost, e: PointerEvent): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return false;
    handleMobileSelectionTextPointerDown(host, e);
    return true;
}

function tryStartMobileTextLongPressDrag(
    host: MobileGesturePipelineHost,
    e: PointerEvent,
    target: HTMLElement
): boolean {
    if (!shouldStartMobilePressDrag(host, e)) return false;

    if (shouldDismissMobileEditorInputStateForPointerDown(host, target)) {
        dismissMobileEditorInputState(host);
    }

    const inTextLineOrEmbedArea = isMobileTextLongPressDragEnabled(host)
        && host.mobile.isWithinMobileTextLineOrEmbedArea(target, e.clientX, e.clientY);
    if (!inTextLineOrEmbedArea) return false;

    const source = host.resolveDragSource({ kind: 'point', clientX: e.clientX, clientY: e.clientY });
    if (!source) return false;
    const blockInfo = source.primaryBlock;
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return false;

    // Keep native tap-to-focus behavior in text/embed areas.
    host.beginPressPendingDrag(source, e, { deferInterception: true });
    return true;
}

export function handleMobileSelectingPointerMove(host: MobileGesturePipelineHost, e: PointerEvent): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return;
    const state = host.gesture.selection.mobileSelect;
    const interaction = state.activeInteraction;
    if (!interaction || e.pointerId !== interaction.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    if (interaction.type === 'drag') {
        const distance = Math.hypot(e.clientX - interaction.startX, e.clientY - interaction.startY);
        if (distance < MOBILE_DRAG_START_MOVE_THRESHOLD_PX) return;

        const source = interaction.source;
        state.activeInteraction = null;
        host.committedRangeSelection = buildCommittedSelectionFromBlocks(
            host,
            state.selectedBlocks,
            source.primaryBlock
        );
        host.enterDraggingState(source, interaction.pointerId, e.clientX, e.clientY, e.pointerType || null);
        return;
    }

    const targetBoundary = resolveMobileSelectionBoundaryAtPoint(host, e.clientX, e.clientY);
    if (!targetBoundary) return;
    updateMobileSelectionResize(host, state, targetBoundary);
    autoScrollSelectionRangeByFlow(host.view, e.clientY);
}

export function finishMobileSelectionPointer(
    host: MobileGesturePipelineHost,
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
    state.activeInteraction = null;
    host.pointer.releasePointerCapture();
    if (!hasMobileSelection(host)) {
        exitMobileSelectionMode(host);
    }
}

export function enterMobileSelectionMode(host: MobileGesturePipelineHost, e: Event): void {
    if (!host.mobile.isMobileEnvironment()) return;
    if (!host.isMultiLineSelectionEnabled()) return;
    if (host.gesture.phase !== 'idle') return;

    const line = host.view.state.doc.lineAt(host.view.state.selection.main.head);
    const boundaryAtCursor = resolveBlockBoundaryAtLine(host.view.state, line.number);
    const startLine = host.view.state.doc.line(boundaryAtCursor.startLineNumber);
    const endLine = host.view.state.doc.line(boundaryAtCursor.endLineNumber);
    const blockInfo = {
        type: BlockType.Paragraph,
        startLine: boundaryAtCursor.startLineNumber - 1,
        endLine: boundaryAtCursor.endLineNumber - 1,
        from: startLine.from,
        to: endLine.to,
        indentLevel: 0,
        content: host.view.state.doc.sliceString(startLine.from, endLine.to),
    };
    if (host.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

    if (e instanceof CustomEvent && e.detail && typeof e.detail === 'object') {
        (e.detail as { handled?: boolean }).handled = true;
    }
    const boundary = buildRangeSelectionBoundaryFromBlock(host.view.state.doc, blockInfo);
    const selectedBlock = {
        startLineNumber: boundary.startLineNumber,
        endLineNumber: boundary.endLineNumber,
    };
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
    host.mobile.lockMobileInteraction();
    host.mobile.attachFocusGuard();
    host.mobile.suppressMobileKeyboard(document.activeElement);
    const source = host.buildMobileSelectionSourceRequest({ selectedBlocks: [selectedBlock], activeMovingBoundary: boundary });
    const pressSource = source ? host.resolveDragSource(source) : null;
    if (pressSource) host.emitPressPendingLifecycle(pressSource, 'touch', true);
}

export function getMobileSelectionTemplateBlock(
    host: MobileGesturePipelineHost,
    state: { activeMovingBoundary: RangeSelectionBoundary }
): BlockInfo {
    const line = host.view.state.doc.line(state.activeMovingBoundary.representativeLineNumber);
    return host.resolveDragSource({ kind: 'point', clientX: 0, clientY: resolveLineClientY(host, line.number) })?.primaryBlock
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

function handleMobileSelectionTextPointerDown(host: MobileGesturePipelineHost, e: PointerEvent): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return false;
    const state = host.gesture.selection.mobileSelect;
    const source = host.resolveDragSource({ kind: 'point', clientX: e.clientX, clientY: e.clientY });
    const blockInfo = source?.primaryBlock ?? null;
    e.preventDefault();
    e.stopPropagation();

    if (!blockInfo || host.deps.isBlockInsideRenderedTableCell(blockInfo)) {
        exitMobileSelectionMode(host);
        return true;
    }

    const boundary = buildRangeSelectionBoundaryFromBlock(host.view.state.doc, blockInfo);
    const blockRange = {
        startLineNumber: boundary.startLineNumber,
        endLineNumber: boundary.endLineNumber,
    };
    const nextBlocks = isSelectedBlockCoveredByBlocks(host.view.state.doc.lines, blockRange, state.selectedBlocks)
        ? subtractSelectedBlocks(host.view.state.doc.lines, state.selectedBlocks, [blockRange])
        : mergeSelectedBlocks(host.view.state.doc.lines, [...state.selectedBlocks, blockRange]);

    if (nextBlocks.length === 0) {
        exitMobileSelectionMode(host);
        return true;
    }

    state.selectedBlocks = nextBlocks;
    state.activeFixedBoundary = boundary;
    state.activeMovingBoundary = boundary;
    state.activeRangeBlocks = [blockRange];
    host.committedRangeSelection = buildCommittedSelectionFromBlocks(host, state.selectedBlocks, blockInfo);
    renderMobileSelection(host, state.selectedBlocks);
    return true;
}

function startMobileSelectionResize(
    host: MobileGesturePipelineHost,
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
    host: MobileGesturePipelineHost,
    state: MobileSelectionData,
    movingBoundary: RangeSelectionBoundary
): void {
    const activeBlocks = collectSelectedBlocksBetween(
        host.view.state,
        state.activeFixedBoundary.startLineNumber,
        state.activeFixedBoundary.endLineNumber,
        movingBoundary.startLineNumber,
        movingBoundary.endLineNumber
    );
    const baseBlocks = removeActiveMobileSelectionBlocks(state.selectedBlocks, state.activeRangeBlocks);
    state.activeMovingBoundary = movingBoundary;
    state.activeRangeBlocks = activeBlocks;
    state.selectedBlocks = mergeSelectedBlocks(host.view.state.doc.lines, [...baseBlocks, ...activeBlocks]);
    host.committedRangeSelection = buildCommittedSelectionFromBlocks(host, state.selectedBlocks, getMobileSelectionTemplateBlock(host, state));
    renderMobileSelection(host, state.selectedBlocks);
}

function removeActiveMobileSelectionBlocks(
    selectedBlocks: SelectedBlockRange[],
    activeRangeBlocks: SelectedBlockRange[]
): SelectedBlockRange[] {
    return selectedBlocks.filter((block) => !activeRangeBlocks.some((active) => (
        active.startLineNumber === block.startLineNumber
        && active.endLineNumber === block.endLineNumber
    )));
}

function buildMobileSelectionResizeBoundary(block: SelectedBlockRange): RangeSelectionBoundary {
    return {
        startLineNumber: block.startLineNumber,
        endLineNumber: block.endLineNumber,
        representativeLineNumber: block.startLineNumber,
    };
}

function finishNativeMobileSelectionSession(host: MobileGesturePipelineHost): void {
    host.pointer.detachPointerListeners();
    host.pointer.releasePointerCapture();
    host.mobile.unlockMobileInteraction();
    host.mobile.detachFocusGuard();
}

function exitMobileSelectionMode(host: MobileGesturePipelineHost): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return;
    host.gesture.selection.mobileSelect.activeInteraction = null;
    finishNativeMobileSelectionSession(host);
    host.gesture = { phase: 'idle' };
    host.clearCommittedRangeSelection();
    host.emitIdleLifecycle();
}

function hasMobileSelection(host: MobileGesturePipelineHost): boolean {
    return host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile'
        && host.gesture.selection.mobileSelect.selectedBlocks.length > 0;
}

function resolveMobileSelectionBoundaryAtPoint(
    host: MobileGesturePipelineHost,
    clientX: number,
    clientY: number
): RangeSelectionBoundary | null {
    const contentRect = host.view.contentDOM.getBoundingClientRect();
    const probeXs = resolveMobileSelectionProbeXs(clientX, contentRect);
    for (const probeX of probeXs) {
        const lineNumber = resolveLineNumberAtMobileSelectionPoint(host, probeX, clientY, contentRect);
        if (lineNumber === null) continue;
        const boundary = resolveBlockBoundaryAtLine(host.view.state, lineNumber);
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
            (x, y) => host.resolveDragSource({ kind: 'point', clientX: x, clientY: y })?.primaryBlock ?? null
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
    host: MobileGesturePipelineHost,
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
    host: MobileGesturePipelineHost,
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

function renderMobileSelection(host: MobileGesturePipelineHost, blocks: SelectedBlockRange[]): void {
    host.rangeVisual.render(blocks, { highlightLines: true, showMobileResizeHandles: true });
}

function retargetMobileRangeSelection(host: MobileGesturePipelineHost, e: PointerEvent): void {
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

function shouldStartMobilePressDrag(host: MobileGesturePipelineHost, e: PointerEvent): boolean {
    if (host.gesture.phase !== 'idle') return false;
    if (!host.mobile.isMobileEnvironment()) return false;
    return shouldStartMobilePressDragByFlow(e);
}

function shouldDismissMobileEditorInputStateForPointerDown(
    host: MobileGesturePipelineHost,
    target: HTMLElement | null
): boolean {
    if (!shouldDisableMobileTextLongPressDragInInputState(host)) return false;
    if (!target) return true;
    return host.view.dom.contains(target);
}

function shouldDisableMobileTextLongPressDragInInputState(host: MobileGesturePipelineHost): boolean {
    if (!host.view.hasFocus) return false;
    return host.view.state.selection.main.empty;
}

function dismissMobileEditorInputState(host: MobileGesturePipelineHost): void {
    if (!host.view.hasFocus) return;
    host.view.contentDOM.blur();
}

function isMobileTextLongPressDragEnabled(host: MobileGesturePipelineHost): boolean {
    if (!host.deps.isMobileTextLongPressDragEnabled) return true;
    return host.deps.isMobileTextLongPressDragEnabled();
}

function resolveLineClientY(host: MobileGesturePipelineHost, lineNumber: number): number {
    const line = host.view.state.doc.line(Math.max(1, Math.min(host.view.state.doc.lines, lineNumber)));
    const coords = host.view.coordsAtPos(line.from, 1);
    return coords ? ((coords.top + coords.bottom) / 2) : 0;
}
