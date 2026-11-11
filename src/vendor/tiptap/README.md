# Tiptap, bundled

`tiptap.js` is the note editor's parts in one file, so the extension needs no
build step. All parts are MIT licensed (Tiptap, ProseMirror, tiptap-markdown,
markdown-it).

To rebuild it, in an empty folder:

    npm i @tiptap/core@2 @tiptap/pm@2 @tiptap/starter-kit@2 \
      @tiptap/extension-task-list@2 @tiptap/extension-task-item@2 \
      @tiptap/extension-link@2 @tiptap/extension-placeholder@2 \
      tiptap-markdown@0.8 esbuild
    npx esbuild entry.js --bundle --format=esm --minify --outfile=tiptap.js

with this `entry.js`:

    export { Editor } from '@tiptap/core';
    export { default as StarterKit } from '@tiptap/starter-kit';
    export { default as TaskList } from '@tiptap/extension-task-list';
    export { default as TaskItem } from '@tiptap/extension-task-item';
    export { default as Link } from '@tiptap/extension-link';
    export { default as Placeholder } from '@tiptap/extension-placeholder';
    export { Markdown } from 'tiptap-markdown';

Built from versions 2.27.3 (Tiptap) and 0.8.10 (tiptap-markdown).
