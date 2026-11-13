# Privacy

Bookmark Tree keeps the pages you choose to keep, arranged in trees. This is everything it knows about you and where that goes.

## What it reads

- **Your open tabs:** their addresses and titles, and which tab opened which. This is how a tab becomes a node in a tree, and it is the reason the browser warns that the extension can "read your browsing history". It does not read the content of pages.
- **Your bookmarks**, only if you press "Import browser bookmarks" or "Save to the browser's bookmarks" and grant the permission the browser then asks for.
- **What you type into it:** names, notes, your plan.

## Where it is kept

On your computer, in the extension's own storage. Nothing is sent to the author of the extension or to any server of ours: there is none.

## Where it can go, and only there

- **Chrome's synced storage for your Google account**, so that your other computers signed in to the same account see the same library. The browser carries it; it is governed by your Google account's own settings. A library too big for that storage sends only its most recently used part.
- **A GitHub repository you name**, if you set one up under Settings. The library is stored there as one file, using an access token you provide. The token is kept as plain text in the extension's storage on your computer and is sent only to `api.github.com`.
- **Files you save yourself**: a backup, an exported tree, a bookmarks file.

## What it does not do

No analytics, no advertising, no tracking, no accounts, no selling or sharing of data with anyone. It makes no network requests other than to `api.github.com` for the sync you configured, and to load the icons of sites through the browser's own icon cache.

## Removing your data

Removing the extension deletes everything it stored on that computer. What is in Chrome's synced storage goes when the extension is removed from your account's devices or you clear synced data in Chrome; what is in your GitHub repository is yours to delete there.

## Contact

Questions and reports: the issue tracker of the project, https://github.com/FrancoisVongue/bookmark-tree/issues
