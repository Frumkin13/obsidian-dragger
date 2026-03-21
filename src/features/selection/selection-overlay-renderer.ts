import { EditorView } from '@codemirror/view';
import {
    RANGE_SELECTION_DELETE_BUTTON_CLASS,
    RANGE_SELECTION_LINK_CLASS,
} from '../../shared/dom-selectors';
import { viewportXToEditorLocalX, viewportYToEditorLocalY } from './editor-local-coordinates';
import { RangeAnchorSpan } from './selection-anchor';
import {
    type BlockSelectionSegment,
    type SelectedBlockRange,
} from './block-selection';

export class RangeSelectionOverlayRenderer {
    private readonly linkEls: HTMLElement[] = [];
    private readonly deleteButtonEl: HTMLButtonElement;
    private currentRenderedBlocks: SelectedBlockRange[] = [];
    private readonly onDeleteButtonClick = (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.isDeleteButtonEnabled()) return;
        if (!this.onDeleteSelectionClick) return;
        if (this.currentRenderedBlocks.length === 0) return;
        const blocks = this.currentRenderedBlocks.map((block) => ({
            startLineNumber: block.startLineNumber,
            endLineNumber: block.endLineNumber,
        }));
        this.onDeleteSelectionClick(blocks);
    };

    constructor(
        private readonly view: EditorView,
        private readonly onDeleteSelectionClick?: (blocks: SelectedBlockRange[]) => void,
        private readonly isDeleteButtonEnabledRef?: () => boolean
    ) {
        this.deleteButtonEl = document.createElement('button');
        this.deleteButtonEl.type = 'button';
        this.deleteButtonEl.className = RANGE_SELECTION_DELETE_BUTTON_CLASS;
        this.deleteButtonEl.setAttribute('aria-label', 'Delete selected blocks');
        this.deleteButtonEl.textContent = 'Delete';
        this.deleteButtonEl.addEventListener('click', this.onDeleteButtonClick);
    }

    render(
        blocks: SelectedBlockRange[],
        segments: BlockSelectionSegment[],
        resolveRangeAnchorSpan: (segment: BlockSelectionSegment) => RangeAnchorSpan | null
    ): void {
        this.currentRenderedBlocks = blocks.map((block) => ({
            startLineNumber: block.startLineNumber,
            endLineNumber: block.endLineNumber,
        }));
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

        let buttonAnchor: { topY: number; x: number; host: HTMLElement } | null = null;
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const anchorSpan = resolveRangeAnchorSpan(segment);
            const link = this.ensureLinkEl(i);
            if (!anchorSpan) {
                link.classList.remove('is-active');
                continue;
            }
            if (link.parentElement !== anchorSpan.host) {
                anchorSpan.host.appendChild(link);
            }

            const top = viewportYToHostLocalY(anchorSpan.host, anchorSpan.topY);
            const bottom = viewportYToHostLocalY(anchorSpan.host, anchorSpan.bottomY);
            const linkTop = Math.min(top, bottom);
            const linkHeight = Math.max(2, Math.abs(bottom - top));
            const left = viewportXToHostLocalX(anchorSpan.host, anchorSpan.x);

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
        for (let i = segments.length; i < this.linkEls.length; i++) {
            this.linkEls[i].classList.remove('is-active');
        }

        if (!this.isDeleteButtonEnabled() || blocks.length === 0 || !buttonAnchor) {
            this.hideDeleteButton();
            return;
        }

        if (this.deleteButtonEl.parentElement !== buttonAnchor.host) {
            buttonAnchor.host.appendChild(this.deleteButtonEl);
        }

        const buttonTop = viewportYToHostLocalY(buttonAnchor.host, buttonAnchor.topY) - 10;
        const buttonLeft = viewportXToHostLocalX(buttonAnchor.host, buttonAnchor.x);
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
        this.currentRenderedBlocks = [];
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

}




