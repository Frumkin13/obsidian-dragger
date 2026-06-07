import {
    CODEMIRROR_GUTTER_ELEMENT_SELECTOR,
    HANDLE_CORE_CLASS,
    HANDLE_GUTTER_MARKER_CLASS,
} from '../../shared/dom-selectors';
import type { BlockSelectionSegment } from '../../shared/utils/block-ranges';

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

export type AnchorEntry = {
    blockLineNumber: number;
    anchor: RangeAnchorPoint;
};

export type AnchorSnapshot = {
    ordered: AnchorEntry[];
    byBlockLineNumber: Map<number, RangeAnchorPoint>;
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

export function emptyAnchorSnapshot(): AnchorSnapshot {
    return {
        ordered: [],
        byBlockLineNumber: new Map<number, RangeAnchorPoint>(),
    };
}

export function buildAnchorSnapshot(
    visibleHandles: Iterable<HTMLElement>
): AnchorSnapshot {
    const snapshot = emptyAnchorSnapshot();
    for (const handle of visibleHandles) {
        const blockLineNumber = getHandleBlockLineNumber(handle);
        if (blockLineNumber === null) continue;
        if (snapshot.byBlockLineNumber.has(blockLineNumber)) continue;
        const anchor = getAnchorPointForHandle(handle);
        if (!anchor) continue;
        snapshot.byBlockLineNumber.set(blockLineNumber, anchor);
        snapshot.ordered.push({ blockLineNumber, anchor });
    }
    snapshot.ordered.sort((a, b) => a.blockLineNumber - b.blockLineNumber);
    return snapshot;
}

type ResolveAnchorSpanOptions = {
    segment: BlockSelectionSegment;
    snapshot: AnchorSnapshot;
    resolveHandleForBlockLineNumber?: ResolveHandleForBlockLineNumber;
};

function findFirstAnchorIndexAtOrAfter(
    ordered: AnchorEntry[],
    startBlockLineNumber: number
): number {
    let low = 0;
    let high = ordered.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (ordered[mid].blockLineNumber < startBlockLineNumber) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

export function resolveAnchorSpan(
    options: ResolveAnchorSpanOptions
): RangeAnchorSpan | null {
    const anchors: RangeAnchorPoint[] = [];
    const seenHosts = new Set<HTMLElement>();
    const addAnchor = (anchor: RangeAnchorPoint | null): void => {
        if (!anchor) return;
        if (seenHosts.has(anchor.host)) return;
        seenHosts.add(anchor.host);
        anchors.push(anchor);
    };

    const startAnchor = options.snapshot.byBlockLineNumber.get(options.segment.startBlockLineNumber)
        ?? (options.resolveHandleForBlockLineNumber
            ? getAnchorPointByBlockLineNumber(
                options.segment.startBlockLineNumber,
                options.resolveHandleForBlockLineNumber
            )
            : null);
    const endAnchor = options.snapshot.byBlockLineNumber.get(options.segment.endBlockLineNumber)
        ?? (options.resolveHandleForBlockLineNumber
            ? getAnchorPointByBlockLineNumber(
                options.segment.endBlockLineNumber,
                options.resolveHandleForBlockLineNumber
            )
            : null);

    addAnchor(startAnchor);
    addAnchor(endAnchor);

    const ordered = options.snapshot.ordered;
    for (
        let i = findFirstAnchorIndexAtOrAfter(ordered, options.segment.startBlockLineNumber);
        i < ordered.length && ordered[i].blockLineNumber <= options.segment.endBlockLineNumber;
        i++
    ) {
        addAnchor(ordered[i].anchor);
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

export function resolveRangeAnchorSpan(options: ResolveRangeAnchorSpanOptions): RangeAnchorSpan | null {
    return resolveAnchorSpan({
        segment: options.segment,
        snapshot: buildAnchorSnapshot(options.visibleHandles),
        resolveHandleForBlockLineNumber: options.resolveHandleForBlockLineNumber,
    });
}

