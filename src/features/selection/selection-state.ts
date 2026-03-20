import type { EditorState, Text } from '@codemirror/state';
import type { BlockInfo } from '../../core/block/block-types';
import {
    groupSelectedBlocksIntoSegments,
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    type SelectedBlockRange,
} from './block-selection';
import {
    type RangeSelectionBoundary,
    type MouseRangeSelectState,
    type CommittedRangeSelection,
    buildDragSourceBlockFromBlocks,
    collectSelectedBlocksBetween,
} from './selection-model';

export function computeUpdatedSelectionState(
    editorState: EditorState,
    state: MouseRangeSelectState,
    target: RangeSelectionBoundary
): {
    currentLineNumber: number;
    selectionBlocks: SelectedBlockRange[];
    activeSelectionBlock: BlockInfo;
} {
    const activeBlocks = collectSelectedBlocksBetween(
        editorState,
        state.anchorStartLineNumber,
        state.anchorEndLineNumber,
        target.startLineNumber,
        target.endLineNumber
    );

    const docLines = editorState.doc.lines;
    const selectionBlocks = state.operation === 'remove'
        ? subtractSelectedBlocks(docLines, state.committedBlocksSnapshot, activeBlocks)
        : mergeSelectedBlocks(docLines, [
            ...state.committedBlocksSnapshot,
            ...activeBlocks,
        ]);
    const activeSelectionBlock = buildDragSourceBlockFromBlocks(
        editorState.doc,
        selectionBlocks,
        state.anchorSelectionBlock
    );

    return {
        currentLineNumber: target.representativeLineNumber,
        selectionBlocks,
        activeSelectionBlock,
    };
}

export function buildCommittedRangeSelection(
    doc: Text,
    selectionBlocks: SelectedBlockRange[],
    templateBlock: BlockInfo
): CommittedRangeSelection | null {
    const committedBlocks = mergeSelectedBlocks(doc.lines, selectionBlocks);
    if (committedBlocks.length === 0) {
        return null;
    }
    const selectedBlock = buildDragSourceBlockFromBlocks(doc, committedBlocks, templateBlock);
    return {
        selectedBlock,
        blocks: committedBlocks,
    };
}

export function buildCommittedRangeDeletionChanges(
    doc: Text,
    blocks: SelectedBlockRange[]
): Array<{ from: number; to: number }> {
    return groupSelectedBlocksIntoSegments(doc.lines, blocks).map((segment) => {
        const startLineNumber = Math.max(1, Math.min(doc.lines, segment.startLineNumber));
        const endLineNumber = Math.max(startLineNumber, Math.min(doc.lines, segment.endLineNumber));
        const from = doc.line(startLineNumber).from;
        const endLine = doc.line(endLineNumber);
        const to = endLineNumber === doc.lines
            ? doc.length
            : Math.min(doc.length, endLine.to + 1);
        return { from, to };
    }).filter((change) => change.to > change.from);
}

