import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../core/block/block-types';
import type { LineRange } from '../../../shared/types/line-range';
import { getLineNumberElementForLine, hasVisibleLineNumberGutter } from './line-number-gutter';
import {
    DRAG_HANDLE_CLASS,
    DRAG_SOURCE_LINE_CLASS,
    DRAG_SOURCE_LINE_SINGLE_CLASS,
    DRAG_SOURCE_LINE_FIRST_CLASS,
    DRAG_SOURCE_LINE_MIDDLE_CLASS,
    DRAG_SOURCE_LINE_LAST_CLASS,
    DRAG_SOURCE_EMBED_CLASS,
    HOVER_HIDDEN_LINE_NUMBER_CLASS,
    GRAB_HIDDEN_LINE_NUMBER_CLASS,
} from '../../../shared/dom-selectors';
import { HANDLE_INTERACTION_ZONE_PX } from '../../../shared/constants';
import { getMainContentLineElementForLine } from '../probe/line-dom';
import {
    resolveLineNumberFromBlockStartAttribute,
    resolveLineNumberFromDomNodes,
} from '../probe/element-probe';
import { mergeLineRanges, isLineNumberInRanges } from '../../../shared/utils/line-range';
import { collectEmbedRoots } from '../probe/embed-probe';

export interface HandleVisibilityDeps {
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    getDraggableBlockAtPoint: (clientX: number, clientY: number) => BlockInfo | null;
}

type GrabLineRange = {
    startLineNumber: number;
    endLineNumber: number;
};

const DRAG_SOURCE_LINE_VARIANT_CLASSES = [
    DRAG_SOURCE_LINE_SINGLE_CLASS,
    DRAG_SOURCE_LINE_FIRST_CLASS,
    DRAG_SOURCE_LINE_MIDDLE_CLASS,
    DRAG_SOURCE_LINE_LAST_CLASS,
] as const;

export class HandleVisibilityController {
    private hiddenHoveredLineNumberEl: HTMLElement | null = null;
    private currentHoveredLineNumber: number | null = null;
    private readonly hiddenGrabbedLineNumberEls = new Set<HTMLElement>();
    private readonly grabbedLineEls = new Set<HTMLElement>();
    private readonly grabbedEmbedEls = new Set<HTMLElement>();
    private grabbedLineRanges: GrabLineRange[] = [];
    private activeHandle: HTMLElement | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly deps: HandleVisibilityDeps
    ) { }

    getActiveHandle(): HTMLElement | null {
        return this.activeHandle;
    }

    clearHoveredLineNumber(): void {
        if (this.hiddenHoveredLineNumberEl) {
            this.hiddenHoveredLineNumberEl.classList.remove(HOVER_HIDDEN_LINE_NUMBER_CLASS);
        }
        this.hiddenHoveredLineNumberEl = null;
        this.currentHoveredLineNumber = null;
    }

    clearGrabbedLineNumbers(): void {
        this.clearGrabbedLineVisualClasses();
        this.grabbedLineRanges = [];
    }

    refreshGrabVisualState(): void {
        if (this.grabbedLineRanges.length === 0) return;
        this.clearGrabbedLineVisualClasses();
        this.applyGrabbedLineVisualState();
    }

    setGrabbedLineNumberRange(startLineNumber: number, endLineNumber: number): void {
        this.setGrabbedLineRanges([{ startLineNumber, endLineNumber }]);
    }

    enterGrabVisualStateForBlock(
        blockInfo: BlockInfo,
        handle: HTMLElement | null
    ): void {
        this.setActiveVisibleHandle(
            handle,
            { preserveHoveredLineNumber: true }
        );
        this.clearHoveredLineNumber();
        this.setGrabbedLineRanges(this.resolveGrabLineRanges(blockInfo));
    }

    setActiveVisibleHandle(
        handle: HTMLElement | null,
        options?: { preserveHoveredLineNumber?: boolean }
    ): void {
        const preserveHoveredLineNumber = options?.preserveHoveredLineNumber === true;
        if (this.activeHandle === handle) {
            if (!handle && !preserveHoveredLineNumber) {
                this.clearHoveredLineNumber();
            }
            return;
        }
        if (this.activeHandle) {
            this.activeHandle.classList.remove('is-visible');
        }

        this.activeHandle = handle;
        if (!handle) {
            if (!preserveHoveredLineNumber) {
                this.clearHoveredLineNumber();
            }
            return;
        }

        handle.classList.add('is-visible');
        if (!preserveHoveredLineNumber) {
            const lineNumber = this.resolveHandleLineNumber(handle);
            if (!lineNumber) {
                this.clearHoveredLineNumber();
                return;
            }
            this.setHoveredLineNumber(lineNumber);
        }
    }

    enterGrabVisualState(
        startLineNumber: number,
        endLineNumber: number,
        handle: HTMLElement | null
    ): void {
        this.setActiveVisibleHandle(
            handle,
            { preserveHoveredLineNumber: true }
        );
        this.clearHoveredLineNumber();
        this.setGrabbedLineNumberRange(startLineNumber, endLineNumber);
    }

    isPointerInHandleInteractionZone(clientX: number, clientY: number): boolean {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (clientY < contentRect.top || clientY > contentRect.bottom) return false;
        const leftBound = contentRect.left - HANDLE_INTERACTION_ZONE_PX;
        const rightBound = contentRect.left + HANDLE_INTERACTION_ZONE_PX;
        return clientX >= leftBound && clientX <= rightBound;
    }

    resolveVisibleHandleFromTarget(target: EventTarget | null): HTMLElement | null {
        if (!(target instanceof HTMLElement)) return null;

        const directHandle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
        if (!directHandle) return null;
        if (this.view.dom.contains(directHandle)) {
            return directHandle;
        }
        return null;
    }

    resolveVisibleHandleFromPointerWhenLineNumbersHidden(clientX: number, clientY: number): HTMLElement | null {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (
            clientX < contentRect.left
            || clientX > contentRect.right
            || clientY < contentRect.top
            || clientY > contentRect.bottom
        ) {
            return null;
        }

        const blockInfo = this.deps.getDraggableBlockAtPoint(clientX, clientY);
        if (!blockInfo) return null;
        return this.resolveVisibleHandleForBlock(blockInfo);
    }

    resolveHandleLineNumber(handle: HTMLElement): number | null {
        const lineNumberFromAttr = resolveLineNumberFromBlockStartAttribute(this.view, handle);
        if (lineNumberFromAttr !== null) return lineNumberFromAttr;

        const blockInfo = this.deps.getBlockInfoForHandle(handle);
        if (!blockInfo) return null;
        const lineNumber = blockInfo.startLine + 1;
        if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
            return null;
        }
        return lineNumber;
    }

    private clearGrabbedLineVisualClasses(): void {
        for (const lineNumberEl of this.hiddenGrabbedLineNumberEls) {
            lineNumberEl.classList.remove(GRAB_HIDDEN_LINE_NUMBER_CLASS);
        }
        this.hiddenGrabbedLineNumberEls.clear();
        for (const lineEl of this.grabbedLineEls) {
            lineEl.classList.remove(DRAG_SOURCE_LINE_CLASS);
            lineEl.classList.remove(...DRAG_SOURCE_LINE_VARIANT_CLASSES);
        }
        this.grabbedLineEls.clear();
        for (const embedEl of this.grabbedEmbedEls) {
            embedEl.classList.remove(DRAG_SOURCE_EMBED_CLASS);
        }
        this.grabbedEmbedEls.clear();
    }

    private setGrabbedLineRanges(ranges: GrabLineRange[]): void {
        this.clearGrabbedLineVisualClasses();
        this.grabbedLineRanges = this.normalizeGrabLineRanges(ranges);
        this.applyGrabbedLineVisualState();
    }

    private applyGrabbedLineVisualState(): void {
        if (this.grabbedLineRanges.length === 0) return;
        const hasGutter = hasVisibleLineNumberGutter(this.view);
        for (const range of this.grabbedLineRanges) {
            const safeStart = Math.max(1, Math.min(this.view.state.doc.lines, range.startLineNumber));
            const safeEnd = Math.max(1, Math.min(this.view.state.doc.lines, range.endLineNumber));
            const from = Math.min(safeStart, safeEnd);
            const to = Math.max(safeStart, safeEnd);
            for (let lineNumber = from; lineNumber <= to; lineNumber++) {
                if (hasGutter) {
                    const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
                    if (lineNumberEl) {
                        lineNumberEl.classList.add(GRAB_HIDDEN_LINE_NUMBER_CLASS);
                        this.hiddenGrabbedLineNumberEls.add(lineNumberEl);
                    }
                }
                const lineEl = getMainContentLineElementForLine(this.view, lineNumber);
                if (!lineEl) continue;
                lineEl.classList.add(
                    DRAG_SOURCE_LINE_CLASS,
                    this.getDragSourceLineVariantClass(lineNumber, from, to)
                );
                this.grabbedLineEls.add(lineEl);
            }
        }
        this.applyGrabbedEmbedVisualState();
    }

    private getDragSourceLineVariantClass(lineNumber: number, from: number, to: number): string {
        if (from === to) return DRAG_SOURCE_LINE_SINGLE_CLASS;
        if (lineNumber === from) return DRAG_SOURCE_LINE_FIRST_CLASS;
        if (lineNumber === to) return DRAG_SOURCE_LINE_LAST_CLASS;
        return DRAG_SOURCE_LINE_MIDDLE_CLASS;
    }

    private resolveGrabLineRanges(blockInfo: BlockInfo): GrabLineRange[] {
        const composite = blockInfo.compositeSelection?.ranges ?? [];
        if (composite.length === 0) {
            return [{
                startLineNumber: blockInfo.startLine + 1,
                endLineNumber: blockInfo.endLine + 1,
            }];
        }
        return composite.map((range) => ({
            startLineNumber: range.startLine + 1,
            endLineNumber: range.endLine + 1,
        }));
    }

    private applyGrabbedEmbedVisualState(): void {
        const root = this.view.dom;
        if (!(root instanceof HTMLElement)) return;
        for (const embed of collectEmbedRoots(this.view, { normalizeToEmbedRoot: true })) {
            const lineNumber = this.resolveEmbedLineNumber(embed);
            if (lineNumber === null) continue;
            if (!this.isLineNumberInGrabRanges(lineNumber)) continue;
            embed.classList.add(DRAG_SOURCE_EMBED_CLASS);
            this.grabbedEmbedEls.add(embed);
        }
    }

    private resolveEmbedLineNumber(embed: HTMLElement): number | null {
        const probes: Array<Node | null> = [embed];
        if (embed.firstChild) probes.push(embed.firstChild);
        if (embed.parentElement) probes.push(embed.parentElement);
        if (embed.parentElement?.firstChild) probes.push(embed.parentElement.firstChild);
        return resolveLineNumberFromDomNodes(this.view, probes);
    }

    private isLineNumberInGrabRanges(lineNumber: number): boolean {
        return isLineNumberInRanges(lineNumber, this.grabbedLineRanges as LineRange[]);
    }

    private normalizeGrabLineRanges(ranges: GrabLineRange[]): GrabLineRange[] {
        const docLines = this.view.state.doc.lines;
        const merged = mergeLineRanges(docLines, ranges as LineRange[]);
        return merged.map((range) => ({
            startLineNumber: range.startLineNumber,
            endLineNumber: range.endLineNumber,
        }));
    }

    private resolveVisibleHandleForBlock(blockInfo: BlockInfo): HTMLElement | null {
        const selector = `.${DRAG_HANDLE_CLASS}[data-block-start="${blockInfo.startLine}"]`;
        const candidates = Array.from(this.view.dom.querySelectorAll<HTMLElement>(selector));
        if (candidates.length === 0) return null;

        return candidates[0] ?? null;
    }

    private setHoveredLineNumber(lineNumber: number): void {
        if (this.currentHoveredLineNumber === lineNumber && this.hiddenHoveredLineNumberEl) {
            return;
        }
        const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
        if (!lineNumberEl) {
            this.clearHoveredLineNumber();
            return;
        }
        this.clearHoveredLineNumber();
        lineNumberEl.classList.add(HOVER_HIDDEN_LINE_NUMBER_CLASS);
        this.hiddenHoveredLineNumberEl = lineNumberEl;
        this.currentHoveredLineNumber = lineNumber;
    }
}
