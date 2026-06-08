import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../../domain/block/block-types';
import type { BlockSelection, RangeSelectionOperation } from '../../../domain/selection/block-selection';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import { safePosAtCoords, resolveLineNumberFromPos } from '../../dom/element-probe';
import { TouchInteractionController } from './touch-interaction-controller';
import { PointerSessionController } from './pointer-session-controller';
import { RangeSelectionVisualManager } from '../preview/range-selection-visual-manager';
import {
    buildRangeSelectionBoundaryFromBlock,
    collectSelectedBlocksBetween,
    type CommittedRangeSelection,
    type RangeSelectionBoundary,
} from '../../../domain/selection/range-selection';
import { resolveRangeBoundaryAtPoint } from './pointer-input';
import {
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    SelectedBlockRange,
    subtractSelectedBlocks,
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

const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;

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
    if (tryHandleActiveMobileSelection(host, e)) return true;
    if (host.tryStartCommittedSelectionDrag(e, target)) return true;
    if (tryStartMobileTextLongPressDrag(host, e, target)) return true;
    return false;
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
    host.mobile.lockMobileInteraction();
    host.mobile.attachFocusGuard();
    host.mobile.suppressMobileKeyboard(e.target);
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

function tryStartMobileSelectionDrag(
    host: MobileSelectionActionHost,
    handleEl: HTMLElement,
    e: PointerEvent
): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return false;
    if (e.pointerType === 'mouse') return false;
    if (!handleEl.classList.contains('dnd-range-selected-handle')) return false;
    if (!host.canStartDragForPointer(e.pointerType || null)) return false;

    const committedRequest = host.buildCommittedSelectionSelectionRequest();
    const source = committedRequest ? host.resolveBlockSelection(committedRequest) : null;
    if (!source) return false;

    const state = host.gesture.selection.mobileSelect;
    state.activeInteraction = {
        type: 'drag',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        selection: source,
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

function tryHandleActiveMobileSelection(host: MobileSelectionActionHost, e: PointerEvent): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return false;
    handleMobileSelectionTextPointerDown(host, e);
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

export function handleMobileSelectingPointerMove(host: MobileSelectionActionHost, e: PointerEvent): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return;
    const state = host.gesture.selection.mobileSelect;
    const interaction = state.activeInteraction;
    if (!interaction || e.pointerId !== interaction.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    if (interaction.type === 'drag') {
        const distance = Math.hypot(e.clientX - interaction.startX, e.clientY - interaction.startY);
        if (distance < MOBILE_DRAG_START_MOVE_THRESHOLD_PX) return;
        if (!host.canStartDragForPointer(e.pointerType || null)) return;

        const source = interaction.selection;
        state.activeInteraction = null;
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
    state.activeInteraction = null;
    host.pointer.releasePointerCapture();
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
    if (host.gesture.phase !== 'idle' && host.gesture.phase !== 'press_pending') return;
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

function handleMobileSelectionTextPointerDown(host: MobileSelectionActionHost, e: PointerEvent): boolean {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return false;
    const state = host.gesture.selection.mobileSelect;
    const source = host.resolveBlockSelection({ kind: 'point', clientX: e.clientX, clientY: e.clientY });
    const blockInfo = source?.anchorBlock ?? null;
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
    const activeBlocks = collectSelectedBlocksBetween(
        host.view.state.doc.lines,
        state.activeFixedBoundary.startLineNumber,
        state.activeFixedBoundary.endLineNumber,
        movingBoundary.startLineNumber,
        movingBoundary.endLineNumber,
        createRangeSelectionBoundaryResolver(host.view.state)
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

function finishNativeMobileSelectionSession(host: MobileSelectionActionHost): void {
    host.pointer.detachPointerListeners();
    host.pointer.releasePointerCapture();
    host.mobile.unlockMobileInteraction();
    host.mobile.detachFocusGuard();
}

function exitMobileSelectionMode(host: MobileSelectionActionHost): void {
    if (!(host.gesture.phase === 'selecting' && host.gesture.selection.mode === 'mobile')) return;
    host.gesture.selection.mobileSelect.activeInteraction = null;
    finishNativeMobileSelectionSession(host);
    host.gesture = { phase: 'idle' };
    host.clearCommittedRangeSelection();
    host.emitIdleLifecycle();
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
    host.rangeVisual.render(blocks, { highlightLines: true, showMobileResizeHandles: true });
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
