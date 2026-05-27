import { EditorView } from '@codemirror/view';
import {
    MOBILE_SELECTION_BAR_CLASS,
    MOBILE_SELECTION_CONVERT_CLASS,
    MOBILE_SELECTION_DELETE_CLASS,
    MOBILE_SELECTION_DONE_CLASS,
    RANGE_SELECTION_FLOATING_GRIP_CLASS,
    RANGE_SELECTION_LINK_CLASS,
} from '../../../shared/dom-selectors';
import { viewportXToEditorLocalX, viewportYToEditorLocalY } from './editor-local-coordinates';
import { RangeAnchorSpan } from './selection-anchor';
import {
    type BlockSelectionSegment,
    type SelectedBlockRange,
} from './block-selection';

export type SelectionOverlayAction = 'delete' | 'done' | 'convert';

export class RangeSelectionOverlayRenderer {
    private readonly railEls: HTMLElement[] = [];
    private readonly floatingGripEl: HTMLElement;
    private readonly mobileBarEl: HTMLElement;
    private readonly countEl: HTMLElement;
    private currentRenderedBlocks: SelectedBlockRange[] = [];
    private readonly onActionClick = (action: SelectionOverlayAction) => (event: MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        if (this.currentRenderedBlocks.length === 0) return;
        this.onAction?.(action, this.cloneCurrentBlocks());
    };

    constructor(
        private readonly view: EditorView,
        private readonly onAction?: (action: SelectionOverlayAction, blocks: SelectedBlockRange[]) => void
    ) {
        this.floatingGripEl = document.createElement('div');
        this.floatingGripEl.className = RANGE_SELECTION_FLOATING_GRIP_CLASS;
        this.floatingGripEl.setAttribute('aria-label', 'Drag selected blocks');
        this.floatingGripEl.textContent = '⠿';

        this.mobileBarEl = document.createElement('div');
        this.mobileBarEl.className = MOBILE_SELECTION_BAR_CLASS;

        this.countEl = document.createElement('span');
        this.countEl.className = 'dnd-mobile-selection-count';
        this.mobileBarEl.appendChild(this.countEl);
        this.mobileBarEl.appendChild(this.createMobileButton(MOBILE_SELECTION_DELETE_CLASS, 'Delete', 'delete'));
        this.mobileBarEl.appendChild(this.createMobileButton(MOBILE_SELECTION_CONVERT_CLASS, 'Convert', 'convert'));
        this.mobileBarEl.appendChild(this.createMobileButton(MOBILE_SELECTION_DONE_CLASS, 'Done', 'done'));
    }

    render(
        blocks: SelectedBlockRange[],
        segments: BlockSelectionSegment[],
        resolveRangeAnchorSpan: (segment: BlockSelectionSegment) => RangeAnchorSpan | null
    ): void {
        this.currentRenderedBlocks = this.cloneBlocks(blocks);
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

        let gripAnchor: { topY: number; x: number; host: HTMLElement } | null = null;
        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            const anchorSpan = resolveRangeAnchorSpan(segment);
            const rail = this.ensureRailEl(i);
            if (!anchorSpan) {
                rail.classList.remove('is-active');
                continue;
            }
            if (rail.parentElement !== anchorSpan.host) {
                anchorSpan.host.appendChild(rail);
            }

            const top = viewportYToHostLocalY(anchorSpan.host, anchorSpan.topY);
            const bottom = viewportYToHostLocalY(anchorSpan.host, anchorSpan.bottomY);
            const railTop = Math.min(top, bottom);
            const railHeight = Math.max(2, Math.abs(bottom - top));
            const left = viewportXToHostLocalX(anchorSpan.host, anchorSpan.x);

            if (!gripAnchor || anchorSpan.topY < gripAnchor.topY) {
                gripAnchor = { topY: anchorSpan.topY, x: anchorSpan.x, host: anchorSpan.host };
            }

            rail.classList.add('is-active');
            rail.setCssStyles({
                left: `${left.toFixed(2)}px`,
                top: `${railTop.toFixed(2)}px`,
                height: `${railHeight.toFixed(2)}px`,
            });
        }
        for (let i = segments.length; i < this.railEls.length; i++) {
            this.railEls[i].classList.remove('is-active');
        }

        this.renderFloatingGrip(gripAnchor, viewportXToHostLocalX, viewportYToHostLocalY);
        this.renderMobileBar(blocks.length);
    }

    clear(): void {
        for (const rail of this.railEls) {
            rail.classList.remove('is-active');
        }
        this.currentRenderedBlocks = [];
        this.floatingGripEl.classList.remove('is-active');
        this.mobileBarEl.classList.remove('is-active');
    }

    destroy(): void {
        this.clear();
        for (const rail of this.railEls) {
            rail.remove();
        }
        this.railEls.length = 0;
        this.floatingGripEl.remove();
        this.mobileBarEl.remove();
    }

    private renderFloatingGrip(
        gripAnchor: { topY: number; x: number; host: HTMLElement } | null,
        viewportXToHostLocalX: (host: HTMLElement, viewportX: number) => number,
        viewportYToHostLocalY: (host: HTMLElement, viewportY: number) => number
    ): void {
        if (!gripAnchor || !this.isMobileEnvironment()) {
            this.floatingGripEl.classList.remove('is-active');
            return;
        }
        if (this.floatingGripEl.parentElement !== gripAnchor.host) {
            gripAnchor.host.appendChild(this.floatingGripEl);
        }
        const left = viewportXToHostLocalX(gripAnchor.host, gripAnchor.x) + 28;
        const top = viewportYToHostLocalY(gripAnchor.host, gripAnchor.topY) - 8;
        this.floatingGripEl.classList.add('is-active');
        this.floatingGripEl.setCssStyles({
            left: `${left.toFixed(2)}px`,
            top: `${top.toFixed(2)}px`,
        });
    }

    private renderMobileBar(selectedCount: number): void {
        if (!this.isMobileEnvironment() || selectedCount === 0) {
            this.mobileBarEl.classList.remove('is-active');
            return;
        }
        if (this.mobileBarEl.parentElement !== this.view.dom) {
            this.view.dom.appendChild(this.mobileBarEl);
        }
        this.countEl.textContent = `${selectedCount} selected`;
        this.mobileBarEl.classList.add('is-active');
    }

    private createMobileButton(className: string, label: string, action: SelectionOverlayAction): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', this.onActionClick(action));
        return button;
    }

    private ensureRailEl(index: number): HTMLElement {
        const existing = this.railEls[index];
        if (existing) {
            return existing;
        }
        const rail = document.createElement('div');
        rail.className = RANGE_SELECTION_LINK_CLASS;
        this.railEls[index] = rail;
        return rail;
    }

    private cloneCurrentBlocks(): SelectedBlockRange[] {
        return this.cloneBlocks(this.currentRenderedBlocks);
    }

    private cloneBlocks(blocks: SelectedBlockRange[]): SelectedBlockRange[] {
        return blocks.map((block) => ({
            startLineNumber: block.startLineNumber,
            endLineNumber: block.endLineNumber,
        }));
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
