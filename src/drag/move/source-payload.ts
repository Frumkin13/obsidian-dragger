import { BlockInfo } from '../../domain/block/block-types';
import { DocLikeWithRange } from '../../shared/types/protocol-types';
import { normalizeCompositeRanges, type CompositeLineRange } from '../../shared/utils/composite-selection';
import { resolveDeleteRange } from './document-change';

export type SourceSegment = {
    startLineNumber: number;
    endLineNumber: number;
    from: number;
    to: number;
    deleteFrom: number;
    deleteTo: number;
};

export type SourcePayload = {
    content: string;
    ranges: CompositeLineRange[];
    segments: SourceSegment[];
};

export type CapturedMoveSource = {
    block: BlockInfo;
    payload: SourcePayload;
};

export function captureMoveSource(doc: DocLikeWithRange, sourceBlock: BlockInfo): CapturedMoveSource | null {
    const payload = captureSourcePayload(doc, sourceBlock);
    if (!payload) return null;

    const firstRange = payload.ranges[0];
    const lastRange = payload.ranges[payload.ranges.length - 1];
    const firstLine = doc.line(firstRange.startLine + 1);
    const lastLine = doc.line(lastRange.endLine + 1);

    return {
        block: {
            ...sourceBlock,
            startLine: firstRange.startLine,
            endLine: lastRange.endLine,
            from: firstLine.from,
            to: lastLine.to,
            content: payload.content,
            compositeSelection: { ranges: payload.ranges },
        },
        payload,
    };
}

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
            endLineNumber,
            from: startLine.from,
            to: endLine.to,
            deleteFrom: deleteRange.from,
            deleteTo: deleteRange.to,
        };
    });
    const content = segments
        .map((segment) => doc.sliceString(segment.from, segment.to))
        .join('\n');

    return { content, ranges, segments };
}
