import { EditorView } from '@codemirror/view';
import {
    MOBILE_SELECTION_RESIZE_HANDLE_BOTTOM_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_TOP_CLASS,
} from '../../shared/dom-selectors';
import { viewportXToEditorLocalX, viewportYToEditorLocalY } from './editor-local-coordinates';
import { safeCoordsAtPos } from '../../platform/dom/element-probe';
import { RangeAnchorSpan } from './range-selection-anchor';
import {
    type BlockSelectionSegment,
    type SelectedBlockRange,
} from '../../shared/utils/block-ranges';

export class RangeSelectionOverlayRenderer {
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
        segments: BlockSelectionSegment[],
        resolveRangeAnchorSpan: (segment: BlockSelectionSegment) => RangeAnchorSpan | null,
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

        for (const segment of segments) {
            resolveRangeAnchorSpan(segment);
        }

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
        handle.textContent = '⠿';
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
