import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../core/block/block-types';
import { validateInPlaceDrop } from '../../core/container-rules/drop-validation';
import { InsertionRuleRejectReason, InsertionSlotContext } from '../../core/container-rules/insertion-rules';
import { getLineMap, LineMap } from '../../core/parser/line-map';
import {
    createGeometryFrameCache,
    GeometryFrameCache,
    getCoordsAtPos,
} from './rect-calculator';
import { DocLike, DropTargetInfo, ListContext, ParsedLine } from '../../shared/types/protocol-types';
import { findEmbedElementAtPoint } from '../ui/probe/embed-probe';
import { resolveLineNumberAtCoords } from '../ui/probe/element-probe';
import { isPointInsideRenderedTableCell } from '../ui/probe/table-guard';
import { clampTargetLineNumber } from '../../shared/utils/line-target-number';
import {
    getLineNumberAtViewportY,
    getLineNumberElementForLine,
} from '../ui/handle/handle-positioner';
import { getRenderedMainLineNumberAtPoint } from '../ui/probe/line-hit';
import { getMainContentLineRectForLine } from '../ui/probe/line-dom';
import { DragSourceScope } from '../../shared/types/drag';
import { ListDropTargetCalculatorPort } from './list-drop-target-calculator-port';

type PerfDurationKey =
    | 'resolve_total'
    | 'vertical'
    | 'container'
    | 'list_target'
    | 'in_place'
    | 'geometry';

export interface DropTargetCalculatorDeps {
    parseLineWithQuote: (line: string) => ParsedLine;
    getAdjustedTargetLocation: (
        lineNumber: number,
        options?: { clientY?: number; frameCache?: GeometryFrameCache }
    ) => { lineNumber: number; blockAdjusted: boolean };
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options?: { lineMap?: LineMap }
    ) => {
        slotContext: InsertionSlotContext;
        decision: { allowDrop: boolean; rejectReason?: string | null };
    };
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    getBlockInfoForEmbed: (embedEl: HTMLElement) => BlockInfo | null;
    getIndentUnitWidthForDoc: (doc: DocLike) => number;
    getLineRect: (lineNumber: number, frameCache?: GeometryFrameCache) => { left: number; width: number } | undefined;
    getInsertionAnchorY: (lineNumber: number, frameCache?: GeometryFrameCache) => number | null;
    getLineIndentPosByWidth: (lineNumber: number, targetIndentWidth: number) => number | null;
    getBlockRect: (
        startLineNumber: number,
        endLineNumber: number,
        frameCache?: GeometryFrameCache
    ) => { top: number; left: number; width: number; height: number } | undefined;
    listDropTargetCalculator: ListDropTargetCalculatorPort;
    onDragTargetEvaluated?: (info: {
        sourceBlock: BlockInfo | null;
        pointerType: string | null;
        validation: DropValidationResult;
    }) => void;
    recordPerfDuration?: (key: PerfDurationKey, durationMs: number) => void;
    incrementPerfCounter?: (
        key:
            | 'resolve_cache_hits'
            | 'resolve_cache_misses'
            | 'list_ancestor_scan_steps'
            | 'list_parent_scan_steps'
            | 'highlight_scan_lines',
        delta?: number
    ) => void;
}

export type DropRejectReason =
    | 'table_cell'
    | 'no_target'
    | 'no_anchor'
    | 'self_range_blocked'
    | 'self_embedding'
    | InsertionRuleRejectReason
    | 'container_policy';

export type DropValidationResult = {
    allowed: boolean;
    reason?: DropRejectReason;
    targetLineNumber?: number;
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
    indicatorY?: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
};

export type DropTargetCalculatorSharedDeps = Omit<DropTargetCalculatorDeps, 'listDropTargetCalculator'>;

export class DropTargetCalculator {
    private readonly listDropTargetCalculator: ListDropTargetCalculatorPort;
    private lastResolvedCache: {
        state: unknown;
        key: string;
        result: DropValidationResult;
    } | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly deps: DropTargetCalculatorDeps
    ) {
        this.listDropTargetCalculator = this.deps.listDropTargetCalculator;
    }

    getDropTargetInfo(info: {
        clientX: number;
        clientY: number;
        dragSource?: BlockInfo | null;
        pointerType?: string | null;
        sourceScope?: DragSourceScope;
    }): DropTargetInfo | null {
        const validated = this.resolveValidatedDropTarget(info);
        if (!validated.allowed || typeof validated.targetLineNumber !== 'number' || typeof validated.indicatorY !== 'number') {
            return null;
        }
        return {
            lineNumber: validated.targetLineNumber,
            indicatorY: validated.indicatorY,
            listContextLineNumber: validated.listContextLineNumber,
            listIndentDelta: validated.listIndentDelta,
            listTargetIndentWidth: validated.listTargetIndentWidth,
            lineRect: validated.lineRect,
            highlightRect: validated.highlightRect,
        };
    }

    resolveValidatedDropTarget(info: {
        clientX: number;
        clientY: number;
        dragSource?: BlockInfo | null;
        pointerType?: string | null;
        sourceScope?: DragSourceScope;
    }): DropValidationResult {
        const startedAt = this.now();
        const dragSource = info.dragSource ?? null;
        const pointerType = info.pointerType ?? null;
        const sourceScope = info.sourceScope ?? 'same_editor';
        const cacheKey = this.buildResolveCacheKey(info.clientX, info.clientY, dragSource, pointerType, sourceScope);
        if (
            this.lastResolvedCache
            && this.lastResolvedCache.state === this.view.state
            && this.lastResolvedCache.key === cacheKey
        ) {
            this.deps.incrementPerfCounter?.('resolve_cache_hits', 1);
            const cached = this.lastResolvedCache.result;
            this.deps.onDragTargetEvaluated?.({
                sourceBlock: dragSource,
                pointerType,
                validation: cached,
            });
            this.deps.recordPerfDuration?.('resolve_total', this.now() - startedAt);
            return cached;
        }
        this.deps.incrementPerfCounter?.('resolve_cache_misses', 1);

        const frameCache = createGeometryFrameCache();
        const lineMap = getLineMap(this.view.state);

        const result = this.resolveValidatedDropTargetInternal({
            info,
            dragSource,
            sourceScope,
            frameCache,
            lineMap,
        });
        this.lastResolvedCache = {
            state: this.view.state,
            key: cacheKey,
            result,
        };
        this.deps.recordPerfDuration?.('resolve_total', this.now() - startedAt);
        this.deps.onDragTargetEvaluated?.({
            sourceBlock: dragSource,
            pointerType,
            validation: result,
        });
        return result;
    }

    private resolveValidatedDropTargetInternal(params: {
        info: {
            clientX: number;
            clientY: number;
            dragSource?: BlockInfo | null;
            pointerType?: string | null;
            sourceScope?: DragSourceScope;
        };
        dragSource: BlockInfo | null;
        sourceScope: DragSourceScope;
        frameCache: GeometryFrameCache;
        lineMap: ReturnType<typeof getLineMap>;
    }): DropValidationResult {
        const { info, dragSource, sourceScope, frameCache, lineMap } = params;

        if (isPointInsideRenderedTableCell(this.view, info.clientX, info.clientY)) {
            return { allowed: false, reason: 'table_cell' } as const;
        }

        const embedEl = this.getEmbedElementAtPoint(info.clientX, info.clientY);
        if (embedEl) {
            const block = this.deps.getBlockInfoForEmbed(embedEl);
            if (block) {
                const rect = embedEl.getBoundingClientRect();
                const showAtBottom = info.clientY > rect.top + rect.height / 2;
                const lineNumber = clampTargetLineNumber(
                    this.view.state.doc.lines,
                    showAtBottom ? block.endLine + 2 : block.startLine + 1
                );
                const containerRule = this.resolveContainerRule(dragSource, lineNumber, lineMap);
                if (containerRule.rejectReason) {
                    return {
                        allowed: false,
                        reason: containerRule.rejectReason,
                    };
                }

                const inPlaceRejectReason = this.getInPlaceRejectReason({
                    dragSource,
                    sourceScope,
                    targetLineNumber: lineNumber,
                    slotContext: containerRule.slotContext,
                    lineMap,
                });
                if (inPlaceRejectReason) {
                    return {
                        allowed: false,
                        reason: inPlaceRejectReason,
                    };
                }

                const indicatorY = showAtBottom ? rect.bottom : rect.top;
                return {
                    allowed: true,
                    targetLineNumber: lineNumber,
                    indicatorY,
                    lineRect: { left: rect.left, width: rect.width },
                };
            }
        }

        const verticalStartedAt = this.now();
        const vertical = this.computeVerticalTarget(info, dragSource, frameCache);
        this.deps.recordPerfDuration?.('vertical', this.now() - verticalStartedAt);
        if (!vertical) {
            return { allowed: false, reason: 'no_target' } as const;
        }

        const containerRule = this.resolveContainerRule(dragSource, vertical.targetLineNumber, lineMap);
        if (containerRule.rejectReason) {
            return {
                allowed: false,
                reason: containerRule.rejectReason,
            };
        }

        const listStartedAt = this.now();
        const listTarget = this.listDropTargetCalculator.computeListTarget({
            targetLineNumber: vertical.targetLineNumber,
            lineNumber: vertical.line.number,
            forcedLineNumber: vertical.forcedLineNumber,
            childIntentOnLine: vertical.childIntentOnLine,
            dragSource,
            sourceScope,
            clientX: info.clientX,
            frameCache,
            lineMap,
        });
        this.deps.recordPerfDuration?.('list_target', this.now() - listStartedAt);

        const inPlaceRejectReason = this.getInPlaceRejectReason({
            dragSource,
            sourceScope,
            targetLineNumber: vertical.targetLineNumber,
            slotContext: containerRule.slotContext,
            listContextLineNumberOverride: listTarget.listContextLineNumber,
            listIndentDeltaOverride: listTarget.listIndentDelta,
            listTargetIndentWidthOverride: listTarget.listTargetIndentWidth,
            lineMap,
        });
        if (inPlaceRejectReason) {
            return {
                allowed: false,
                reason: inPlaceRejectReason,
            };
        }

        const geometryStartedAt = this.now();
        const indicatorY = this.deps.getInsertionAnchorY(vertical.targetLineNumber, frameCache);
        if (indicatorY === null) {
            this.deps.recordPerfDuration?.('geometry', this.now() - geometryStartedAt);
            return { allowed: false, reason: 'no_anchor' } as const;
        }

        const lineRectSourceLineNumber = listTarget.lineRectSourceLineNumber
            ?? vertical.lineRectSourceLineNumber;
        let lineRect = this.deps.getLineRect(lineRectSourceLineNumber, frameCache);
        if (typeof listTarget.listTargetIndentWidth === 'number') {
            const indentPos = this.deps.getLineIndentPosByWidth(lineRectSourceLineNumber, listTarget.listTargetIndentWidth);
            if (indentPos !== null) {
                const start = getCoordsAtPos(this.view, indentPos, frameCache);
                const end = getCoordsAtPos(this.view, this.view.state.doc.line(lineRectSourceLineNumber).to, frameCache);
                if (start && end) {
                    const left = start.left;
                    const width = Math.max(8, (end.right ?? end.left) - left);
                    lineRect = { left, width };
                }
            }
        }
        this.deps.recordPerfDuration?.('geometry', this.now() - geometryStartedAt);

        return {
            allowed: true,
            targetLineNumber: vertical.targetLineNumber,
            indicatorY,
            listContextLineNumber: listTarget.listContextLineNumber,
            listIndentDelta: listTarget.listIndentDelta,
            listTargetIndentWidth: listTarget.listTargetIndentWidth,
            lineRect,
            highlightRect: listTarget.highlightRect,
        };
    }

    private resolveContainerRule(
        dragSource: BlockInfo | null,
        targetLineNumber: number,
        lineMap: LineMap
    ): {
        slotContext: InsertionSlotContext | null;
        rejectReason: DropRejectReason | null;
    } {
        const containerStartedAt = this.now();
        const containerRule = dragSource
            ? this.deps.resolveDropRuleAtInsertion(dragSource, targetLineNumber, { lineMap })
            : null;
        this.deps.recordPerfDuration?.('container', this.now() - containerStartedAt);
        if (!containerRule) {
            return { slotContext: null, rejectReason: null };
        }
        if (containerRule.decision.allowDrop) {
            return { slotContext: containerRule.slotContext, rejectReason: null };
        }
        return {
            slotContext: containerRule.slotContext,
            rejectReason: (containerRule.decision.rejectReason ?? 'container_policy') as DropRejectReason,
        };
    }

    private getInPlaceRejectReason(params: {
        dragSource: BlockInfo | null;
        sourceScope: DragSourceScope;
        targetLineNumber: number;
        slotContext: InsertionSlotContext | null;
        lineMap: LineMap;
        listContextLineNumberOverride?: number;
        listIndentDeltaOverride?: number;
        listTargetIndentWidthOverride?: number;
    }): DropRejectReason | null {
        const {
            dragSource,
            sourceScope,
            targetLineNumber,
            slotContext,
            lineMap,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride,
        } = params;

        if (!dragSource || sourceScope === 'cross_editor') return null;
        const inPlaceStartedAt = this.now();
        const inPlaceValidation = validateInPlaceDrop({
            doc: this.view.state.doc,
            sourceBlock: dragSource,
            targetLineNumber,
            parseLineWithQuote: this.deps.parseLineWithQuote,
            getListContext: this.deps.getListContext,
            getIndentUnitWidth: this.deps.getIndentUnitWidth,
            slotContext: slotContext ?? undefined,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride,
            lineMap,
        });
        this.deps.recordPerfDuration?.('in_place', this.now() - inPlaceStartedAt);
        if (inPlaceValidation.inSelfRange && !inPlaceValidation.allowInPlaceIndentChange) {
            return inPlaceValidation.rejectReason ?? 'self_range_blocked';
        }
        if (!inPlaceValidation.inSelfRange && inPlaceValidation.rejectReason) {
            return inPlaceValidation.rejectReason as DropRejectReason;
        }
        return null;
    }

    private computeVerticalTarget(
        info: { clientX: number; clientY: number },
        dragSource: BlockInfo | null,
        frameCache: GeometryFrameCache
    ): {
        line: { number: number; text: string; from: number; to: number };
        targetLineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        lineRectSourceLineNumber: number;
    } | null {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        let lineNumber: number | null = getRenderedMainLineNumberAtPoint(this.view, info.clientX, info.clientY);
        if (lineNumber === null) {
            lineNumber = resolveLineNumberAtCoords(this.view, info.clientX, info.clientY, contentRect);
            if (lineNumber === null) return null;
        }

        let line = this.view.state.doc.line(lineNumber);
        const gutterLineNumber = getLineNumberAtViewportY(this.view, info.clientY);
        if (gutterLineNumber !== null && gutterLineNumber !== line.number) {
            line = this.view.state.doc.line(gutterLineNumber);
        }
        const allowListChildIntent = !!dragSource && dragSource.type === BlockType.ListItem;
        const lineBoundsForSnap = this.listDropTargetCalculator.getListMarkerBounds(line.number, { frameCache });
        const lineParsedForSnap = this.deps.parseLineWithQuote(line.text);
        const childIntentOnLine = allowListChildIntent
            && !!lineBoundsForSnap
            && lineParsedForSnap.isListItem
            && info.clientX >= lineBoundsForSnap.contentStartX + 2;

        const adjustedTarget = this.deps.getAdjustedTargetLocation(line.number, {
            clientY: info.clientY,
            frameCache,
        });
        let forcedLineNumber: number | null = adjustedTarget.blockAdjusted ? adjustedTarget.lineNumber : null;

        let showAtBottom = false;
        if (!forcedLineNumber) {
            const isBlankLine = line.text.trim().length === 0;
            if (isBlankLine) {
                const visualMidY = this.getVisualLineMidY(line.number, line.from);
                if (visualMidY !== null) {
                    forcedLineNumber = info.clientY > visualMidY
                        ? line.number + 1
                        : line.number;
                } else {
                    const lineStart = getCoordsAtPos(this.view, line.from, frameCache);
                    const lineEnd = getCoordsAtPos(this.view, line.to, frameCache);
                    if (lineStart && lineEnd) {
                        const midY = (lineStart.top + lineEnd.bottom) / 2;
                        forcedLineNumber = info.clientY > midY
                            ? line.number + 1
                            : line.number;
                    } else {
                        forcedLineNumber = line.number;
                    }
                }
            } else {
                showAtBottom = true;
                const visualMidY = this.getVisualLineMidY(line.number, line.from);
                if (visualMidY !== null) {
                    showAtBottom = info.clientY > visualMidY;
                } else {
                    const lineStart = getCoordsAtPos(this.view, line.from, frameCache);
                    const lineEnd = getCoordsAtPos(this.view, line.to, frameCache);
                    if (lineStart && lineEnd) {
                        const midY = (lineStart.top + lineEnd.bottom) / 2;
                        showAtBottom = info.clientY > midY;
                    }
                }
            }
        }

        let targetLineNumber = clampTargetLineNumber(
            this.view.state.doc.lines,
            forcedLineNumber ?? (showAtBottom ? line.number + 1 : line.number)
        );
        if (!forcedLineNumber && childIntentOnLine && !showAtBottom) {
            targetLineNumber = clampTargetLineNumber(this.view.state.doc.lines, line.number + 1);
        }

        return {
            line,
            targetLineNumber,
            forcedLineNumber,
            childIntentOnLine,
            lineRectSourceLineNumber: line.number,
        };
    }

    private getVisualLineMidY(lineNumber: number, lineFromPos: number): number | null {
        const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
        if (lineNumberEl) {
            const lineNumberRect = lineNumberEl.getBoundingClientRect();
            if (lineNumberRect.height > 0) {
                return lineNumberRect.top + lineNumberRect.height / 2;
            }
        }

        const lineRect = getMainContentLineRectForLine(this.view, lineNumber);
        if (lineRect) return (lineRect.top + lineRect.bottom) / 2;

        if (typeof this.view.domAtPos !== 'function') return null;
        try {
            const domAtPos = this.view.domAtPos(lineFromPos);
            const base = domAtPos.node.nodeType === Node.TEXT_NODE
                ? domAtPos.node.parentElement
                : domAtPos.node;
            if (!(base instanceof Element)) return null;
            const lineEl = base.closest<HTMLElement>('.cm-line');
            if (!lineEl) return null;
            if (!this.view.contentDOM.contains(lineEl)) return null;
            const rect = lineEl.getBoundingClientRect();
            if (!(rect.height > 0)) return null;
            return (rect.top + rect.bottom) / 2;
        } catch {
            return null;
        }
    }

    private getEmbedElementAtPoint(clientX: number, clientY: number): HTMLElement | null {
        return findEmbedElementAtPoint(this.view, clientX, clientY, {
            fallbackPaddingX: 0,
            requireWithinEditorRect: true,
            requireDirectWithinRoot: false,
            enableFallbackScan: true,
            normalizeToEmbedRoot: true,
        });
    }

    private buildResolveCacheKey(
        clientX: number,
        clientY: number,
        dragSource: BlockInfo | null,
        pointerType: string | null,
        sourceScope: DragSourceScope
    ): string {
        if (!dragSource) {
            return `${clientX}|${clientY}|none|${pointerType ?? ''}|${sourceScope}`;
        }
        const compositeKey = (dragSource.compositeSelection?.ranges ?? [])
            .map((range) => `${range.startLine}-${range.endLine}`)
            .join(',');
        return [
            clientX,
            clientY,
            pointerType ?? '',
            sourceScope,
            dragSource.type,
            dragSource.startLine,
            dragSource.endLine,
            dragSource.from,
            dragSource.to,
            compositeKey,
        ].join('|');
    }

    private now(): number {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }
}



