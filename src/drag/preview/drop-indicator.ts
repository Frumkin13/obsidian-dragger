import { EditorView } from '@codemirror/view';
import { DragSource } from '../../shared/types/drag';
import { DropPlan } from '../../shared/types/protocol-types';
import { DropValidationResult } from '../drop/drop-planner';
import { DROP_INDICATOR_CLASS, DROP_HIGHLIGHT_CLASS, HIDDEN_CLASS } from '../../shared/dom-selectors';

type DropValidationResolver = (info: {
    clientX: number;
    clientY: number;
    dragSource: DragSource | null;
    pointerType: string | null;
}) => DropValidationResult;

interface DropIndicatorManagerOptions {
    isDropHighlightEnabled?: () => boolean;
    onFrameMetrics?: (metrics: {
        evaluated: boolean;
        skipped: boolean;
        reused: boolean;
        durationMs: number;
    }) => void;
    recordPerfDuration?: (key: 'drop_indicator_resolve', durationMs: number) => void;
    onDropTargetEvaluated?: (info: {
        source: DragSource | null;
        pointerType: string | null;
        validation: DropValidationResult;
    }) => void;
}

export class DropIndicatorManager {
    private static readonly instances = new Set<DropIndicatorManager>();
    private readonly indicatorEl: HTMLDivElement;
    private readonly highlightEl: HTMLDivElement;
    private pendingDragInfo: { x: number; y: number; dragSource: DragSource | null; pointerType: string | null } | null = null;
    private rafId: number | null = null;
    private lastEvaluatedInput: { x: number; y: number; dragSource: DragSource | null; pointerType: string | null } | null = null;
    private lastDropPlan: DropPlan | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly resolveDropValidation: DropValidationResolver,
        private readonly options?: DropIndicatorManagerOptions
    ) {
        DropIndicatorManager.instances.add(this);
        this.indicatorEl = document.createElement('div');
        this.indicatorEl.className = `${DROP_INDICATOR_CLASS} ${HIDDEN_CLASS}`;
        document.body.appendChild(this.indicatorEl);

        this.highlightEl = document.createElement('div');
        this.highlightEl.className = `${DROP_HIGHLIGHT_CLASS} ${HIDDEN_CLASS}`;
        document.body.appendChild(this.highlightEl);
    }

    scheduleFromPoint(clientX: number, clientY: number, dragSource: DragSource | null, pointerType: string | null): void {
        this.pendingDragInfo = { x: clientX, y: clientY, dragSource, pointerType };
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            const pending = this.pendingDragInfo;
            if (!pending) return;
            this.updateFromPoint(pending);
        });
    }

    hide(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingDragInfo = null;
        this.lastEvaluatedInput = null;
        this.lastDropPlan = null;
        this.indicatorEl.classList.add(HIDDEN_CLASS);
        this.highlightEl.classList.add(HIDDEN_CLASS);
    }

    destroy(): void {
        this.hide();
        this.indicatorEl.remove();
        this.highlightEl.remove();
        DropIndicatorManager.instances.delete(this);
    }

    private updateFromPoint(info: { x: number; y: number; dragSource: DragSource | null; pointerType: string | null }): void {
        if (this.shouldReuseLastResult(info)) {
            const reused = this.lastDropPlan !== null;
            if (this.lastDropPlan) {
                this.renderDropPlan(this.lastDropPlan);
            } else {
                this.indicatorEl.classList.add(HIDDEN_CLASS);
                this.highlightEl.classList.add(HIDDEN_CLASS);
            }
            this.options?.onFrameMetrics?.({
                evaluated: false,
                skipped: true,
                reused,
                durationMs: 0,
            });
            return;
        }

        const startedAt = this.now();
        const validation = this.resolveDropValidation({
            clientX: info.x,
            clientY: info.y,
            dragSource: info.dragSource,
            pointerType: info.pointerType,
        });
        const dropPlan = validation.allowed ? validation.plan ?? null : null;
        const durationMs = this.now() - startedAt;
        this.options?.recordPerfDuration?.('drop_indicator_resolve', durationMs);
        this.options?.onDropTargetEvaluated?.({
            source: info.dragSource,
            pointerType: info.pointerType,
            validation,
        });
        this.options?.onFrameMetrics?.({
            evaluated: true,
            skipped: false,
            reused: false,
            durationMs,
        });
        this.lastEvaluatedInput = { ...info };
        this.lastDropPlan = dropPlan;
        if (!dropPlan) {
            this.indicatorEl.classList.add(HIDDEN_CLASS);
            this.highlightEl.classList.add(HIDDEN_CLASS);
            return;
        }
        this.renderDropPlan(dropPlan);
    }

    private renderDropPlan(dropPlan: DropPlan): void {
        this.hideOtherInstancesVisuals();
        const editorRect = this.view.dom.getBoundingClientRect();
        const indicatorY = dropPlan.preview.indicatorY;
        const indicatorLeft = dropPlan.preview.lineRect ? dropPlan.preview.lineRect.left : editorRect.left + 35;
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const contentPaddingRight = parseFloat(getComputedStyle(this.view.contentDOM).paddingRight) || 0;
        const indicatorRight = contentRect.right - contentPaddingRight;
        const indicatorWidth = Math.max(8, indicatorRight - indicatorLeft);

        this.indicatorEl.classList.remove(HIDDEN_CLASS);
        this.indicatorEl.setCssStyles({
            top: `${indicatorY}px`,
            left: `${indicatorLeft}px`,
            width: `${indicatorWidth}px`,
        });

        if (dropPlan.preview.highlightRect && this.options?.isDropHighlightEnabled?.() !== false) {
            this.highlightEl.classList.remove(HIDDEN_CLASS);
            this.highlightEl.setCssStyles({
                top: `${dropPlan.preview.highlightRect.top}px`,
                left: `${dropPlan.preview.highlightRect.left}px`,
                width: `${dropPlan.preview.highlightRect.width}px`,
                height: `${dropPlan.preview.highlightRect.height}px`,
            });
        } else {
            this.highlightEl.classList.add(HIDDEN_CLASS);
        }
    }

    private hideOtherInstancesVisuals(): void {
        for (const instance of DropIndicatorManager.instances) {
            if (instance === this) continue;
            instance.hide();
        }
    }

    private shouldReuseLastResult(info: { x: number; y: number; dragSource: DragSource | null; pointerType: string | null }): boolean {
        if (!this.lastEvaluatedInput) return false;
        if (this.lastEvaluatedInput.pointerType !== info.pointerType) return false;
        if (!this.isSameSource(this.lastEvaluatedInput.dragSource, info.dragSource)) return false;
        const dx = Math.abs(this.lastEvaluatedInput.x - info.x);
        const dy = Math.abs(this.lastEvaluatedInput.y - info.y);
        return dx + dy < 2;
    }

    private isSameSource(a: DragSource | null, b: DragSource | null): boolean {
        if (a === b) return true;
        if (!a || !b) return false;
        if (a.primaryBlock.type !== b.primaryBlock.type) return false;
        if (a.primaryBlock.startLine !== b.primaryBlock.startLine) return false;
        if (a.primaryBlock.endLine !== b.primaryBlock.endLine) return false;
        if (a.ranges.length !== b.ranges.length) return false;
        return a.ranges.every((range, index) => (
            range.startLine === b.ranges[index].startLine
            && range.endLine === b.ranges[index].endLine
        ));
    }

    private now(): number {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }
}
