import type { DragSource } from '../../shared/types/drag';
import type { DragIntent } from '../intent';
import type { DragSourceRequest } from '../source';
import type { RangeSelectionOptions } from '../intent/drag-intent';

export type DragIntentExecutorHost = {
    resolveDragSource(request: DragSourceRequest): DragSource | null;
    isBlockInsideRenderedTableCell(source: DragSource): boolean;
    startRangeSelectionFromSource(source: DragSource, options?: RangeSelectionOptions): void;
    startDragFromSource(source: DragSource): void;
};

export function executeDragIntent(host: DragIntentExecutorHost, intent: DragIntent): boolean {
    switch (intent.type) {
        case 'ignore':
            return false;
        case 'start_range_selection': {
            const source = host.resolveDragSource(intent.sourceRequest);
            if (!source || host.isBlockInsideRenderedTableCell(source)) return true;
            host.startRangeSelectionFromSource(source, intent.options);
            return true;
        }
        case 'start_drag': {
            const source = host.resolveDragSource(intent.sourceRequest);
            if (!source || host.isBlockInsideRenderedTableCell(source)) return true;
            host.startDragFromSource(source);
            return true;
        }
    }
}
