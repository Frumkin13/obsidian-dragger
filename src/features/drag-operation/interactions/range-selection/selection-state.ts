import type { Text } from '@codemirror/state';
import type { BlockInfo, LineRange } from '../../../../shared/types/block-types';
import {
    type RangeSelectionBoundary,
    type MouseRangeSelectState,
    type CommittedRangeSelection,
    normalizeLineRange,
    mergeLineRanges,
    buildDragSourceBlockFromRanges,
    expandToBlockAlignedRange,
} from '../../../../core/services/state/selection-model';

export function computeUpdatedSelectionState(
    editorState: { doc: Text },
    state: MouseRangeSelectState,
    target: RangeSelectionBoundary
): {
    currentLineNumber: number;
    selectionRanges: LineRange[];
    activeSelectionBlock: BlockInfo;
} {
    const {
        startLineNumber: rangeStartLineNumber,
        endLineNumber: rangeEndLineNumber,
    } = expandToBlockAlignedRange(
        editorState,
        state.anchorStartLineNumber,
        state.anchorEndLineNumber,
        target.startLineNumber,
        target.endLineNumber
    );

    const docLines = editorState.doc.lines;
    const activeRange = normalizeLineRange(docLines, rangeStartLineNumber, rangeEndLineNumber);
    const selectionRanges = mergeLineRanges(docLines, [
        ...state.committedRangesSnapshot,
        activeRange,
    ]);
    const activeSelectionBlock = buildDragSourceBlockFromRanges(
        editorState.doc,
        selectionRanges,
        state.anchorSelectionBlock
    );

    return {
        currentLineNumber: target.representativeLineNumber,
        selectionRanges,
        activeSelectionBlock,
    };
}

export function buildCommittedRangeSelection(
    doc: Text,
    selectionRanges: LineRange[],
    templateBlock: BlockInfo
): CommittedRangeSelection {
    const committedRanges = mergeLineRanges(doc.lines, selectionRanges);
    const selectedBlock = buildDragSourceBlockFromRanges(doc, committedRanges, templateBlock);
    return {
        selectedBlock,
        ranges: committedRanges,
    };
}

export function buildCommittedRangeDeletionChanges(
    doc: Text,
    ranges: LineRange[]
): Array<{ from: number; to: number }> {
    return mergeLineRanges(doc.lines, ranges).map((range) => {
        const startLineNumber = Math.max(1, Math.min(doc.lines, range.startLineNumber));
        const endLineNumber = Math.max(startLineNumber, Math.min(doc.lines, range.endLineNumber));
        const from = doc.line(startLineNumber).from;
        const endLine = doc.line(endLineNumber);
        const to = endLineNumber === doc.lines
            ? doc.length
            : Math.min(doc.length, endLine.to + 1);
        return { from, to };
    }).filter((change) => change.to > change.from);
}
