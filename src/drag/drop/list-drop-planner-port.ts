import { DragSource } from '../../shared/types/drag';
import { LineMap } from '../../domain/markdown/line-map';
import { ListDropIntent } from '../../shared/types/protocol-types';

export type ListDropPlanContribution = {
    listIntent?: ListDropIntent;
    highlightRect?: { top: number; left: number; width: number; height: number };
    lineRectSourceLineNumber?: number;
};

export interface ListDropPlannerPort {
    getListMarkerBounds(
        lineNumber: number,
        options?: { memo?: unknown; lineMap?: LineMap }
    ): { markerStartX: number; contentStartX: number } | null;
    computeListTarget(params: {
        targetLineNumber: number;
        lineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        dragSource: DragSource | null;
        sourceScope?: 'same_editor' | 'cross_editor';
        clientX: number;
        lineMap?: LineMap;
    }): ListDropPlanContribution;
}

