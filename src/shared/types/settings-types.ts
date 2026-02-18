export type HandleVisibilityMode = 'always' | 'hover' | 'hidden';
export type HandleIconStyle = 'dot' | 'grip-dots' | 'grip-lines' | 'square';
export type DragSourceVisualStyle = 'outline' | 'subtle' | 'filled';

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
    enableMobileTextLongPressDrag: boolean;
    enableDragSourceHighlight: boolean;
    enableListDropHighlight: boolean;
    dragSourceVisualStyle: DragSourceVisualStyle;
    handleHorizontalOffsetPx: number;
    alignHandleToLineNumber: boolean;
}
