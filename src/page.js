// What a page of the extension asks of the browser around it: a file to
// save, a file to read, leave to touch the bookmarks.

export function saveFile(name, text, type) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Lets the user choose a file; gives it, or nothing if they changed their mind. */
export function pickFile(accept) {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => done(input.files[0]);
    input.oncancel = () => done();
    input.click();
  });
}

export const askForBookmarks = () => chrome.permissions.request({ permissions: ['bookmarks'] });
