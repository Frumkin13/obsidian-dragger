import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../domain/block/block-types';
import { createLineParsingContext } from '../domain/markdown/line-parsing-service';
import { getListContext } from '../domain/mutation/list-mutation';
import { buildInsertTextForDrop } from '../domain/mutation/text-mutation-policy';
import { ContainerPolicyService } from '../domain/rules/container-policy-service';
import { DragSourceResolver } from '../drag/source';
import { GeometryCalculator } from '../platform/codemirror/geometry';
import { DocLike, ListDropIntent } from '../shared/types/protocol-types';

export function createEditorContext(view: EditorView) {
    const dragSource = new DragSourceResolver(view);
    const lineParsing = createLineParsingContext(view);
    const geometry = new GeometryCalculator(view, lineParsing);
    const containerPolicy = new ContainerPolicyService(view);
    const getListContextForDoc = (doc: DocLike, lineNumber: number) =>
        getListContext(doc, lineNumber, lineParsing.parseLine);

    return {
        view,
        dragSource,
        parseLineWithQuote: lineParsing.parseLine,
        getAdjustedTargetLocation: (lineNumber: number, options?: { clientY?: number }) =>
            geometry.getAdjustedTargetLocation(lineNumber, options),
        resolveDropRuleAtInsertion: (
            ...args: Parameters<ContainerPolicyService['resolveDropRuleAtInsertion']>
        ) => containerPolicy.resolveDropRuleAtInsertion(...args),
        getListContext: getListContextForDoc,
        getIndentUnitWidth: lineParsing.getIndentUnitWidth,
        getIndentUnitWidthForDoc: lineParsing.getIndentUnitWidthForDoc,
        getBlockInfoForEmbed: (element: HTMLElement) => dragSource.getBlockInfoForEmbed(element),
        getLineRect: (lineNumber: number) => geometry.getLineRect(lineNumber),
        getInsertionAnchorY: (lineNumber: number) => geometry.getInsertionAnchorY(lineNumber),
        getLineIndentPosByWidth: (lineNumber: number, width: number) =>
            geometry.getLineIndentPosByWidth(lineNumber, width),
        getBlockRect: (startLineNumber: number, endLineNumber: number) =>
            geometry.getBlockRect(startLineNumber, endLineNumber),
        buildInsertText: (
            doc: DocLike,
            sourceBlock: BlockInfo,
            targetLineNumber: number,
            sourceContent: string,
            listIntent?: ListDropIntent
        ) => buildInsertTextForDrop({
            lineParsing,
            doc,
            sourceBlock,
            targetLineNumber,
            sourceContent,
            listIntent,
        }),
    };
}

export type EditorContext = ReturnType<typeof createEditorContext>;
