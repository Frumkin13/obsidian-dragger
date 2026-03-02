import type { LineRange } from '../../shared/types/line-range';
import { HANDLE_GUTTER_MARKER_CLASS } from '../ui/handle/handle-gutter';

export type RangeAnchorPoint = {
    x: number;
    y: number;
    host: HTMLElement;
};

export type RangeAnchorSpan = {
    x: number;
    topY: number;
    bottomY: number;
    host: HTMLElement;
};

type ResolveAnchorLineNumber = (lineNumber: number) => number;
type ResolveInlineHandleForLine = (lineNumber: number) => HTMLElement | null;

type ResolveRangeAnchorSpanOptions = {
    range: LineRange;
    resolveAnchorLineNumber: ResolveAnchorLineNumber;
    resolveInlineHandleForLine: ResolveInlineHandleForLine;
    visibleHandles: Iterable<HTMLElement>;
};

function getHandleLineNumber(handle: HTMLElement): number | null {
    const blockStartAttr = handle.getAttribute('data-block-start');
    if (!blockStartAttr) return null;
    const blockStart = Number(blockStartAttr);
    if (!Number.isFinite(blockStart)) return null;
    return blockStart + 1;
}

export function getAnchorPointForHandle(handle: HTMLElement | null): RangeAnchorPoint | null {
    if (!handle) return null;
    const host = handle.closest<HTMLElement>(`.${HANDLE_GUTTER_MARKER_CLASS}`);
    if (!host) return null;
    const rect = handle.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        host,
    };
}

function getAnchorPointByLine(
    lineNumber: number,
    resolveAnchorLineNumber: ResolveAnchorLineNumber,
    resolveInlineHandleForLine: ResolveInlineHandleForLine
): RangeAnchorPoint | null {
    const anchorLineNumber = resolveAnchorLineNumber(lineNumber);
    const handle = resolveInlineHandleForLine(anchorLineNumber);
    return getAnchorPointForHandle(handle);
}

function collectVisibleAnchorsInRange(
    range: LineRange,
    visibleHandles: Iterable<HTMLElement>
): RangeAnchorPoint[] {
    const anchors: RangeAnchorPoint[] = [];
    for (const handle of visibleHandles) {
        const lineNumber = getHandleLineNumber(handle);
        if (lineNumber === null) continue;
        if (lineNumber < range.startLineNumber || lineNumber > range.endLineNumber) continue;
        const anchor = getAnchorPointForHandle(handle);
        if (!anchor) continue;
        anchors.push(anchor);
    }
    return anchors;
}

export function resolveRangeAnchorSpan(options: ResolveRangeAnchorSpanOptions): RangeAnchorSpan | null {
    const anchors: RangeAnchorPoint[] = [];
    const seenHosts = new Set<HTMLElement>();
    const addAnchor = (anchor: RangeAnchorPoint | null): void => {
        if (!anchor) return;
        if (seenHosts.has(anchor.host)) return;
        seenHosts.add(anchor.host);
        anchors.push(anchor);
    };

    addAnchor(getAnchorPointByLine(
        options.range.startLineNumber,
        options.resolveAnchorLineNumber,
        options.resolveInlineHandleForLine
    ));
    addAnchor(getAnchorPointByLine(
        options.range.endLineNumber,
        options.resolveAnchorLineNumber,
        options.resolveInlineHandleForLine
    ));
    for (const anchor of collectVisibleAnchorsInRange(options.range, options.visibleHandles)) {
        addAnchor(anchor);
    }

    if (anchors.length === 0) return null;

    const topAnchor = anchors.reduce((best, current) => (current.y < best.y ? current : best));
    const bottomAnchor = anchors.reduce((best, current) => (current.y > best.y ? current : best));
    return {
        x: (topAnchor.x + bottomAnchor.x) / 2,
        topY: topAnchor.y,
        bottomY: bottomAnchor.y,
        host: topAnchor.host,
    };
}

