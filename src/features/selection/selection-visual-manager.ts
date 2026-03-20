import { EditorView } from '@codemirror/view';
import { getLineNumberElementForLine } from '../ui/handle/line-number-gutter';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
    GRAB_HIDDEN_LINE_NUMBER_CLASS,
} from '../../shared/dom-selectors';
import {
    mergeSelectedBlocks,
    type BlockSelectionSegment,
    type SelectedBlockRange,
} from './block-selection';
import {
    resolveRangeAnchorSpan as resolveRangeAnchorSpanFromHandles,
    type RangeAnchorSpan,
} from './selection-anchor';
import { RangeSelectionOverlayRenderer } from './selection-overlay-renderer';

const RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS = GRAB_HIDDEN_LINE_NUMBER_CLASS;

export class RangeSelectionVisualManager {
    private readonly lineNumberElements = new Set<HTMLElement>();
    private readonly handleElements = new Set<HTMLElement>();
    private readonly overlayRenderer: RangeSelectionOverlayRenderer;
    private refreshRafHandle: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private readonly onScroll: () => void;

    constructor(
        private readonly view: EditorView,
        private readonly onRefreshRequested: () => void,
        private readonly resolveVisibleHandleForBlockStart: (blockStart: number) => HTMLElement | null,
        onDeleteSelectionClick?: (blocks: SelectedBlockRange[]) => void,
        isDeleteButtonEnabledRef?: () => boolean
    ) {
        this.overlayRenderer = new RangeSelectionOverlayRenderer(
            this.view,
            onDeleteSelectionClick,
            isDeleteButtonEnabledRef
        );

        this.onScroll = () => this.scheduleRefresh();
        this.bindScrollListener();
    }

    render(blocks: SelectedBlockRange[]): void {
        const normalizedBlocks = mergeSelectedBlocks(this.view.state.doc.lines, blocks);
        const nextLineNumberElements = new Set<HTMLElement>();
        const nextHandleElements = new Set<HTMLElement>();
        for (const block of normalizedBlocks) {
            const handleEl = this.resolveHandleElementForBlockStart(block.startLineNumber - 1);
            if (handleEl) {
                nextHandleElements.add(handleEl);
            }
            for (let lineNumber = block.startLineNumber; lineNumber <= block.endLineNumber; lineNumber++) {
                const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
                if (lineNumberEl) {
                    nextLineNumberElements.add(lineNumberEl);
                }
            }
        }
        this.syncSelectionElements(
            this.lineNumberElements,
            nextLineNumberElements,
            RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS
        );
        this.syncSelectionElements(
            this.handleElements,
            nextHandleElements,
            RANGE_SELECTED_HANDLE_CLASS
        );
        this.overlayRenderer.render(normalizedBlocks, (segment) => this.resolveRangeAnchorSpan(segment));
    }

    clear(): void {
        for (const lineNumberEl of this.lineNumberElements) {
            lineNumberEl.classList.remove(RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS);
        }
        this.lineNumberElements.clear();

        for (const handleEl of this.handleElements) {
            handleEl.classList.remove(RANGE_SELECTED_HANDLE_CLASS);
        }
        this.handleElements.clear();
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
        return resolveRangeAnchorSpanFromHandles({
            segment,
            resolveHandleForBlockLineNumber: (lineNumber) =>
                this.resolveHandleElementForBlockStart(lineNumber - 1),
            visibleHandles: this.handleElements,
        });
    }
}
