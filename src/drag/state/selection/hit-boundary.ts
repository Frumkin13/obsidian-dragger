import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../domain/block/block-types';
import { buildRangeSelectionBoundaryFromBlock, type RangeSelectionBoundary } from './selection-model';

function safeGetBlockInfoAtPoint(
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null,
    clientX: number,
    clientY: number
): BlockInfo | null {
    try {
        return getBlockInfoAtPoint(clientX, clientY);
    } catch {
        return null;
    }
}

export function resolveRangeBoundaryAtPoint(
    view: EditorView,
    clientX: number,
    clientY: number,
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null
): RangeSelectionBoundary | null {
    const doc = view.state.doc;
    if (doc.lines <= 0) return null;
    const block = safeGetBlockInfoAtPoint(getBlockInfoAtPoint, clientX, clientY);
    if (!block) return null;
    return buildRangeSelectionBoundaryFromBlock(doc, block);
}

