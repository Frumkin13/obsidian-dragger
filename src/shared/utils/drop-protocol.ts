import { ListDropIntent } from '../types/protocol-types';

export function buildListIntent(intent?: ListDropIntent): ListDropIntent | null {
    if (
        typeof intent?.contextLineNumber !== 'number'
        && typeof intent?.indentDelta !== 'number'
        && typeof intent?.targetIndentWidth !== 'number'
    ) {
        return null;
    }
    return {
        contextLineNumber: intent?.contextLineNumber,
        indentDelta: intent?.indentDelta,
        targetIndentWidth: intent?.targetIndentWidth,
    };
}
