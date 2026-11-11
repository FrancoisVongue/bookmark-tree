// Keeping the library as a file in a GitHub repository: every version is a
// commit, so the repository is also the history and the backup.
//
//   settings: { repo: 'owner/name', token, path, api? }

const text64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const from64 = (base64) => new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

/** Someone else saved a version since we looked. */
export class Conflict extends Error {}

async function call(settings, path, init = {}) {
  const response = await fetch(`${settings.api ?? 'https://api.github.com'}/repos/${settings.repo}/${path}`, {
    ...init,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${settings.token}`, Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return undefined;
  if (response.status === 409 || response.status === 422) throw new Conflict();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

/** The library as saved (at commit `ref`, or the latest): { library, version }, or undefined if there is none yet. */
export async function pull(settings, ref) {
  const file = await call(settings, `contents/${settings.path}${ref ? `?ref=${ref}` : ''}`);
  if (!file) return undefined;
  // Files over a megabyte come without their content: fetch it as a blob.
  const content = file.content || (await call(settings, `git/blobs/${file.sha}`)).content;
  return { library: JSON.parse(from64(content)), version: file.sha };
}

/** Saves the library as the version after `version`. Returns the new version; throws Conflict if `version` is not the latest. */
export async function push(settings, library, version, message) {
  const body = JSON.stringify({ message, content: text64(JSON.stringify(library, null, 1)), sha: version });
  const done = await call(settings, `contents/${settings.path}`, { method: 'PUT', body });
  if (!done) throw new Error('Repository not found, or the token has no access to it.');
  return done.content.sha;
}

/** The saved versions, newest first: [{ ref, at }]. */
export async function history(settings) {
  const commits = (await call(settings, `commits?path=${encodeURIComponent(settings.path)}&per_page=40`)) ?? [];
  return commits.map((commit) => ({ ref: commit.sha, at: commit.commit.committer.date }));
}
