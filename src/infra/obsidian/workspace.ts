import type { App, WorkspaceLeaf } from 'obsidian';

export function getActiveLeaf(app: App): WorkspaceLeaf | null {
    return app.workspace.getMostRecentLeaf() ?? null;
}
