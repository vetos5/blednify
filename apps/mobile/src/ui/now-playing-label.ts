/**
 * The mini player's spoken name. Native says what it is first ("Now playing: …"). On web the name has to start with
 * the visible text, title then artist, so voice control ("click Lurk") still matches what is on screen (WCAG 2.5.3);
 * the rest of it says what the bar is and what a tap does, which the visible text alone didn't.
 */
export function nowPlayingLabel(title: string, artist: string, web: boolean): string {
  return web ? `${title}, ${artist}. Now playing, open player` : `Now playing: ${title} by ${artist}. Open player`;
}
