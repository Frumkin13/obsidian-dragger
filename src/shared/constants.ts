/**
 * Timing constants for semantic refresh delays based on document size
 */
export const DOC_SEMANTIC_IDLE_SMALL_MS = 500;
export const DOC_SEMANTIC_IDLE_MEDIUM_MS = 900;
export const DOC_SEMANTIC_IDLE_LARGE_MS = 1400;

/**
 * Debounce delays for embed handle scanning based on document size
 */
export const EMBED_SCAN_DEBOUNCE_SMALL_MS = 120;
export const EMBED_SCAN_DEBOUNCE_MEDIUM_MS = 300;
export const EMBED_SCAN_DEBOUNCE_LARGE_MS = 700;

/**
 * Document size thresholds (line count)
 */
export const DOC_SIZE_MEDIUM_THRESHOLD = 30_000;
export const DOC_SIZE_LARGE_THRESHOLD = 120_000;

/**
 * Interaction zone width for handle hover detection
 */
export const HANDLE_INTERACTION_ZONE_PX = 64;

/**
 * Handle visual constants
 *
 * Centralised mutable config – set once per plugin load via `applySettings()`.
 */
export const DEFAULT_HANDLE_SIZE_PX = 20;
export const MIN_HANDLE_SIZE_PX = 10;
export const MAX_HANDLE_SIZE_PX = 40;
export const HANDLE_CORE_SIZE_RATIO = 0.5;
export const GRIP_DOTS_CORE_SIZE_RATIO = 0.8;

const handleConfig = {
    sizePx: DEFAULT_HANDLE_SIZE_PX,
    horizontalOffsetPx: -8,
};

export function getHandleSizePx(): number {
    return handleConfig.sizePx;
}

export function setHandleSizePx(size: number): void {
    handleConfig.sizePx = Math.max(MIN_HANDLE_SIZE_PX, Math.min(MAX_HANDLE_SIZE_PX, size));
}

export function getHandleHorizontalOffsetPx(): number {
    return handleConfig.horizontalOffsetPx;
}

export function setHandleHorizontalOffsetPx(offsetPx: number): void {
    handleConfig.horizontalOffsetPx = Number.isFinite(offsetPx) ? offsetPx : 0;
}
