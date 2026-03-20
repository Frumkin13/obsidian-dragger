import { BlockInfo } from '../block/block-types';
import {
    InsertionRuleRejectReason,
    InsertionSlotContext,
    resolveInsertionRule,
} from './insertion-rules';
import { getLineMetaAt, LineMap } from '../parser/line-map';
import { computeListIndentPlan } from '../mutation/list-mutation';
import { DocLike, ListContext, ParsedLine } from '../../shared/types/protocol-types';
import { normalizeCompositeRanges } from '../../shared/utils/composite-selection';

export type InPlaceDropRejectReason =
    | 'self_range_blocked'
    | 'self_embedding'
    | 'container_policy'
    | InsertionRuleRejectReason;

export type InPlaceDropValidationResult = {
    inSelfRange: boolean;
    allowInPlaceIndentChange: boolean;
    rejectReason?: InPlaceDropRejectReason;
    listContextLineNumber?: number;
    targetIndentWidth?: number;
};

export function validateInPlaceDrop(params: {
    doc: DocLike;
    sourceBlock: BlockInfo;
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    slotContext?: InsertionSlotContext;
    lineMap?: LineMap;
    listContextLineNumberOverride?: number;
    listIndentDeltaOverride?: number;
    listTargetIndentWidthOverride?: number;
}): InPlaceDropValidationResult {
    const {
        doc,
        sourceBlock,
        targetLineNumber,
        parseLineWithQuote,
        getListContext,
        getIndentUnitWidth,
        slotContext,
        lineMap,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride,
    } = params;

    if (typeof slotContext === 'string') {
        const containerRule = resolveInsertionRule({
            sourceType: sourceBlock.type,
            slotContext,
        });
        if (!containerRule.allowDrop) {
            return {
                inSelfRange: false,
                allowInPlaceIndentChange: false,
                rejectReason: containerRule.rejectReason ?? 'container_policy',
            };
        }
    }

    const targetLineIdx = targetLineNumber - 1;
    const compositeRanges = normalizeCompositeRanges(
        sourceBlock.compositeSelection?.ranges ?? [],
        doc.lines
    );
    const hasCompositeSelection = compositeRanges.length > 1;
    const effectiveSourceRange = compositeRanges.length === 1
        ? compositeRanges[0]
        : {
            startLine: sourceBlock.startLine,
            endLine: sourceBlock.endLine,
        };
    const inSelfRange = hasCompositeSelection
        ? compositeRanges.some((range) => {
            const start = Math.min(range.startLine, range.endLine);
            const end = Math.max(range.startLine, range.endLine);
            return targetLineIdx >= start && targetLineIdx <= end;
        })
        : (
            targetLineIdx >= effectiveSourceRange.startLine
            && targetLineIdx <= effectiveSourceRange.endLine + 1
        );
    if (!inSelfRange) {
        return { inSelfRange: false, allowInPlaceIndentChange: false };
    }

    if (hasCompositeSelection) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const hasListIntent = listTargetIndentWidthOverride !== undefined || listIndentDeltaOverride !== undefined;
    if (!hasListIntent) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const sourceLineNumber = effectiveSourceRange.startLine + 1;
    const sourceLineMeta = lineMap ? getLineMetaAt(lineMap, sourceLineNumber) : null;
    if (sourceLineMeta && !sourceLineMeta.isList) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }
    const sourceLineText = doc.line(sourceLineNumber).text;
    const sourceParsed = parseLineWithQuote(sourceLineText);
    if (!sourceParsed.isListItem) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const indentPlan = computeListIndentPlan({
        doc,
        sourceBase: {
            indentWidth: sourceParsed.indentWidth,
            indentRaw: sourceParsed.indentRaw,
        },
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth,
        getListContext,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride,
    });
    const targetIndentWidth = indentPlan.targetIndentWidth;
    const listContextLineNumber = indentPlan.listContextLineNumber;

    const isAfterSelf = targetLineIdx === effectiveSourceRange.endLine + 1;
    const isSameLine = targetLineIdx === effectiveSourceRange.startLine;
    const sourceEndLineNumber = effectiveSourceRange.endLine + 1;
    const isSelfContext = listContextLineNumber === sourceLineNumber;
    const isContextInsideSource = listContextLineNumber >= sourceLineNumber
        && listContextLineNumber <= sourceEndLineNumber;

    if (isAfterSelf && isContextInsideSource && targetIndentWidth > sourceParsed.indentWidth) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_embedding',
            listContextLineNumber,
            targetIndentWidth,
        };
    }

    const allowInPlaceIndentChange = (
        (isAfterSelf && targetIndentWidth !== sourceParsed.indentWidth)
        || (isSameLine && targetIndentWidth !== sourceParsed.indentWidth && !isSelfContext)
        || (!isAfterSelf && targetIndentWidth < sourceParsed.indentWidth)
    );

    if (!allowInPlaceIndentChange) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
            listContextLineNumber,
            targetIndentWidth,
        };
    }

    return {
        inSelfRange: true,
        allowInPlaceIndentChange,
        listContextLineNumber,
        targetIndentWidth,
    };
}


