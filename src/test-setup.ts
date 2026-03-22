// Polyfill Obsidian's setCssStyles for jsdom test environment
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.setCssStyles) {
    HTMLElement.prototype.setCssStyles = function (styles: Partial<CSSStyleDeclaration>) {
        Object.assign(this.style, styles);
    };
}

// Polyfill Obsidian's setCssProps for jsdom test environment
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.setCssProps) {
    HTMLElement.prototype.setCssProps = function (props: Record<string, string>) {
        Object.entries(props).forEach(([key, value]) => {
            this.style.setProperty(key, value);
        });
    };
}

export {};
