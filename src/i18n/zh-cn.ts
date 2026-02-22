export const zhCn = {
    // Headings
    headingAppearance: '样式',
    headingBehavior: '功能',

    // Handle color
    handleColor: '手柄颜色',
    handleColorDesc: '跟随主题强调色或自定义颜色',
    optionTheme: '跟随主题色',
    optionCustom: '自定义',

    // Handle visibility
    handleVisibility: '手柄显示模式',
    handleVisibilityDesc: '控制拖拽手柄的显示方式',
    optionHover: '悬停显示',
    optionAlways: '始终显示',
    optionHidden: '隐藏',
    dragSourceVisualStyle: '拖拽源视觉样式',
    dragSourceVisualStyleDesc: '统一高亮样式',
    optionDragSourceVisualOutline: '纯边框',
    optionDragSourceVisualSubtle: '简约高亮',
    optionDragSourceVisualFilled: '背景增强',
    enableDragSourceHighlight: '拖拽源高亮',
    enableDragSourceHighlightDesc: '高亮被拖动的源块',
    enableListDropHighlight: '列表落点高亮',
    enableListDropHighlightDesc: '高亮列表内可放置区域',

    // Handle icon
    handleIcon: '手柄图标',
    handleIconDesc: '选择拖拽手柄的图标样式',
    iconDot: '● 圆点',
    iconGripDots: '⠿ 六点抓手',
    iconGripLines: '☰ 三横线',
    iconSquare: '■ 方块',

    // Handle size
    handleSize: '手柄大小',
    handleSizeDesc: '调整拖拽手柄的大小（像素）',

    // Handle offset
    handleOffset: '手柄横向位置',
    handleOffsetDesc: '向左为负值，向右为正值',

    // Indicator color
    indicatorColor: '指示器颜色',
    indicatorColorDesc: '跟随主题强调色或自定义颜色',

    // Multi-line selection
    multiLineSelection: '多行选取',
    multiLineSelectionDesc: '关闭后仅保留单块拖拽，不进入多行选取流程',
    multiLineSelectionLongPressMs: '多选模式长按时长',
    multiLineSelectionLongPressMsDesc: '移动端长按多少毫秒后进入多文本块选择模式',
    mobileTextLongPressDrag: '移动端文本长按拖拽',
    mobileTextLongPressDragDesc: '移动端在文本整行或块内容区域长按可直接拖拽当前块，无需左侧手柄',
    enableCrossFileDrag: '跨文件拖拽',
    enableCrossFileDragDesc: '允许将块拖拽到另一个已打开文件的编辑器中',

    // Align handle to line number
    alignHandleToLineNumber: '手柄对齐行号',
    alignHandleToLineNumberDesc: '关闭后即使显示行号，手柄也定位到编辑器左侧边缘',
};

export type ZhCnStrings = typeof zhCn;
