import { EditorView } from '@codemirror/view';
import { LineRange } from '../../../shared/types/block-types';
import {
    getLineNumberElementForLine,
    viewportYToEditorLocalY,
    viewportXToEditorLocalX,
} from '../../../infra/dom/handle/handle-positioner';
import {
    DRAG_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
    RANGE_SELECTION_LINK_CLASS,
    RANGE_SELECTION_DELETE_BUTTON_CLASS,
    EMBED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import { GRAB_HIDDEN_LINE_NUMBER_CLASS } from '../../../shared/constants';
import { mergeLineRanges, isLineNumberInRanges } from '../../../core/services/parser/line-range-utils';
import { resolveBlockBoundaryAtLine } from '../../../core/services/state/selection-model';
import {
    resolveRangeAnchorSpan as resolveRangeAnchorSpanFromHandles,
    type RangeAnchorSpan,
} from './range-selection-anchor';

const RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS = GRAB_HIDDEN_LINE_NUMBER_CLASS;

export class RangeSelectionVisualManager {
    private readonly lineNumberElements = new Set<HTMLElement>();
    private readonly handleElements = new Set<HTMLElement>();
    private readonly linkEls: HTMLElement[] = [];
    private readonly deleteButtonEl: HTMLButtonElement;
    private refreshRafHandle: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private readonly onScroll: () => void;
    private currentRenderedRanges: LineRange[] = [];
    private readonly onDeleteButtonClick = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.isDeleteButtonEnabled()) return;
        if (!this.onDeleteSelectionClick) return;
        if (this.currentRenderedRanges.length === 0) return;
        const ranges = this.currentRenderedRanges.map((range) => ({
            startLineNumber: range.startLineNumber,
            endLineNumber: range.endLineNumber,
        }));
        this.onDeleteSelectionClick(ranges);
    };

    constructor(
        private readonly view: EditorView,
        private readonly onRefreshRequested: () => void,
        private readonly onDeleteSelectionClick?: (ranges: LineRange[]) => void,
        private readonly isDeleteButtonEnabledRef?: () => boolean
    ) {
        this.deleteButtonEl = document.createElement('button');
        this.deleteButtonEl.type = 'button';
        this.deleteButtonEl.className = RANGE_SELECTION_DELETE_BUTTON_CLASS;
        this.deleteButtonEl.setAttribute('aria-label', 'Delete selected blocks');
        this.deleteButtonEl.textContent = 'Delete';
        this.deleteButtonEl.addEventListener('click', this.onDeleteButtonClick);

        this.onScroll = () => this.scheduleRefresh();
        this.bindScrollListener();
    }

    render(ranges: LineRange[]): void {
        const normalizedRanges = mergeLineRanges(this.view.state.doc.lines, ranges);
        this.currentRenderedRanges = normalizedRanges.map((range) => ({
            startLineNumber: range.startLineNumber,
            endLineNumber: range.endLineNumber,
        }));
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
        this.updateLinks(normalizedRanges);
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

        for (const link of this.linkEls) {
            link.classList.remove('is-active');
        }
        this.currentRenderedRanges = [];
        this.hideDeleteButton();
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
        for (const link of this.linkEls) {
            link.remove();
        }
        this.linkEls.length = 0;
        this.deleteButtonEl.removeEventListener('click', this.onDeleteButtonClick);
        this.deleteButtonEl.remove();
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

    private updateLinks(ranges: LineRange[]): void {
        let buttonAnchor: { topY: number; x: number; host: HTMLElement } | null = null;

        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const anchorSpan = this.resolveRangeAnchorSpan(range);
            const link = this.ensureLinkEl(i);
            if (!anchorSpan) {
                link.classList.remove('is-active');
                continue;
            }
            if (link.parentElement !== anchorSpan.host) {
                anchorSpan.host.appendChild(link);
            }

            const top = this.viewportYToHostLocalY(anchorSpan.host, anchorSpan.topY);
            const bottom = this.viewportYToHostLocalY(anchorSpan.host, anchorSpan.bottomY);
            const linkTop = Math.min(top, bottom);
            const linkHeight = Math.max(2, Math.abs(bottom - top));
            const left = this.viewportXToHostLocalX(anchorSpan.host, anchorSpan.x);

            if (!buttonAnchor || anchorSpan.topY < buttonAnchor.topY) {
                buttonAnchor = { topY: anchorSpan.topY, x: anchorSpan.x, host: anchorSpan.host };
            }

            link.classList.add('is-active');
            link.setCssStyles({
                left: `${left.toFixed(2)}px`,
                top: `${linkTop.toFixed(2)}px`,
                height: `${linkHeight.toFixed(2)}px`,
            });
        }
        for (let i = ranges.length; i < this.linkEls.length; i++) {
            this.linkEls[i].classList.remove('is-active');
        }

        if (!this.isDeleteButtonEnabled() || ranges.length === 0 || !buttonAnchor) {
            this.hideDeleteButton();
            return;
        }

        if (this.deleteButtonEl.parentElement !== buttonAnchor.host) {
            buttonAnchor.host.appendChild(this.deleteButtonEl);
        }

        const buttonTop = this.viewportYToHostLocalY(buttonAnchor.host, buttonAnchor.topY) - 10;
        const buttonLeft = this.viewportXToHostLocalX(buttonAnchor.host, buttonAnchor.x);
        this.deleteButtonEl.classList.add('is-active');
        this.deleteButtonEl.setCssStyles({
            left: `${buttonLeft.toFixed(2)}px`,
            top: `${buttonTop.toFixed(2)}px`,
        });
    }

    private hideDeleteButton(): void {
        this.deleteButtonEl.classList.remove('is-active');
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

    private isDeleteButtonEnabled(): boolean {
        if (!this.onDeleteSelectionClick) return false;
        return this.isDeleteButtonEnabledRef?.() === true;
    }

    private ensureLinkEl(index: number): HTMLElement {
        const existing = this.linkEls[index];
        if (existing) {
            return existing;
        }
        const link = document.createElement('div');
        link.className = RANGE_SELECTION_LINK_CLASS;
        this.linkEls[index] = link;
        return link;
    }

    private viewportXToHostLocalX(host: HTMLElement, viewportX: number): number {
        const hostRect = host.getBoundingClientRect();
        const hostX = viewportXToEditorLocalX(this.view, hostRect.left);
        return viewportXToEditorLocalX(this.view, viewportX) - hostX;
    }

    private viewportYToHostLocalY(host: HTMLElement, viewportY: number): number {
        const hostRect = host.getBoundingClientRect();
        const hostY = viewportYToEditorLocalY(this.view, hostRect.top);
        return viewportYToEditorLocalY(this.view, viewportY) - hostY;
    }
}
