export {
    autoScrollSelectionRange,
    clearCommittedSelectionRange,
    commitSelectionRange,
    deleteCommittedSelectionRange,
    refreshSelectionVisual,
    updateSelectionFromBoundary,
    updateSelectionFromLine,
} from './range-selection-flow';
export {
    activateMouseRangeSelectInterception,
    beginRangeSelectionSessionAction,
    clearMouseRangeSelectState,
    updateMouseRangeSelection,
    updateMouseRangeSelectionFromLine,
    type RangeSelectionActionHost,
} from './range-selection-pipeline';
export {
    enterMobileSelectionMode,
    finishMobileSelectionPointer,
    getMobileSelectionTemplateBlock,
    handleMobilePointerDown,
    handleMobileSelectingPointerMove,
    type MobileSelectionActionDeps,
    type MobileSelectionActionHost,
} from './touch-selection-pipeline';
