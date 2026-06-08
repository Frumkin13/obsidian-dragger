# Headless Platform Adapter Example

This example shows the shape expected from a non-Obsidian platform.

The platform owns:

- Pointer, keyboard, focus, and host event handling.
- Translating host state into `BlockSelection` and `DragDropSnapshot`.
- Rendering `drop.previewData`.
- Applying `BlockCommand` to the host editor.

The core package owns:

- Drag session state.
- Drag lifecycle events.
- Preview, commit, and cancel effects.
- Markdown block commands and transactions.

`previewData` is platform-private render data. Core keeps it typed and passes it back through `showDropPreview`, but core never reads it.
