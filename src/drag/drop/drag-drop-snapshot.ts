import type { DropTarget } from '../../domain/command/drop-target';

export type DragDropSnapshot<TPreview = unknown> = {
    target: DropTarget | null;
    rejectReason?: string | null;
    previewData?: TPreview;
};

export function createRejectedDropSnapshot(rejectReason: string): DragDropSnapshot {
    return {
        target: null,
        rejectReason,
    };
}
