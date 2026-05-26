import { BlockInfo } from '../../domain/block/block-types';
import { LineMap } from '../../domain/markdown/line-map';

export type ListDropTargetInfo = {
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
    highlightRect?: { top: number; left: number; width: number; height: number };
    lineRectSourceLineNumber?: number;
};

export interface ListDropTargetCalculatorPort {
    getListMarkerBounds(
        lineNumber: number,
        options?: { memo?: unknown; lineMap?: LineMap }
    ): { markerStartX: number; contentStartX: number } | null;
    computeListTarget(params: {
        targetLineNumber: number;
        lineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        dragSource: BlockInfo | null;
        sourceScope?: 'same_editor' | 'cross_editor';
        clientX: number;
        lineMap?: LineMap;
    }): ListDropTargetInfo;
}

