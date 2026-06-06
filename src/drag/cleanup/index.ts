export type CleanupReason =
    | 'finished'
    | 'drop_rejected'
    | 'press_cancelled'
    | 'pointer_cancelled'
    | 'session_interrupted'
    | 'escape'
    | 'blur'
    | 'visibility_hidden';

export type CleanupResult = {
    cleaned: true;
    reason: CleanupReason;
};
