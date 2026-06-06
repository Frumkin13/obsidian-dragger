import type { DragSource } from './source';

export type DragSourceRequest =
    | { kind: 'handle'; handle: HTMLElement; clientX: number; clientY: number }
    | { kind: 'point'; clientX: number; clientY: number }
    | { kind: 'committed-selection'; selectionSource: DragSource | null }
    | { kind: 'active-selection'; selectionSource: DragSource | null };
