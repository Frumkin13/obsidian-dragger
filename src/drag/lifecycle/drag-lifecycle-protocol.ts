import type { ListDropTarget } from '../../domain/command/drop-target';

export function buildListIntent(intent?: ListDropTarget): ListDropTarget | null {
    if (
        typeof intent?.contextLineNumber !== 'number'
        && typeof intent?.mode !== 'string'
        && typeof intent?.targetIndentWidth !== 'number'
    ) {
        return null;
    }
    return {
        mode: intent.mode,
        contextLineNumber: intent?.contextLineNumber,
        targetIndentWidth: intent?.targetIndentWidth,
    };
}
