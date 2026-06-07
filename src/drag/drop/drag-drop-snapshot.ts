import type { DropTarget } from '../../domain/command/drop-target';

export type DragDropSnapshot = {
    target: DropTarget | null;
    rejectReason?: string | null;
};

export function createRejectedDropSnapshot(rejectReason: string): DragDropSnapshot {
    return {
        target: null,
        rejectReason,
    };
}
