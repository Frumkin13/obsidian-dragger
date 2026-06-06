import type { DropPlan } from '../../shared/types/protocol-types';
import type { InsertionRuleRejectReason } from '../../domain/rules/insertion-rules';

export type DropRejectReason =
    | 'table_cell'
    | 'no_target'
    | 'no_anchor'
    | 'self_range_blocked'
    | 'self_embedding'
    | InsertionRuleRejectReason
    | 'container_policy';

export type DropResult = {
    allowed: boolean;
    reason?: DropRejectReason;
    plan?: DropPlan;
};
