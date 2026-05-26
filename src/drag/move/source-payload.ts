import { BlockInfo } from '../../domain/block/block-types';
import { DocLikeWithRange } from '../../shared/types/protocol-types';
import { normalizeCompositeRanges } from '../../shared/utils/composite-selection';
import { resolveDeleteRange } from './document-change';

export type SourceSegment = {
    startLineNumber: number;
    from: number;
    to: number;
    deleteFrom: number;
    deleteTo: number;
};

export type SourcePayload = {
    content: string;
    segments: SourceSegment[];
};

export function captureSourcePayload(doc: DocLikeWithRange, sourceBlock: BlockInfo): SourcePayload | null {
    const rawRanges = sourceBlock.compositeSelection?.ranges ?? [{
        startLine: sourceBlock.startLine,
        endLine: sourceBlock.endLine,
    }];
    const ranges = normalizeCompositeRanges(rawRanges, doc.lines);
    if (ranges.length === 0) return null;

    const segments = ranges.map((range) => {
        const startLineNumber = range.startLine + 1;
        const endLineNumber = range.endLine + 1;
        const startLine = doc.line(startLineNumber);
        const endLine = doc.line(endLineNumber);
        const deleteRange = resolveDeleteRange(doc, startLine.from, endLine.to);
        return {
            startLineNumber,
            from: startLine.from,
            to: endLine.to,
            deleteFrom: deleteRange.from,
            deleteTo: deleteRange.to,
        };
    });
    const content = segments
        .map((segment) => doc.sliceString(segment.from, segment.to))
        .join('\n');

    return { content, segments };
}
