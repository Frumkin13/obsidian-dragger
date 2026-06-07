export type CommandRejectReason =
    | 'empty_selection'
    | 'container_policy'
    | 'self_range_blocked'
    | 'self_embedding'
    | 'no_insert_text'
    | 'insertion_inside_deleted_range'
    | 'missing_move_planner_deps'
    | 'unsupported_command';

export type CommandReject = {
    type: 'reject';
    reason: CommandRejectReason | string;
};

export function rejectCommand(reason: CommandRejectReason | string): CommandReject {
    return { type: 'reject', reason };
}
