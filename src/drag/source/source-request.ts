export type DragSourceRequest =
    | { kind: 'handle'; handle: HTMLElement; clientX: number; clientY: number }
    | { kind: 'point'; clientX: number; clientY: number }
    | { kind: 'committed-selection' }
    | { kind: 'active-selection' };
