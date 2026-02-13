import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { MOBILE_GESTURE_LOCK_CLASS } from '../core/selectors';

const MOBILE_DRAG_HOTZONE_LEFT_PX = 24;
const MOBILE_DRAG_HOTZONE_RIGHT_PX = 8;
const MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX = 16;
const MOBILE_TEXT_GLYPH_HIT_X_TOLERANCE_PX = 8;
const MOBILE_TEXT_GLYPH_HIT_Y_TOLERANCE_PX = 6;
const MOBILE_GESTURE_LOCK_COUNT_ATTR = 'data-dnd-mobile-lock-count';

export class MobileGestureController {
    private mobileInteractionLocked = false;
    private focusGuardAttached = false;
    private readonly onDocumentFocusIn: (e: FocusEvent) => void;

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

    isWithinMobileDragHotzoneBand(clientX: number): boolean {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const left = contentRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        const right = contentRect.left
            + MOBILE_DRAG_HOTZONE_LEFT_PX
            + MOBILE_DRAG_HOTZONE_RIGHT_PX
            + MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        return clientX >= left && clientX <= right;
    }

    isWithinMobileDragHotzone(blockInfo: BlockInfo, clientX: number): boolean {
        const lineNumber = blockInfo.startLine + 1;
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return false;

        const line = this.view.state.doc.line(lineNumber);
        let lineStart: ReturnType<EditorView['coordsAtPos']> | null = null;
        try {
            lineStart = this.view.coordsAtPos(line.from);
        } catch {
            lineStart = null;
        }
        if (!lineStart) return false;

        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const hotzoneLeft = Math.max(
            contentRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX,
            lineStart.left - MOBILE_DRAG_HOTZONE_LEFT_PX - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX
        );
        const hotzoneRight = lineStart.left + MOBILE_DRAG_HOTZONE_RIGHT_PX;
        return clientX >= hotzoneLeft && clientX <= hotzoneRight;
    }

    isWithinMobileTextGlyphArea(target: HTMLElement | null, clientX: number, clientY: number): boolean {
        if (!target) return false;
        const lineEl = target.closest<HTMLElement>('.cm-line');
        if (!lineEl || !this.view.contentDOM.contains(lineEl)) return false;

        const lineNumber = this.resolveLineNumberFromTarget(target, lineEl);
        if (lineNumber === null) return false;

        const line = this.view.state.doc.line(lineNumber);
        const text = line.text;
        const firstNonWhitespaceIndex = text.search(/\S/);
        if (firstNonWhitespaceIndex < 0) return false;

        let lastNonWhitespaceIndex = text.length - 1;
        while (lastNonWhitespaceIndex >= firstNonWhitespaceIndex && /\s/.test(text.charAt(lastNonWhitespaceIndex))) {
            lastNonWhitespaceIndex -= 1;
        }
        if (lastNonWhitespaceIndex < firstNonWhitespaceIndex) return false;

        const startPos = line.from + firstNonWhitespaceIndex;
        const endPosExclusive = Math.min(line.to, line.from + lastNonWhitespaceIndex + 1);
        const startCoords = this.safeCoordsAtPos(startPos, 1);
        const endCoords = this.safeCoordsAtPos(endPosExclusive, -1);
        if (!startCoords || !endCoords) return false;

        const glyphLeft = Math.min(startCoords.left, startCoords.right, endCoords.left, endCoords.right);
        const glyphRight = Math.max(startCoords.left, startCoords.right, endCoords.left, endCoords.right);
        const glyphTop = Math.min(startCoords.top, startCoords.bottom, endCoords.top, endCoords.bottom);
        const glyphBottom = Math.max(startCoords.top, startCoords.bottom, endCoords.top, endCoords.bottom);
        if (!Number.isFinite(glyphLeft) || !Number.isFinite(glyphRight) || glyphRight <= glyphLeft) return false;

        const withinX = clientX >= glyphLeft - MOBILE_TEXT_GLYPH_HIT_X_TOLERANCE_PX
            && clientX <= glyphRight + MOBILE_TEXT_GLYPH_HIT_X_TOLERANCE_PX;
        if (!withinX) return false;
        const withinY = clientY >= glyphTop - MOBILE_TEXT_GLYPH_HIT_Y_TOLERANCE_PX
            && clientY <= glyphBottom + MOBILE_TEXT_GLYPH_HIT_Y_TOLERANCE_PX;
        return withinY;
    }

    lockMobileInteraction(): void {
        if (this.mobileInteractionLocked) return;

        const body = document.body;
        const current = Number(body.getAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR) || '0');
        const next = current + 1;
        body.setAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR, String(next));
        body.classList.add(MOBILE_GESTURE_LOCK_CLASS);

        this.view.dom.classList.add(MOBILE_GESTURE_LOCK_CLASS);
        this.mobileInteractionLocked = true;
    }

    unlockMobileInteraction(): void {
        if (!this.mobileInteractionLocked) return;

        const body = document.body;
        const current = Number(body.getAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR) || '0');
        const next = Math.max(0, current - 1);
        if (next === 0) {
            body.removeAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR);
            body.classList.remove(MOBILE_GESTURE_LOCK_CLASS);
        } else {
            body.setAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR, String(next));
        }

        this.view.dom.classList.remove(MOBILE_GESTURE_LOCK_CLASS);
        this.mobileInteractionLocked = false;
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
                // ignore selection clear failures on limited runtimes
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

    attachFocusGuard(): void {
        if (this.focusGuardAttached) return;
        document.addEventListener('focusin', this.onDocumentFocusIn, true);
        this.focusGuardAttached = true;
    }

    detachFocusGuard(): void {
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

    private resolveLineNumberFromTarget(target: HTMLElement, lineEl: HTMLElement): number | null {
        const doc = this.view.state.doc;
        const probes: Node[] = [target, lineEl];
        if (target.firstChild) probes.push(target.firstChild);
        if (lineEl.firstChild) probes.push(lineEl.firstChild);

        for (const probe of probes) {
            try {
                const pos = this.view.posAtDOM(probe, 0);
                const lineNumber = doc.lineAt(pos).number;
                if (lineNumber >= 1 && lineNumber <= doc.lines) {
                    return lineNumber;
                }
            } catch {
                // Try next probe node.
            }
        }

        return null;
    }

    private safeCoordsAtPos(pos: number, side: -1 | 1): ReturnType<EditorView['coordsAtPos']> | null {
        try {
            return this.view.coordsAtPos(pos, side);
        } catch {
            return null;
        }
    }
}
