export type DropListIntent = {
    contextLineNumber?: number;
    indentDelta?: number;
    targetIndentWidth?: number;
};

export type DropPreview = {
    indicatorY: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
};

export type DropPlan = {
    targetLineNumber: number;
    listIntent?: DropListIntent;
    preview: DropPreview;
};
