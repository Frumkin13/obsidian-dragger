import type { DropTarget } from '../../../domain/command/drop-target';
import type { InsertionRuleRejectReason } from '../../../domain/rules/insertion-rules';

export interface DropPreview {
    indicatorY: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
}

export type DropResolution = {
    target: DropTarget;
    preview: DropPreview;
};

export type DropRejectReason =
    | 'table_cell'
    | 'no_target'
    | 'no_anchor'
    | 'self_range_blocked'
    | 'self_embedding'
    | InsertionRuleRejectReason
    | 'container_policy';

export type DropAllowedResult = {
    allowed: true;
    resolution: DropResolution;
};

export type DropRejectedResult = {
    allowed: false;
    reason?: DropRejectReason;
    resolution?: never;
};

export type DropValidationResult = DropAllowedResult | DropRejectedResult;

export type DragSelectionScope =
    | 'same_editor'
    | 'cross_editor';

export type DragDocumentRelation =
    | 'same_document'
    | 'different_document';
