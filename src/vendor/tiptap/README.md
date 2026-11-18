# Tiptap, bundled

`tiptap.js` is the note editor's parts in one file, so the extension needs no
build step. Its parts (Tiptap, ProseMirror, tiptap-markdown, markdown-it,
lowlight, highlight.js and what they need) keep their own licences, all
permissive: see `LICENSES.txt`.

To rebuild it, in an empty folder:

    npm i @tiptap/core@2 @tiptap/pm@2 @tiptap/starter-kit@2 \
      @tiptap/extension-task-list@2 @tiptap/extension-task-item@2 \
      @tiptap/extension-link@2 @tiptap/extension-placeholder@2 \
      @tiptap/extension-table@2 @tiptap/extension-table-row@2 \
      @tiptap/extension-table-header@2 @tiptap/extension-table-cell@2 \
      tiptap-markdown@0.8 lowlight@3 highlight.js@11 esbuild
    npx esbuild entry.js --bundle --format=esm --minify --outfile=tiptap.js

with this `entry.js`:

    export { Editor, InputRule, Mark, Node, markInputRule, markPasteRule } from '@tiptap/core';
    export { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
    export { Decoration, DecorationSet } from '@tiptap/pm/view';
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

    // Code is coloured by lowlight (highlight.js's grammars, as a tree): its common
    // languages, which are also the ones a language is guessed among, and a few
    // more that notes are written about.
    import { common, createLowlight } from 'lowlight';
    import core from 'highlight.js/lib/core';
    import clojure from 'highlight.js/lib/languages/clojure';
    import cmake from 'highlight.js/lib/languages/cmake';
    import dart from 'highlight.js/lib/languages/dart';
    import dockerfile from 'highlight.js/lib/languages/dockerfile';
    import dos from 'highlight.js/lib/languages/dos';
    import elixir from 'highlight.js/lib/languages/elixir';
    import erlang from 'highlight.js/lib/languages/erlang';
    import groovy from 'highlight.js/lib/languages/groovy';
    import haskell from 'highlight.js/lib/languages/haskell';
    import http from 'highlight.js/lib/languages/http';
    import julia from 'highlight.js/lib/languages/julia';
    import latex from 'highlight.js/lib/languages/latex';
    import nginx from 'highlight.js/lib/languages/nginx';
    import nix from 'highlight.js/lib/languages/nix';
    import ocaml from 'highlight.js/lib/languages/ocaml';
    import powershell from 'highlight.js/lib/languages/powershell';
    import properties from 'highlight.js/lib/languages/properties';
    import protobuf from 'highlight.js/lib/languages/protobuf';
    import scala from 'highlight.js/lib/languages/scala';
    import vim from 'highlight.js/lib/languages/vim';
    const more = { clojure, cmake, dart, dockerfile, dos, elixir, erlang, groovy, haskell, http, julia, latex, nginx, nix, ocaml, powershell, properties, protobuf, scala, vim };
    export const lowlight = createLowlight({ ...common, ...more });
    // Where highlight.js's own name for a language is not one to choose by.
    const NAMES = { xml: 'HTML / XML', ini: 'INI / TOML', php: 'PHP', 'python-repl': 'Python REPL', properties: 'Properties', dos: 'Batch (DOS)', shell: 'Shell session', nginx: 'Nginx' };
    /** The languages by name: { id, name, aliases, guessed } - `guessed` for those a language is guessed among. */
    export const languages = Object.entries({ ...common, ...more })
      .map(([id, grammar]) => {
        const { name, aliases = [] } = grammar(core);
        return { id, name: NAMES[id] ?? name ?? id, aliases, guessed: id in common };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

(`Node`, `InputRule`, `Plugin` and the rest of ProseMirror's parts are what the
note's own blocks are made of - see `src/note/blocks.js` and `src/note/code.js`;
the code block and the text come with the starter kit, and are named here
because the note changes how they are written down. `lowlight` colours code
with highlight.js's grammars: 57 languages, some 240 KB of the bundle.)

Built from versions 2.27.3 (Tiptap), 0.8.10 (tiptap-markdown), 3.3.0 (lowlight)
and 11.12.0 (highlight.js).
