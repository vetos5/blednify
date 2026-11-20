/**
 * The mini player's spoken name. Native says what it is first ("Now playing: …"). On web the name has to start with
 * the visible text, title then artist, so voice control ("click Lurk") still matches what is on screen (WCAG 2.5.3);
 * the rest of it says what the bar is and what a tap does, which the visible text alone didn't.
 */
export function nowPlayingLabel(title: string, artist: string, web: boolean): string {
  return web ? `${title}, ${artist}. Now playing, open player` : `Now playing: ${title} by ${artist}. Open player`;
}

/** What a song row adds after its title and artist: nothing, or whether it is the current song. */
export type RowPlayState = 0 | 1 | 2;
const ROW_STATE = ['', ', paused', ', now playing'] as const;

/**
 * A song row's spoken name. Native: "Lurk by Ghost, now playing". On web the name starts with the visible title and
 * artist (WCAG 2.5.3) instead of being left to the row's text, which read "3 Lurk Ghost 4:12" (track number first,
 * the duration as a bare number) and dropped the playing state, since the playing bars are decorative.
 */
export function trackRowLabel(title: string, artist: string, state: RowPlayState, web: boolean): string {
  return web ? `${title}, ${artist}${ROW_STATE[state]}` : `${title} by ${artist}${ROW_STATE[state]}`;
}
