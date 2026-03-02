import { BlockInfo } from '../../core/block/block-types';
import { LineMap } from '../../core/parser/line-map';
import { GeometryFrameCache } from './rect-calculator';

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
        options?: { frameCache?: GeometryFrameCache; memo?: unknown; lineMap?: LineMap }
    ): { markerStartX: number; contentStartX: number } | null;
    computeListTarget(params: {
        targetLineNumber: number;
        lineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        dragSource: BlockInfo | null;
        sourceScope?: 'same_editor' | 'cross_editor';
        clientX: number;
        frameCache?: GeometryFrameCache;
        lineMap?: LineMap;
    }): ListDropTargetInfo;
}

