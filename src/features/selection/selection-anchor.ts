import {
    CODEMIRROR_GUTTER_ELEMENT_SELECTOR,
    HANDLE_CORE_CLASS,
    HANDLE_GUTTER_MARKER_CLASS,
} from '../../shared/dom-selectors';
import type { BlockSelectionSegment } from './block-selection';

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

type ResolveHandleForBlockLineNumber = (blockLineNumber: number) => HTMLElement | null;

type ResolveRangeAnchorSpanOptions = {
    segment: BlockSelectionSegment;
    resolveHandleForBlockLineNumber: ResolveHandleForBlockLineNumber;
    visibleHandles: Iterable<HTMLElement>;
};

function getHandleBlockLineNumber(handle: HTMLElement): number | null {
    const blockStartAttr = handle.getAttribute('data-block-start');
    if (!blockStartAttr) return null;
    const blockStart = Number(blockStartAttr);
    if (!Number.isFinite(blockStart)) return null;
    return blockStart + 1;
}

export function getAnchorPointForHandle(handle: HTMLElement | null): RangeAnchorPoint | null {
    if (!handle) return null;
    const host = handle.closest<HTMLElement>(`${CODEMIRROR_GUTTER_ELEMENT_SELECTOR}.${HANDLE_GUTTER_MARKER_CLASS}`)
        ?? handle.closest<HTMLElement>(`.${HANDLE_GUTTER_MARKER_CLASS}`);
    if (!host) return null;
    const anchorTarget = handle.querySelector<HTMLElement>(`.${HANDLE_CORE_CLASS}`) ?? handle;
    const rect = anchorTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        host,
    };
}

function getAnchorPointByBlockLineNumber(
    blockLineNumber: number,
    resolveHandleForBlockLineNumber: ResolveHandleForBlockLineNumber
): RangeAnchorPoint | null {
    const handle = resolveHandleForBlockLineNumber(blockLineNumber);
    return getAnchorPointForHandle(handle);
}

function collectVisibleAnchorsInRange(
    segment: BlockSelectionSegment,
    visibleHandles: Iterable<HTMLElement>
): RangeAnchorPoint[] {
    const anchors: RangeAnchorPoint[] = [];
    for (const handle of visibleHandles) {
        const blockLineNumber = getHandleBlockLineNumber(handle);
        if (blockLineNumber === null) continue;
        if (blockLineNumber < segment.startBlockLineNumber || blockLineNumber > segment.endBlockLineNumber) continue;
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

    addAnchor(getAnchorPointByBlockLineNumber(
        options.segment.startBlockLineNumber,
        options.resolveHandleForBlockLineNumber
    ));
    addAnchor(getAnchorPointByBlockLineNumber(
        options.segment.endBlockLineNumber,
        options.resolveHandleForBlockLineNumber
    ));
    for (const anchor of collectVisibleAnchorsInRange(options.segment, options.visibleHandles)) {
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

