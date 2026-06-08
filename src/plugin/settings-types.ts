export type HandleVisibilityMode = 'always' | 'hover' | 'hidden';
export type HandleIconStyle = 'dot' | 'grip-dots' | 'grip-lines' | 'square';
export type BlockSelectionVisualStyle = 'outline' | 'subtle' | 'filled';
export type HandleGutterPosition = 'left' | 'right';

export interface DragNDropSettings {
    handleColorMode: 'theme' | 'custom';
    handleColor: string;
    handleVisibility: HandleVisibilityMode;
    handleIcon: HandleIconStyle;
    handleSize: number;
    indicatorColorMode: 'theme' | 'custom';
    indicatorColor: string;
    enableCrossFileDrag: boolean;
    enableMultiLineSelection: boolean;
    multiLineSelectionLongPressMs: number;
    requireMobileDragMode: boolean;
    disableMobileDragModeAfterDrop: boolean;
    enableMobileTextLongPressDrag: boolean;
    enableBlockSelectionHighlight: boolean;
    enableListDropHighlight: boolean;
    selectionVisualStyle: BlockSelectionVisualStyle;
    handleHorizontalOffsetPx: number;
    handleGutterPosition: HandleGutterPosition;
}
