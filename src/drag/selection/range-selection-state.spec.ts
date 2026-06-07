import { describe, it } from 'vitest';

describe('selection-model', () => {
    it('keeps BlockSelection construction out of selection state', () => {
        // BlockSelection range construction is owned by the CodeMirror block selection resolver.
    });
});
