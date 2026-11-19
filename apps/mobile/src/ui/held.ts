/**
 * Words for the confirm sheet a held rescan shows (see `/api/rescan` in docs/API.md). Pure, so the counts are
 * tested (test/held.test.ts). Held songs with an identical copy elsewhere follow that copy when the admin
 * confirms (likes and playlists keep them); only the rest are really removed.
 */
import { plural } from './format';

export type HeldScan = { held: number; heldFolders?: string[]; heldWithCopy?: number };

export type HeldConfirm = { title: string; message: string; confirmLabel: string; destructive: boolean };

export function heldConfirm({ held, heldFolders, heldWithCopy }: HeldScan): HeldConfirm {
  const withCopy = Math.min(Math.max(heldWithCopy ?? 0, 0), held);
  const removed = held - withCopy;
  // Older servers don't name the folders.
  const where = heldFolders?.length
    ? `\n\nMissing from: ${heldFolders.map((d) => d || 'the music folder itself').join(', ')}${heldFolders.length >= 5 ? ', …' : ''}`
    : '';
  const mount = 'Their files are no longer in the server’s music folder. If a drive or folder isn’t mounted, mount it and rescan instead.';
  const title = `${plural(held, 'song')} missing on the server`;
  if (removed === 0)
    return {
      title,
      message: `${mount} Each of them has an identical copy elsewhere in the library: confirming moves them onto their copies, and likes and playlists keep them.${where}`,
      confirmLabel: 'Use the copies',
      destructive: false,
    };
  const copies = withCopy
    ? ` ${plural(withCopy, 'song')} ${withCopy === 1 ? 'has' : 'have'} an identical copy elsewhere and will move onto it; the other ${plural(removed, 'song')} will be removed, also from likes and playlists on every device.`
    : ' Removing them also takes them out of likes and playlists on every device.';
  return { title, message: `${mount}${copies}${where}`, confirmLabel: 'Remove', destructive: true };
}
