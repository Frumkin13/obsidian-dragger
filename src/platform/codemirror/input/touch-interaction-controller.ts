import { EditorView } from '@codemirror/view';
import { EMBED_BLOCK_SELECTOR, MOBILE_GESTURE_LOCK_CLASS } from '../../../shared/dom-selectors';
import { DND_MOBILE_GESTURE_LOCK_COUNT_ATTR } from '../../../shared/dom-attrs';
import { safeCoordsAtPos, resolveLineNumberFromDomNodes } from '../../dom/element-probe';
import { findEmbedElementAtPoint } from '../../dom/embed-probe';

export type DragInteractionMode =
    | { type: 'idle' }
    | {
        type: 'mobile_drag';
        phase: 'passive' | 'gesture';
        submode?: 'selection';
    };

export const IDLE_INTERACTION_MODE: DragInteractionMode = { type: 'idle' };
export const MOBILE_DRAG_GESTURE_MODE: DragInteractionMode = { type: 'mobile_drag', phase: 'gesture' };
export const MOBILE_SELECTION_PASSIVE_MODE: DragInteractionMode = {
    type: 'mobile_drag',
    phase: 'passive',
    submode: 'selection',
};
export const MOBILE_SELECTION_GESTURE_MODE: DragInteractionMode = {
    type: 'mobile_drag',
    phase: 'gesture',
    submode: 'selection',
};

export function shouldExitDragInteractionWhenMobileDragUnavailable(
    mode: DragInteractionMode,
    mobileDragAvailable: boolean
): boolean {
    return mode.type === 'mobile_drag' && !mobileDragAvailable;
}

function resolveDragInteractionCapabilities(mode: DragInteractionMode): { suppressTextInput: boolean; suppressScroll: boolean } {
    if (mode.type === 'idle') {
        return {
            suppressTextInput: false,
            suppressScroll: false,
        };
    }
    return {
        suppressTextInput: true,
        suppressScroll: mode.phase === 'gesture',
    };
}

const MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX = 16;
const MOBILE_LINE_HIT_Y_TOLERANCE_PX = 8;
const MOBILE_EMBED_HIT_PADDING_PX = 6;
const MOBILE_RANGE_SELECT_SCROLL_CANCEL_THRESHOLD_PX = 14;

export class TouchInteractionController {
    private textInputSuppressed = false;
    private scrollSuppressed = false;
    private focusGuardAttached = false;
    private readonly onDocumentFocusIn: (e: FocusEvent) => void;
    private savedContentEditable: string | null = null;

    constructor(
        private readonly view: EditorView,
        onFocusIn: (e: FocusEvent) => void
    ) {
        this.onDocumentFocusIn = onFocusIn;
    }

    isMobileEnvironment(): boolean {
        const body = document.body;
        if (body?.classList.contains('is-mobile') || body?.classList.contains('is-phone') || body?.classList.contains('is-tablet')) {
            return true;
        }
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }

    isWithinContentTolerance(clientX: number): boolean {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const left = contentRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        const right = contentRect.right + MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        return clientX >= left && clientX <= right;
    }

    isWithinEditorTolerance(clientX: number): boolean {
        const editorRect = this.view.dom.getBoundingClientRect();
        const left = editorRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        const right = editorRect.right + MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        return clientX >= left && clientX <= right;
    }

    isWithinMobileTextLineOrEmbedArea(target: HTMLElement | null, clientX: number, clientY: number): boolean {
        const embedEl = this.resolveEmbedElement(target, clientX, clientY);
        if (embedEl) {
            return this.isWithinEmbedDragArea(embedEl, clientX, clientY);
        }

        if (!target) return false;
        const lineEl = target.closest<HTMLElement>('.cm-line');
        if (lineEl && this.view.contentDOM.contains(lineEl)) {
            const lineNumber = this.resolveLineNumberFromTarget(target, lineEl);
            if (lineNumber !== null) {
                return this.isWithinLineDragArea(lineNumber, clientX, clientY);
            }
        }

        if (!this.view.contentDOM.contains(target)) return false;
        const targetLineNumber = this.resolveLineNumberFromTarget(target, null);
        if (targetLineNumber !== null) {
            return this.isWithinLineDragArea(targetLineNumber, clientX, clientY);
        }

        return false;
    }

    isMostlyVerticalScrollGesture(dx: number, dy: number): boolean {
        return Math.abs(dy) > MOBILE_RANGE_SELECT_SCROLL_CANCEL_THRESHOLD_PX
            && Math.abs(dy) > Math.abs(dx) * 1.4;
    }

    applyDragInteractionMode(mode: DragInteractionMode, keyboardTarget?: EventTarget | null): void {
        const capabilities = resolveDragInteractionCapabilities(mode);
        this.setTextInputSuppressed(capabilities.suppressTextInput, keyboardTarget);
        this.setScrollSuppressed(capabilities.suppressScroll);
    }

    clearDragInteractionMode(): void {
        this.applyDragInteractionMode(IDLE_INTERACTION_MODE);
    }

    private setScrollSuppressed(shouldSuppress: boolean): void {
        if (shouldSuppress === this.scrollSuppressed) return;

        const body = document.body;
        if (shouldSuppress) {
            const current = Number(body.getAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR) || '0');
            const next = current + 1;
            body.setAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR, String(next));
            body.classList.add(MOBILE_GESTURE_LOCK_CLASS);
            this.view.dom.classList.add(MOBILE_GESTURE_LOCK_CLASS);
        } else {
            const current = Number(body.getAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR) || '0');
            const next = Math.max(0, current - 1);
            if (next === 0) {
                body.removeAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR);
                body.classList.remove(MOBILE_GESTURE_LOCK_CLASS);
            } else {
                body.setAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR, String(next));
            }
            this.view.dom.classList.remove(MOBILE_GESTURE_LOCK_CLASS);
        }
        this.scrollSuppressed = shouldSuppress;
    }

    private setTextInputSuppressed(shouldSuppress: boolean, keyboardTarget?: EventTarget | null): void {
        if (shouldSuppress === this.textInputSuppressed) {
            if (shouldSuppress) {
                this.suppressMobileKeyboard(keyboardTarget);
            }
            return;
        }

        if (shouldSuppress) {
            this.savedContentEditable = this.view.contentDOM.getAttribute('contenteditable');
            this.view.contentDOM.setAttribute('contenteditable', 'false');
            this.attachFocusGuard();
            this.suppressMobileKeyboard(keyboardTarget);
        } else {
            if (this.savedContentEditable === null) {
                this.view.contentDOM.removeAttribute('contenteditable');
            } else {
                this.view.contentDOM.setAttribute('contenteditable', this.savedContentEditable);
            }
            this.savedContentEditable = null;
            this.detachFocusGuard();
        }
        this.textInputSuppressed = shouldSuppress;
    }

    suppressMobileKeyboard(target?: EventTarget | null): void {
        const rawActive = target instanceof HTMLElement ? target : document.activeElement;
        const active = rawActive instanceof HTMLElement ? rawActive : null;
        if (!active) return;
        if (!this.shouldSuppressFocusTarget(active)) return;

        if (typeof active.blur === 'function') {
            active.blur();
        }
        if (typeof window.getSelection === 'function') {
            try {
                window.getSelection()?.removeAllRanges();
            } catch {
                // ignore selection clear failures on limited environments
            }
        }
    }

    shouldSuppressFocusTarget(target: HTMLElement): boolean {
        const isInputControl = target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || target.isContentEditable;
        const isEditorContent = target.classList.contains('cm-content')
            || !!target.closest('.cm-content');
        return isInputControl || isEditorContent;
    }

    private attachFocusGuard(): void {
        if (this.focusGuardAttached) return;
        document.addEventListener('focusin', this.onDocumentFocusIn, true);
        this.focusGuardAttached = true;
    }

    private detachFocusGuard(): void {
        if (!this.focusGuardAttached) return;
        document.removeEventListener('focusin', this.onDocumentFocusIn, true);
        this.focusGuardAttached = false;
    }

    triggerMobileHapticFeedback(): void {
        const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
        if (typeof nav.vibrate !== 'function') return;
        try {
            nav.vibrate(10);
        } catch {
            // ignore unsupported vibration errors
        }
    }

    private resolveLineNumberFromTarget(target: HTMLElement, lineEl: HTMLElement | null): number | null {
        const probes: Node[] = [target];
        if (lineEl) probes.push(lineEl);
        if (target.firstChild) probes.push(target.firstChild);
        if (lineEl?.firstChild) probes.push(lineEl.firstChild);
        return resolveLineNumberFromDomNodes(this.view, probes);
    }

    private isWithinLineDragArea(lineNumber: number, clientX: number, clientY: number): boolean {
        if (!this.isWithinContentTolerance(clientX)) return false;
        const lineRect = this.resolveLineRect(lineNumber);
        if (!lineRect) return false;
        return clientY >= lineRect.top - MOBILE_LINE_HIT_Y_TOLERANCE_PX
            && clientY <= lineRect.bottom + MOBILE_LINE_HIT_Y_TOLERANCE_PX;
    }

    private isWithinEmbedDragArea(embedEl: HTMLElement, clientX: number, clientY: number): boolean {
        if (!this.isWithinEditorTolerance(clientX)) return false;
        const rect = embedEl.getBoundingClientRect();
        return clientX >= rect.left - MOBILE_EMBED_HIT_PADDING_PX
            && clientX <= rect.right + MOBILE_EMBED_HIT_PADDING_PX
            && clientY >= rect.top - MOBILE_EMBED_HIT_PADDING_PX
            && clientY <= rect.bottom + MOBILE_EMBED_HIT_PADDING_PX;
    }

    private resolveEmbedElement(target: HTMLElement | null, clientX: number, clientY: number): HTMLElement | null {
        if (target) {
            const fromTarget = target.closest<HTMLElement>(EMBED_BLOCK_SELECTOR);
            if (fromTarget && this.view.dom.contains(fromTarget)) {
                return fromTarget;
            }
        }

        return findEmbedElementAtPoint(this.view, clientX, clientY, {
            requireDirectWithinRoot: true,
            normalizeToEmbedRoot: false,
        });
    }

    private resolveLineRect(lineNumber: number): { top: number; bottom: number } | null {
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return null;
        const line = this.view.state.doc.line(lineNumber);
        const startCoords = safeCoordsAtPos(this.view, line.from, 1);
        const endCoords = safeCoordsAtPos(this.view, line.to, -1) ?? startCoords;
        if (!startCoords || !endCoords) return null;
        const top = Math.min(startCoords.top, endCoords.top);
        const bottom = Math.max(startCoords.bottom, endCoords.bottom);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return null;
        return { top, bottom };
    }
}

