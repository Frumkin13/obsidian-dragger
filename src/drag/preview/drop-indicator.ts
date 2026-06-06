import { EditorView } from '@codemirror/view';
import { DragSource } from '../../shared/types/drag';
import { DropPlan } from '../../shared/types/protocol-types';
import type { DropResult } from '../drop';
import { DROP_INDICATOR_CLASS, DROP_HIGHLIGHT_CLASS, HIDDEN_CLASS } from '../../shared/dom-selectors';

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
        validation: DropResult;
    }) => void;
}

export class DropIndicatorManager {
    private static readonly instances = new Set<DropIndicatorManager>();
    private readonly indicatorEl: HTMLDivElement;
    private readonly highlightEl: HTMLDivElement;
    private pendingDragInfo: { validation: DropResult; dragSource: DragSource | null; pointerType: string | null } | null = null;
    private rafId: number | null = null;
    private lastDropPlan: DropPlan | null = null;

    constructor(
        private readonly view: EditorView,
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

    scheduleRender(validation: DropResult, dragSource: DragSource | null, pointerType: string | null): void {
        this.pendingDragInfo = { validation, dragSource, pointerType };
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            const pending = this.pendingDragInfo;
            if (!pending) return;
            this.renderValidation(pending);
        });
    }

    hide(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingDragInfo = null;
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

    private renderValidation(info: { validation: DropResult; dragSource: DragSource | null; pointerType: string | null }): void {
        const validation = info.validation;
        const dropPlan = validation.allowed ? validation.plan ?? null : null;
        this.options?.onDropTargetEvaluated?.({
            source: info.dragSource,
            pointerType: info.pointerType,
            validation,
        });
        this.options?.onFrameMetrics?.({
            evaluated: true,
            skipped: false,
            reused: false,
            durationMs: 0,
        });
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
}
