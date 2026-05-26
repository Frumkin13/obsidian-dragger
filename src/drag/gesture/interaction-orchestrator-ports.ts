import { BlockInfo } from '../../domain/block/block-types';

export interface SemanticRefreshPort {
    ensureSemanticReadyForInteraction(): void;
}

export interface DragPerfSessionPort {
    ensure(): void;
    flush(reason: string): void;
}

export interface DragEventHandlerPort {
    startPointerDragFromHandle(
        handle: HTMLElement,
        e: PointerEvent,
        getBlockInfo?: () => BlockInfo | null
    ): void;
}

