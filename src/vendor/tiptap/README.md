# Tiptap, bundled

`tiptap.js` is the note editor's parts in one file, so the extension needs no
build step. Its parts (Tiptap, ProseMirror, tiptap-markdown, markdown-it and
what they need) keep their own licences, all permissive: see `LICENSES.txt`.

To rebuild it, in an empty folder:

    npm i @tiptap/core@2 @tiptap/pm@2 @tiptap/starter-kit@2 \
      @tiptap/extension-task-list@2 @tiptap/extension-task-item@2 \
      @tiptap/extension-link@2 @tiptap/extension-placeholder@2 \
      @tiptap/extension-table@2 @tiptap/extension-table-row@2 \
      @tiptap/extension-table-header@2 @tiptap/extension-table-cell@2 \
      tiptap-markdown@0.8 esbuild
    npx esbuild entry.js --bundle --format=esm --minify --outfile=tiptap.js

with this `entry.js`:

    export { Editor, InputRule, Node } from '@tiptap/core';
    export { default as StarterKit } from '@tiptap/starter-kit';
    export { default as CodeBlock } from '@tiptap/extension-code-block';
    export { default as Text } from '@tiptap/extension-text';
    export { default as TaskList } from '@tiptap/extension-task-list';
    export { default as TaskItem } from '@tiptap/extension-task-item';
    export { default as Link } from '@tiptap/extension-link';
    export { default as Placeholder } from '@tiptap/extension-placeholder';
    export { Markdown } from 'tiptap-markdown';
    export { default as Table } from '@tiptap/extension-table';
    export { default as TableRow } from '@tiptap/extension-table-row';
    export { default as TableHeader } from '@tiptap/extension-table-header';
    export { default as TableCell } from '@tiptap/extension-table-cell';

(`Node` and `InputRule` are what the note's own blocks are made of - see
`src/note/blocks.js`; the code block and the text come with the starter kit,
and are named here because the note changes how they are written down.)

Built from versions 2.27.3 (Tiptap) and 0.8.10 (tiptap-markdown).
