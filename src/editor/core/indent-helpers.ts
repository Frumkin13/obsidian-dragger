export function buildIndentStringFromSample(sample: string, width: number, tabSize: number): string {
    const safeWidth = Math.max(0, width);
    if (safeWidth === 0) return '';
    if (sample.includes('\t')) {
        const tabs = Math.max(0, Math.floor(safeWidth / tabSize));
        const spaces = Math.max(0, safeWidth - tabs * tabSize);
        return '\t'.repeat(tabs) + ' '.repeat(spaces);
    }
    return ' '.repeat(safeWidth);
}

export function getIndentUnitWidth(sample: string, tabSize: number): number {
    if (sample.includes('\t')) return tabSize;
    if (sample.length >= tabSize) return tabSize;
    return sample.length > 0 ? sample.length : tabSize;
}
