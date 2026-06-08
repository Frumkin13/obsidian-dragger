import { EditorView } from '@codemirror/view';
import { safeCoordsAtPos } from '../../dom/element-probe';
import {
    CODEMIRROR_GUTTER_ELEMENT_SELECTOR,
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    HANDLE_CORE_CLASS,
    HANDLE_GUTTER_MARKER_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_BOTTOM_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_TOP_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import {
    mergeSelectedBlocks,
    type BlockSelectionSegment,
    type SelectedBlockRange,
} from '../../../domain/selection/block-ranges';
import type { PipelineState } from '../../../drag/pipeline/pipeline-state';
import type { CommittedRangeSelection } from '../../../domain/selection/range-selection';
import { getMainContentLineElementForLine } from '../../dom/line-dom';
import { addSourceLineClasses, removeSourceLineClasses } from './source-line-visual';

export type RangeAnchorPoint = {
    x: number;
    y: number;
    host: HTMLElement;
};

export type RangeAnchorSpan = {
    x: number;
    topY: number;
    bottomY: number;
    host: HTMLElement;
};

type ResolveHandleForBlockLineNumber = (blockLineNumber: number) => HTMLElement | null;

type ResolveRangeAnchorSpanOptions = {
    segment: BlockSelectionSegment;
    resolveHandleForBlockLineNumber: ResolveHandleForBlockLineNumber;
    visibleHandles: Iterable<HTMLElement>;
};

export type AnchorEntry = {
    blockLineNumber: number;
    anchor: RangeAnchorPoint;
};

export type AnchorSnapshot = {
    ordered: AnchorEntry[];
    byBlockLineNumber: Map<number, RangeAnchorPoint>;
};

function getHandleBlockLineNumber(handle: HTMLElement): number | null {
    const blockStartAttr = handle.getAttribute('data-block-start');
    if (!blockStartAttr) return null;
    const blockStart = Number(blockStartAttr);
    if (!Number.isFinite(blockStart)) return null;
    return blockStart + 1;
}

export function getAnchorPointForHandle(handle: HTMLElement | null): RangeAnchorPoint | null {
    if (!handle) return null;
    const host = handle.closest<HTMLElement>(`${CODEMIRROR_GUTTER_ELEMENT_SELECTOR}.${HANDLE_GUTTER_MARKER_CLASS}`)
        ?? handle.closest<HTMLElement>(`.${HANDLE_GUTTER_MARKER_CLASS}`);
    if (!host) return null;
    const anchorTarget = handle.querySelector<HTMLElement>(`.${HANDLE_CORE_CLASS}`) ?? handle;
    const rect = anchorTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        host,
    };
}

function getAnchorPointByBlockLineNumber(
    blockLineNumber: number,
    resolveHandleForBlockLineNumber: ResolveHandleForBlockLineNumber
): RangeAnchorPoint | null {
    const handle = resolveHandleForBlockLineNumber(blockLineNumber);
    return getAnchorPointForHandle(handle);
}

export function emptyAnchorSnapshot(): AnchorSnapshot {
    return {
        ordered: [],
        byBlockLineNumber: new Map<number, RangeAnchorPoint>(),
    };
}

export function buildAnchorSnapshot(
    visibleHandles: Iterable<HTMLElement>
): AnchorSnapshot {
    const snapshot = emptyAnchorSnapshot();
    for (const handle of visibleHandles) {
        const blockLineNumber = getHandleBlockLineNumber(handle);
        if (blockLineNumber === null) continue;
        if (snapshot.byBlockLineNumber.has(blockLineNumber)) continue;
        const anchor = getAnchorPointForHandle(handle);
        if (!anchor) continue;
        snapshot.byBlockLineNumber.set(blockLineNumber, anchor);
        snapshot.ordered.push({ blockLineNumber, anchor });
    }
    snapshot.ordered.sort((a, b) => a.blockLineNumber - b.blockLineNumber);
    return snapshot;
}

type ResolveAnchorSpanOptions = {
    segment: BlockSelectionSegment;
    snapshot: AnchorSnapshot;
    resolveHandleForBlockLineNumber?: ResolveHandleForBlockLineNumber;
};

function findFirstAnchorIndexAtOrAfter(
    ordered: AnchorEntry[],
    startBlockLineNumber: number
): number {
    let low = 0;
    let high = ordered.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (ordered[mid].blockLineNumber < startBlockLineNumber) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

export function resolveAnchorSpan(
    options: ResolveAnchorSpanOptions
): RangeAnchorSpan | null {
    const anchors: RangeAnchorPoint[] = [];
    const seenHosts = new Set<HTMLElement>();
    const addAnchor = (anchor: RangeAnchorPoint | null): void => {
        if (!anchor) return;
        if (seenHosts.has(anchor.host)) return;
        seenHosts.add(anchor.host);
        anchors.push(anchor);
    };

    const startAnchor = options.snapshot.byBlockLineNumber.get(options.segment.startBlockLineNumber)
        ?? (options.resolveHandleForBlockLineNumber
            ? getAnchorPointByBlockLineNumber(
                options.segment.startBlockLineNumber,
                options.resolveHandleForBlockLineNumber
            )
            : null);
    const endAnchor = options.snapshot.byBlockLineNumber.get(options.segment.endBlockLineNumber)
        ?? (options.resolveHandleForBlockLineNumber
            ? getAnchorPointByBlockLineNumber(
                options.segment.endBlockLineNumber,
                options.resolveHandleForBlockLineNumber
            )
            : null);

    addAnchor(startAnchor);
    addAnchor(endAnchor);

    const ordered = options.snapshot.ordered;
    for (
        let i = findFirstAnchorIndexAtOrAfter(ordered, options.segment.startBlockLineNumber);
        i < ordered.length && ordered[i].blockLineNumber <= options.segment.endBlockLineNumber;
        i++
    ) {
        addAnchor(ordered[i].anchor);
    }

    if (anchors.length === 0) return null;

    const topAnchor = anchors.reduce((best, current) => (current.y < best.y ? current : best));
    const bottomAnchor = anchors.reduce((best, current) => (current.y > best.y ? current : best));
    return {
        x: (topAnchor.x + bottomAnchor.x) / 2,
        topY: topAnchor.y,
        bottomY: bottomAnchor.y,
        host: topAnchor.host,
    };
}

export function resolveRangeAnchorSpan(options: ResolveRangeAnchorSpanOptions): RangeAnchorSpan | null {
    return resolveAnchorSpan({
        segment: options.segment,
        snapshot: buildAnchorSnapshot(options.visibleHandles),
        resolveHandleForBlockLineNumber: options.resolveHandleForBlockLineNumber,
    });
}

function getEditorAxisScale(rectSize: number, offsetSize: number): number {
    if (rectSize <= 0 || offsetSize <= 0) return 1;
    return rectSize / offsetSize;
}

function viewportXToEditorLocalX(view: EditorView, viewportX: number): number {
    const rect = view.dom.getBoundingClientRect();
    const scaleX = getEditorAxisScale(rect.width, view.dom.offsetWidth);
    return (viewportX - rect.left) / scaleX - view.dom.clientLeft;
}

function viewportYToEditorLocalY(view: EditorView, viewportY: number): number {
    const rect = view.dom.getBoundingClientRect();
    const scaleY = getEditorAxisScale(rect.height, view.dom.offsetHeight);
    return (viewportY - rect.top) / scaleY - view.dom.clientTop;
}

class RangeSelectionOverlayRenderer {
    private readonly topResizeHandleEl: HTMLElement;
    private readonly bottomResizeHandleEl: HTMLElement;

    constructor(
        private readonly view: EditorView
    ) {
        this.topResizeHandleEl = this.createResizeHandle('top');
        this.bottomResizeHandleEl = this.createResizeHandle('bottom');
    }

    render(
        blocks: SelectedBlockRange[],
        options?: { showMobileResizeHandles?: boolean }
    ): void {
        const hostOriginCache = new WeakMap<HTMLElement, { x: number; y: number }>();
        const getHostOrigin = (host: HTMLElement): { x: number; y: number } => {
            const cached = hostOriginCache.get(host);
            if (cached) return cached;
            const hostRect = host.getBoundingClientRect();
            const origin = {
                x: viewportXToEditorLocalX(this.view, hostRect.left),
                y: viewportYToEditorLocalY(this.view, hostRect.top),
            };
            hostOriginCache.set(host, origin);
            return origin;
        };
        const viewportXToHostLocalX = (host: HTMLElement, viewportX: number): number => (
            viewportXToEditorLocalX(this.view, viewportX) - getHostOrigin(host).x
        );
        const viewportYToHostLocalY = (host: HTMLElement, viewportY: number): number => (
            viewportYToEditorLocalY(this.view, viewportY) - getHostOrigin(host).y
        );

        const mobileResizeAnchors = options?.showMobileResizeHandles
            ? this.resolveMobileResizeAnchors(blocks)
            : null;
        this.renderResizeHandle(this.topResizeHandleEl, mobileResizeAnchors?.top ?? null, viewportXToHostLocalX, viewportYToHostLocalY, !!options?.showMobileResizeHandles);
        this.renderResizeHandle(this.bottomResizeHandleEl, mobileResizeAnchors?.bottom ?? null, viewportXToHostLocalX, viewportYToHostLocalY, !!options?.showMobileResizeHandles);
    }

    clear(): void {
        this.topResizeHandleEl.classList.remove('is-active');
        this.bottomResizeHandleEl.classList.remove('is-active');
    }

    destroy(): void {
        this.clear();
        this.topResizeHandleEl.remove();
        this.bottomResizeHandleEl.remove();
    }

    private renderResizeHandle(
        handleEl: HTMLElement,
        anchor: { y: number; x: number; host: HTMLElement } | null,
        viewportXToHostLocalX: (host: HTMLElement, viewportX: number) => number,
        viewportYToHostLocalY: (host: HTMLElement, viewportY: number) => number,
        shouldRender: boolean
    ): void {
        if (!anchor || !shouldRender || !this.isMobileEnvironment()) {
            handleEl.classList.remove('is-active');
            return;
        }
        if (handleEl.parentElement !== anchor.host) {
            anchor.host.appendChild(handleEl);
        }
        const left = viewportXToHostLocalX(anchor.host, anchor.x) - 32;
        const top = viewportYToHostLocalY(anchor.host, anchor.y) - 18;
        handleEl.classList.add('is-active');
        handleEl.setCssStyles({
            left: `${left.toFixed(2)}px`,
            top: `${top.toFixed(2)}px`,
        });
    }

    private resolveMobileResizeAnchors(blocks: SelectedBlockRange[]): {
        top: { y: number; x: number; host: HTMLElement };
        bottom: { y: number; x: number; host: HTMLElement };
    } | null {
        if (blocks.length === 0) return null;
        const doc = this.view.state.doc;
        const firstLineNumber = Math.min(...blocks.map((block) => block.startLineNumber));
        const lastLineNumber = Math.max(...blocks.map((block) => block.endLineNumber));
        if (firstLineNumber < 1 || lastLineNumber > doc.lines) return null;

        const firstLine = doc.line(firstLineNumber);
        const lastLine = doc.line(lastLineNumber);
        const topCoords = safeCoordsAtPos(this.view, firstLine.from, 1);
        const bottomCoords = safeCoordsAtPos(this.view, lastLine.to, -1)
            ?? safeCoordsAtPos(this.view, lastLine.from, 1);
        if (!topCoords || !bottomCoords) return null;

        const x = this.resolveSelectionCenterX();
        const host = this.view.dom;
        return {
            top: { y: topCoords.top, x, host },
            bottom: { y: bottomCoords.bottom, x, host },
        };
    }

    private resolveSelectionCenterX(): number {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (Number.isFinite(contentRect.left) && Number.isFinite(contentRect.right) && contentRect.right > contentRect.left) {
            return (contentRect.left + contentRect.right) / 2;
        }
        const editorRect = this.view.dom.getBoundingClientRect();
        return (editorRect.left + editorRect.right) / 2;
    }

    private createResizeHandle(position: 'top' | 'bottom'): HTMLElement {
        const handle = document.createElement('div');
        handle.className = `${MOBILE_SELECTION_RESIZE_HANDLE_CLASS} ${position === 'top'
            ? MOBILE_SELECTION_RESIZE_HANDLE_TOP_CLASS
            : MOBILE_SELECTION_RESIZE_HANDLE_BOTTOM_CLASS}`;
        handle.textContent = '::';
        handle.setAttribute('data-dnd-mobile-selection-handle', position);
        handle.setAttribute('aria-label', position === 'top' ? 'Adjust selection start' : 'Adjust selection end');
        return handle;
    }

    private isMobileEnvironment(): boolean {
        const body = document.body;
        if (body.classList.contains('is-mobile') || body.classList.contains('is-phone') || body.classList.contains('is-tablet')) {
            return true;
        }
        if (typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }
}

export function renderRangeSelectionPreview(
    state: PipelineState,
    committed: CommittedRangeSelection | null,
    rangeVisual: RangeSelectionVisualManager
): void {
    if (state.type === 'selecting') {
        const isMobileSelection = state.selection.guardDeps.includes('mobile-text-drag-mode');
        rangeVisual.render(state.selection.rangeState?.selectionBlocks ?? selectionBlocksFromSelection(state.selection.selection), {
            showSourceOutline: isMobileSelection,
            showMobileResizeHandles: isMobileSelection,
        });
        return;
    }
    if (committed) {
        rangeVisual.render(committed.blocks);
    }
}

function selectionBlocksFromSelection(selection: { ranges: Array<{ startLine: number; endLine: number }> }): SelectedBlockRange[] {
    return selection.ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));
}

export class RangeSelectionVisualManager {
    private static readonly selectedCheckboxClass = 'dnd-selection-checkbox';
    private readonly handleElements = new Set<HTMLElement>();
    private readonly sourceLineElements = new Set<HTMLElement>();
    private readonly overlayRenderer: RangeSelectionOverlayRenderer;
    private handleAnchorSnapshot: AnchorSnapshot = emptyAnchorSnapshot();
    private refreshRafHandle: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private readonly onScroll: () => void;

    constructor(
        private readonly view: EditorView,
        private readonly onRefreshRequested: () => void,
        private readonly resolveVisibleHandleForBlockStart: (blockStart: number) => HTMLElement | null
    ) {
        this.overlayRenderer = new RangeSelectionOverlayRenderer(
            this.view
        );

        this.onScroll = () => this.scheduleRefresh();
        this.bindScrollListener();
    }

    render(blocks: SelectedBlockRange[], options?: { showSourceOutline?: boolean; showMobileResizeHandles?: boolean }): void {
        const normalizedBlocks = mergeSelectedBlocks(this.view.state.doc.lines, blocks);
        const nextHandleElements = new Set<HTMLElement>();
        const nextSourceLineElements = new Set<HTMLElement>();
        for (const block of normalizedBlocks) {
            const handleEl = this.resolveHandleElementForBlockStart(block.startLineNumber - 1);
            if (handleEl) {
                nextHandleElements.add(handleEl);
            }
            if (options?.showSourceOutline) {
                this.collectSourceLineElements(block, nextSourceLineElements);
            }
        }
        this.handleAnchorSnapshot = buildAnchorSnapshot(nextHandleElements);
        this.syncSelectionElements(
            this.handleElements,
            nextHandleElements,
            RANGE_SELECTED_HANDLE_CLASS
        );
        this.syncSourceLineElements(nextSourceLineElements);
        this.overlayRenderer.render(normalizedBlocks, {
            showMobileResizeHandles: options?.showMobileResizeHandles,
        });
    }

    clear(): void {
        for (const handleEl of this.handleElements) {
            handleEl.classList.remove(RANGE_SELECTED_HANDLE_CLASS);
            this.removeSelectionCheckbox(handleEl);
        }
        this.clearSourceLineElements();
        this.handleElements.clear();
        this.handleAnchorSnapshot = emptyAnchorSnapshot();
        this.overlayRenderer.clear();
    }

    scheduleRefresh(): void {
        if (this.refreshRafHandle !== null) return;
        this.refreshRafHandle = window.requestAnimationFrame(() => {
            this.refreshRafHandle = null;
            this.onRefreshRequested();
        });
    }

    cancelScheduledRefresh(): void {
        if (this.refreshRafHandle === null) return;
        window.cancelAnimationFrame(this.refreshRafHandle);
        this.refreshRafHandle = null;
    }

    destroy(): void {
        this.clear();
        this.overlayRenderer.destroy();
        this.cancelScheduledRefresh();
        this.unbindScrollListener();
    }

    private bindScrollListener(): void {
        this.unbindScrollListener();
        const scroller = this.view.scrollDOM
            ?? this.view.dom.querySelector<HTMLElement>('.cm-scroller')
            ?? null;
        if (!scroller) return;
        scroller.addEventListener('scroll', this.onScroll, { passive: true });
        this.scrollContainer = scroller;
    }

    private unbindScrollListener(): void {
        if (!this.scrollContainer) return;
        this.scrollContainer.removeEventListener('scroll', this.onScroll);
        this.scrollContainer = null;
    }

    private syncSelectionElements(
        current: Set<HTMLElement>,
        next: Set<HTMLElement>,
        className: string
    ): void {
        for (const el of current) {
            if (next.has(el)) {
                el.classList.add(className);
                if (className === RANGE_SELECTED_HANDLE_CLASS) {
                    this.ensureSelectionCheckbox(el);
                }
                continue;
            }
            el.classList.remove(className);
            if (className === RANGE_SELECTED_HANDLE_CLASS) {
                this.removeSelectionCheckbox(el);
            }
        }
        for (const el of next) {
            if (current.has(el)) continue;
            el.classList.add(className);
            if (className === RANGE_SELECTED_HANDLE_CLASS) {
                this.ensureSelectionCheckbox(el);
            }
        }
        current.clear();
        for (const el of next) {
            current.add(el);
        }
    }

    private ensureSelectionCheckbox(handleEl: HTMLElement): void {
        const existing = handleEl.querySelector<HTMLInputElement>(`:scope > .${RangeSelectionVisualManager.selectedCheckboxClass}`);
        if (existing) {
            existing.checked = true;
            return;
        }
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.tabIndex = -1;
        checkbox.className = RangeSelectionVisualManager.selectedCheckboxClass;
        checkbox.setAttribute('aria-hidden', 'true');
        handleEl.appendChild(checkbox);
    }

    private removeSelectionCheckbox(handleEl: HTMLElement): void {
        const checkbox = handleEl.querySelector<HTMLInputElement>(`:scope > .${RangeSelectionVisualManager.selectedCheckboxClass}`);
        checkbox?.remove();
    }

    private collectSourceLineElements(block: SelectedBlockRange, target: Set<HTMLElement>): void {
        for (let lineNumber = block.startLineNumber; lineNumber <= block.endLineNumber; lineNumber++) {
            const lineEl = getMainContentLineElementForLine(this.view, lineNumber);
            if (!lineEl) continue;
            addSourceLineClasses(lineEl, lineNumber, block.startLineNumber, block.endLineNumber);
            target.add(lineEl);
        }
    }

    private syncSourceLineElements(next: Set<HTMLElement>): void {
        for (const lineEl of this.sourceLineElements) {
            if (next.has(lineEl)) continue;
            removeSourceLineClasses(lineEl);
        }
        this.sourceLineElements.clear();
        for (const lineEl of next) {
            this.sourceLineElements.add(lineEl);
        }
    }

    private clearSourceLineElements(): void {
        for (const lineEl of this.sourceLineElements) {
            removeSourceLineClasses(lineEl);
        }
        this.sourceLineElements.clear();
    }

    private resolveHandleElementForBlockStart(blockStart: number): HTMLElement | null {
        const mapped = this.resolveVisibleHandleForBlockStart(blockStart);
        if (mapped) return mapped;

        const selector = `.${DRAG_HANDLE_CLASS}[data-block-start="${blockStart}"]`;
        const handles = Array.from(this.view.dom.querySelectorAll<HTMLElement>(selector));
        if (handles.length === 0) return null;
        return handles.find((handle) => !handle.classList.contains(EMBED_HANDLE_CLASS)) ?? handles[0] ?? null;
    }

    resolveRangeAnchorSpan(segment: BlockSelectionSegment): RangeAnchorSpan | null {
        return resolveAnchorSpan({
            segment,
            snapshot: this.handleAnchorSnapshot,
            resolveHandleForBlockLineNumber: (lineNumber) => this.resolveHandleElementForBlockStart(lineNumber - 1),
        });
    }
}
