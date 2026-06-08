import { EditorState } from '@codemirror/state';
import { detectBlock } from '../../../domain/block/block-detector';
import type { RangeSelectionBoundaryResolver } from '../../../domain/selection/range-selection';

export function createRangeSelectionBoundaryResolver(state: EditorState): RangeSelectionBoundaryResolver {
    const doc = state.doc;
    const tabSize = state.facet(EditorState.tabSize);
    return (lineNumber) => {
        const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
        const block = detectBlock(state, clampedLine, { tabSize });
        if (!block) {
            return {
                startLineNumber: clampedLine,
                endLineNumber: clampedLine,
            };
        }
        return {
            startLineNumber: Math.max(1, block.startLine + 1),
            endLineNumber: Math.min(doc.lines, block.endLine + 1),
        };
    };
}
