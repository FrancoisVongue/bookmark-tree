// Is the library kept anywhere but on this computer? Mostly it is, without
// the user doing anything: GitHub if they set it up, the browser's synced
// storage if another computer of theirs shares it. This is for when neither
// holds: then the one copy is here, and the user should hear of it - rarely,
// and only then. Pure: no Chrome here.

const DAY = 24 * 3600 * 1000;
const WORTH_KEEPING = 20; // Nodes: fewer is not yet a library to worry about.
const SYNC_STALE = 3 * DAY;
const BACKUP_STALE = 14 * DAY;

/**
 * What to warn the user of, if anything, given:
 *   nodes      how many nodes the library has
 *   sync       the GitHub settings: { repo, error, at }, or nothing
 *   unsynced   how many pages do not fit in the browser's synced storage
 *   met        whether another computer has ever been seen there
 *   savedAt    when the library was last saved to a file
 *   closedAt   when the user last closed this warning (it comes back, later)
 *   now
 * Returns { kind: 'backup' } - no copy elsewhere, and none saved lately -
 * or { kind: 'sync', error } - GitHub was to keep it and has been failing -
 * or nothing.
 */
export function warningOf({ nodes, sync, unsynced, met, savedAt = 0, closedAt = 0, now }) {
  const synced = sync?.repo && now - (sync.at ?? 0) <= SYNC_STALE;
  const onGitHub = synced && !sync.error;
  const inBrowser = met && !unsynced;
  const alone = nodes >= WORTH_KEEPING && !onGitHub && !inBrowser && now - savedAt > BACKUP_STALE;
  if (!alone || now - closedAt <= BACKUP_STALE) return undefined;
  return sync?.repo && sync.error && !synced ? { kind: 'sync', error: sync.error } : { kind: 'backup' };
}
