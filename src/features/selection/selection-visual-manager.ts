import { EditorView } from '@codemirror/view';
import type { LineRange } from '../../shared/types/line-range';
import {
    getLineNumberElementForLine,
} from '../ui/handle/handle-positioner';
import {
    DRAG_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    GRAB_HIDDEN_LINE_NUMBER_CLASS,
} from '../../shared/dom-selectors';
import { mergeLineRanges, isLineNumberInRanges } from '../../shared/utils/line-range';
import { resolveBlockBoundaryAtLine } from './selection-model';
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
        onDeleteSelectionClick?: (ranges: LineRange[]) => void,
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

    render(ranges: LineRange[]): void {
        const normalizedRanges = mergeLineRanges(this.view.state.doc.lines, ranges);
        const nextLineNumberElements = new Set<HTMLElement>();
        const nextHandleElements = new Set<HTMLElement>();
        const doc = this.view.state.doc;
        const visibleRanges = this.view.visibleRanges ?? [{ from: 0, to: doc.length }];
        for (const range of visibleRanges) {
            let pos = range.from;
            while (pos <= range.to) {
                const line = doc.lineAt(pos);
                const lineNumber = line.number;
                if (isLineNumberInRanges(lineNumber, normalizedRanges)) {
                    const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
                    if (lineNumberEl) {
                        nextLineNumberElements.add(lineNumberEl);
                    }
                    const handleEl = this.getInlineHandleForLine(lineNumber);
                    if (handleEl) {
                        nextHandleElements.add(handleEl);
                    }
                }
                pos = line.to + 1;
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
        this.overlayRenderer.render(normalizedRanges, (range) => this.resolveRangeAnchorSpan(range));
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

    getInlineHandleForLine(lineNumber: number): HTMLElement | null {
        const blockStart = lineNumber - 1;
        if (blockStart < 0) return null;
        const selector = `.${DRAG_HANDLE_CLASS}[data-block-start="${blockStart}"]`;
        const handles = Array.from(this.view.dom.querySelectorAll<HTMLElement>(selector));
        if (handles.length === 0) return null;
        return handles.find((handle) => !handle.classList.contains(EMBED_HANDLE_CLASS)) ?? handles[0] ?? null;
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

    private resolveAnchorLineNumber(lineNumber: number): number {
        const docLines = this.view.state.doc.lines;
        const clampedLineNumber = Math.max(1, Math.min(docLines, lineNumber));
        const boundary = resolveBlockBoundaryAtLine(this.view.state, clampedLineNumber);
        return Math.max(1, Math.min(docLines, boundary.startLineNumber));
    }

    resolveRangeAnchorSpan(range: LineRange): RangeAnchorSpan | null {
        return resolveRangeAnchorSpanFromHandles({
            range,
            resolveAnchorLineNumber: (lineNumber) => this.resolveAnchorLineNumber(lineNumber),
            resolveInlineHandleForLine: (lineNumber) => this.getInlineHandleForLine(lineNumber),
            visibleHandles: this.handleElements,
        });
    }
}
