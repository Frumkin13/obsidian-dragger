import { EditorView } from '@codemirror/view';
import type { LineRange } from '../../shared/types/line-range';
import {
    RANGE_SELECTION_DELETE_BUTTON_CLASS,
    RANGE_SELECTION_LINK_CLASS,
} from '../../shared/dom-selectors';
import { viewportXToEditorLocalX, viewportYToEditorLocalY } from './editor-local-coordinates';
import { RangeAnchorSpan } from './selection-anchor';

export class RangeSelectionOverlayRenderer {
    private readonly linkEls: HTMLElement[] = [];
    private readonly deleteButtonEl: HTMLButtonElement;
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
        private readonly onDeleteSelectionClick?: (ranges: LineRange[]) => void,
        private readonly isDeleteButtonEnabledRef?: () => boolean
    ) {
        this.deleteButtonEl = document.createElement('button');
        this.deleteButtonEl.type = 'button';
        this.deleteButtonEl.className = RANGE_SELECTION_DELETE_BUTTON_CLASS;
        this.deleteButtonEl.setAttribute('aria-label', 'Delete selected blocks');
        this.deleteButtonEl.textContent = 'Delete';
        this.deleteButtonEl.addEventListener('click', this.onDeleteButtonClick);
    }

    render(ranges: LineRange[], resolveRangeAnchorSpan: (range: LineRange) => RangeAnchorSpan | null): void {
        this.currentRenderedRanges = ranges.map((range) => ({
            startLineNumber: range.startLineNumber,
            endLineNumber: range.endLineNumber,
        }));

        let buttonAnchor: { topY: number; x: number; host: HTMLElement } | null = null;
        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const anchorSpan = resolveRangeAnchorSpan(range);
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

    clear(): void {
        for (const link of this.linkEls) {
            link.classList.remove('is-active');
        }
        this.currentRenderedRanges = [];
        this.hideDeleteButton();
    }

    destroy(): void {
        this.clear();
        for (const link of this.linkEls) {
            link.remove();
        }
        this.linkEls.length = 0;
        this.deleteButtonEl.removeEventListener('click', this.onDeleteButtonClick);
        this.deleteButtonEl.remove();
    }

    private isDeleteButtonEnabled(): boolean {
        if (!this.onDeleteSelectionClick) return false;
        return this.isDeleteButtonEnabledRef?.() === true;
    }

    private hideDeleteButton(): void {
        this.deleteButtonEl.classList.remove('is-active');
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




