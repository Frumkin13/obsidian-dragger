export { DropIndicatorManager } from './drop-indicator';
export { resolveHandleBlockAtLine } from './handle-block-resolver';
export { HandleVisibilityController } from './handle-visibility-controller';
export { HandleGutterLineMarker, createLineDragHandleElement, getVisibleHandleForBlockStart } from './handle-renderer';
export { RangeSelectionVisualManager } from './range-selection-visual-manager';
export {
    buildAnchorSnapshot,
    emptyAnchorSnapshot,
    getAnchorPointForHandle,
    resolveAnchorSpan,
    type AnchorSnapshot,
    type RangeAnchorPoint,
    type RangeAnchorSpan,
} from './range-selection-anchor';
