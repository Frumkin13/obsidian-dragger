import { EditorView } from '@codemirror/view';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import {
    groupSegments,
    mergeSelectedBlocks,
    type BlockSelectionSegment,
    type SelectedBlockRange,
} from './block-selection';
import {
    buildAnchorSnapshot,
    emptyAnchorSnapshot,
    resolveAnchorSpan,
    type RangeAnchorSpan,
    type AnchorSnapshot,
} from './selection-anchor';
import { RangeSelectionOverlayRenderer, SelectionOverlayAction } from './selection-overlay-renderer';

export class RangeSelectionVisualManager {
    private readonly handleElements = new Set<HTMLElement>();
    private readonly overlayRenderer: RangeSelectionOverlayRenderer;
    private handleAnchorSnapshot: AnchorSnapshot = emptyAnchorSnapshot();
    private refreshRafHandle: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private readonly onScroll: () => void;

    constructor(
        private readonly view: EditorView,
        private readonly onRefreshRequested: () => void,
        private readonly resolveVisibleHandleForBlockStart: (blockStart: number) => HTMLElement | null,
        onSelectionAction?: (action: SelectionOverlayAction, blocks: SelectedBlockRange[]) => void
    ) {
        this.overlayRenderer = new RangeSelectionOverlayRenderer(
            this.view,
            onSelectionAction
        );

        this.onScroll = () => this.scheduleRefresh();
        this.bindScrollListener();
    }

    render(blocks: SelectedBlockRange[]): void {
        const normalizedBlocks = mergeSelectedBlocks(this.view.state.doc.lines, blocks);
        const segments = groupSegments(normalizedBlocks);
        const nextHandleElements = new Set<HTMLElement>();
        for (const block of normalizedBlocks) {
            const handleEl = this.resolveHandleElementForBlockStart(block.startLineNumber - 1);
            if (handleEl) {
                nextHandleElements.add(handleEl);
            }
        }
        this.handleAnchorSnapshot = buildAnchorSnapshot(nextHandleElements);
        this.syncSelectionElements(
            this.handleElements,
            nextHandleElements,
            RANGE_SELECTED_HANDLE_CLASS
        );
        this.overlayRenderer.render(normalizedBlocks, segments, (segment) => this.resolveRangeAnchorSpan(segment));
    }

    clear(): void {
        for (const handleEl of this.handleElements) {
            handleEl.classList.remove(RANGE_SELECTED_HANDLE_CLASS);
        }
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
            if (next.has(el)) continue;
            el.classList.remove(className);
        }
        for (const el of next) {
            if (current.has(el)) continue;
            el.classList.add(className);
        }
        current.clear();
        for (const el of next) {
            current.add(el);
        }
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
