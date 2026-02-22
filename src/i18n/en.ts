import type { ZhCnStrings } from './zh-cn';

export const en: ZhCnStrings = {
    headingAppearance: 'Appearance',
    headingBehavior: 'Behavior',

    handleColor: 'Handle color',
    handleColorDesc: 'Follow theme accent or pick a custom color',
    optionTheme: 'Theme',
    optionCustom: 'Custom',

    handleVisibility: 'Handle visibility',
    handleVisibilityDesc: 'Control how drag handles are displayed',
    optionHover: 'Hover',
    optionAlways: 'Always',
    optionHidden: 'Hidden',
    dragSourceVisualStyle: 'Drag source visual style',
    dragSourceVisualStyleDesc: 'Shared highlight style',
    optionDragSourceVisualOutline: 'Outline only',
    optionDragSourceVisualSubtle: 'Subtle highlight',
    optionDragSourceVisualFilled: 'Filled highlight',
    enableDragSourceHighlight: 'Drag source highlight',
    enableDragSourceHighlightDesc: 'Highlight the block being dragged',
    enableListDropHighlight: 'List drop highlight',
    enableListDropHighlightDesc: 'Highlight list drop target area',

    handleIcon: 'Handle icon',
    handleIconDesc: 'Choose the icon style for drag handles',
    iconDot: '● dot',
    iconGripDots: '⠿ grip dots',
    iconGripLines: '☰ grip lines',
    iconSquare: '■ square',

    handleSize: 'Handle size',
    handleSizeDesc: 'Adjust the size of drag handles (px)',

    handleOffset: 'Handle horizontal offset',
    handleOffsetDesc: 'Negative = left, positive = right',

    indicatorColor: 'Indicator color',
    indicatorColorDesc: 'Follow theme accent or pick a custom color',

    multiLineSelection: 'Multi-line selection',
    multiLineSelectionDesc: 'Disable to keep single-block drag only',
    multiLineSelectionLongPressMs: 'Multi-line selection long-press duration',
    multiLineSelectionLongPressMsDesc: 'Enter milliseconds (300-2000). On mobile, hold for this duration before entering multi-block selection mode',
    mobileTextLongPressDrag: 'Mobile text long-press drag',
    mobileTextLongPressDragDesc: 'On mobile, long-press a text line or rendered block content to drag the current block directly without using the left handle',
    enableCrossFileDrag: 'Cross-file drag',
    enableCrossFileDragDesc: 'Allow dragging blocks into another open file editor',

    alignHandleToLineNumber: 'Align handle to line numbers',
    alignHandleToLineNumberDesc: 'When off, handles are positioned at the editor edge even if line numbers are visible',
};
