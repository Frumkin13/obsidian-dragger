import type { DragSourceRange } from './source';
import { normalizeCompositeRanges } from '../../shared/utils/composite-selection';

export function normalizeDragSourceRanges(ranges: DragSourceRange[], totalLines: number): DragSourceRange[] {
    return normalizeCompositeRanges(ranges, totalLines).map((range) => ({
        startLine: range.startLine,
        endLine: range.endLine,
    }));
}
