export {
    buildRangeSelectionBoundaryFromBlock,
    collectSelectedBlocksBetween,
    resolveBlockBoundaryAtLine,
    type CommittedRangeSelection,
    type MouseRangeSelectState,
    type RangeSelectionBoundary,
    type RangeSelectionOperation,
} from './selection-model';
export {
    buildCommittedRangeDeletionChanges,
    buildCommittedRangeSelection,
    computeUpdatedSelectionState,
} from './selection-state';
export {
    createInitialRangeSelectionState,
    resolveRangeSelectConfig,
} from './selection-session-flow';
export {
    cloneSelectedBlocks,
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    type SelectedBlockRange,
} from './block-selection';
