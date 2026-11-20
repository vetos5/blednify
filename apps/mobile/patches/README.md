# Web tab pager regression checks

`react-native-tab-view@4.3.4.patch` fixes the web `PanResponderAdapter`. Android and iOS
continue to use their existing `PagerViewAdapter`; neither native adapter is patched here.
The dependency is pinned so an update cannot silently bypass this patch.

The web pager decides at pointer-down whether the gesture began in a horizontally scrollable
descendant. That descendant owns the whole gesture, including at the ends of its scroll range.
Touch events still reach the child so tapping and long-press actions keep working.

Web tab settling uses a bounded 320ms timing animation on the pager's existing Animated
value. The highlight, icon crossfade and labels from upstream follow this same value during
both dragging and settling. JavaScript still drives web frames; this preserves live tracking
while shortening the old spring. Upstream's Reanimated web tab faces and pager GPU layer
are retained. Resize, cancellation and reduced motion are handled on web.
Both source and compiled module are patched; native animation code stays unchanged.

After changing the patch or upgrading tab-view, verify these cases with real pointer input:

- For Classic, Floating and Glass, swipe the Home song and album rails in both directions.
  The row must scroll while the route and pager translation remain on Home. Repeat at the
  row's end: an outward swipe must not navigate to Search.
- Tap and long-press a card after scrolling; playback and its action sheet must still work.
  Release the long press and confirm the sheet stays open. Then start a new touch on the
  scrim and confirm the sheet actually disappears before testing the next gesture. Repeat
  with the opening finger over a sheet action: releasing must not activate that action.
  On WebKit, a touch and its compatibility click can carry different pointer IDs. Fresh
  taps on the scrim and sheet actions must still work; ownership is based on where the
  gesture began rather than comparing IDs across event types.
- Swipe the mini player to skip tracks: the track must change while the selected tab stays put.
- Swipe empty page space to change tabs; a short pull must rebound and cancellation must
  preserve the committed tab.
- Interrupt a transition with another tab tap or the opposite swipe. The final route, selected
  pill and visible page must agree. Resize during a transition and check again.
  For Floating and Glass, also check the indicator's fractional position while the finger
  is down and halfway through settling. It must follow the visible page, not jump ahead.
  After shrinking from 430px to 390px, the document and browser viewport must both stay 390px
  wide; the web root clips offscreen scenes to prevent them from expanding the viewport.
- Check tab selection by keyboard, direct tab URLs and reduced motion. On desktop, check
  rail arrow buttons and resizing to/from phone width.
- For Floating and Glass, open `/library` or `/search` directly, then tap Home. Repeat
  after opening a playlist/detail page and going back. The live listener must start from
  the current web tab rather than leaving Home's action incorrectly marked active.

Check pointer ownership and movement while the finger is down, not just the final URL. A
successful empty-space swipe does not cover the nested-scroller regression.

For Chromium CDP automation, use one input session and contact for both taps and drags. Check that
each single-finger touch-start reports one active contact; overlapping synthetic contacts
would test a multi-touch sequence instead of the user's swipe.

Use a persistent browser profile when testing SQLite/OPFS in Linux WebKit: its private
contexts can reject file storage. Confirm touch events are trusted and single-contact.
Linux WPE protocol touches exercise the responder, while native wheel input separately
checks scrolling; neither reproduces iOS touch inertia. Activating the standalone CSS
branch in a test response is a layout simulation, not an installed iPhone app. Real status
bar/home-indicator insets, keyboard zoom, background audio and frame pacing still need
an iPhone check.

# expo-router: imperative router after an activity recreation

`expo-router@58.0.30.patch` (version pinned for the same reason) fixes the cleanup of
`ImperativeRoutingQueueBridge`. When Android recreates the activity (system font size or display
size changed while the app was open), the new React root binds the shared `router` before the old
root unmounts, and the old root's cleanup then reset it to the "unbound" router: every later
`router.push` threw "The imperative router is unavailable before the first render has finished",
which crashed the app on the next tap that navigates. The cleanup now unbinds only the router it
bound itself.

Check after changing the patch or upgrading expo-router: open the app, change the system font size,
come back, and open Settings → Appearance (no crash, the page opens).
