export interface SemanticRefreshPort {
    ensureSemanticReadyForInteraction(): void;
}

export interface DragPerfSessionPort {
    ensure(): void;
    flush(reason: string): void;
}
