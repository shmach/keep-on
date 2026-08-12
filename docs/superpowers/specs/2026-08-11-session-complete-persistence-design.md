# Persist session-complete stats across popup closes

**Date:** 2026-08-11
**Status:** Approved

## Problem

The popup already has a fully built "Session Complete" screen (`#session-ended` in
`popup/popup.html`), but it almost never appears. `showSessionEnded()` is only invoked
in two places in `popup/popup.js`:

- the `setInterval` live-update loop, if the popup is still open when the session ends
- the `SESSION_ENDED` runtime message, only if `currentSession` is already set (i.e. the
  popup was open and tracking an active session)

Chrome closes extension popups as soon as they lose focus. Most sessions run for
minutes or hours, so by the time a session ends naturally (or via the `toggle-session`
keyboard shortcut), the popup that started it is long gone. The next time the user
opens the popup, `GET_SESSION` reports `session.active === false`, and
`updateSessionState()` falls straight through to `showInactiveState()` — the
"Session Complete" screen is never reached.

## Goals

- Show the "Session Complete" screen the next time the popup opens, regardless of
  whether the popup was open when the session actually ended.
- Cover every path that ends a session: manual stop, natural expiry, watchdog
  force-end, and the `toggle-session` keyboard shortcut — all of which already funnel
  through `endSession()` in `background/service_worker.js`.
- Reuse the existing "Session Complete" markup and `showSessionEnded()` logic as-is;
  add to them, don't replace them.
- Give the coach card on that screen a mood (`satisfied` vs `embarrassed`) based on how
  much of the planned session was lost to distractions, not on a raw distraction count
  (3 distractions in a 3-minute session is much worse than 3 in a 3-hour session).

## Non-goals

- No in-page overlay (content script) for session completion. This design replaces
  that idea with the popup-persistence approach.
- No change to the extension icon badge behavior (`✓` already persists until the next
  session start — same lifecycle this design uses for the new screen).
- No new settings/options fields.
- No third coach mood tier (`neutral`) — only the two pools that already exist in
  `lib/coach.js` (`satisfied`, `embarrassed`) are used.

## Design

### 1. Persist the last session's result

In `endSession()` (`background/service_worker.js`), alongside the existing `stats`
computation, write:

```js
await chrome.storage.local.set({
  lastSessionResult: {
    durationMs: stats.durationMs,
    distractions: stats.distractions,
    distractedMs: stats.distractedMs,
    endedAt: Date.now()
  }
});
```

Because `endSession()` is the single function every end path already calls, this
requires no duplicated logic anywhere else.

### 2. Expose it via `GET_SESSION`

The `GET_SESSION` handler's response changes from `{ session }` to
`{ session, lastSessionResult }`, reading the new storage key alongside the existing
`session` read.

### 3. Popup screen selection

In `popup/popup.js`, `updateSessionState()`'s decision becomes:

```
if session && session.active   → active screen (unchanged)
else if lastSessionResult      → "Session Complete" screen (NEW)
else                            → inactive screen (unchanged)
```

No explicit "dismiss" logic is needed. `lastSessionResult` is not cleared by opening
the popup or by clicking "Start New Session" — it is naturally superseded the moment
`session.active` becomes `true` again (i.e. an actual new session starts), which is the
approved dismissal criterion. If the user clicks "Start New Session" but closes the
popup without starting a session, the "Session Complete" screen reappears next open —
this is intended, not a bug, since no new session actually started.

### 4. Utilization ratio and coach mood

Computed in `popup/popup.js` wherever `lastSessionResult` is rendered:

```js
const ratio = lastSessionResult.distractedMs / lastSessionResult.durationMs;
const mood = ratio <= 0.15 ? 'satisfied' : 'embarrassed';
```

`durationMs` is always > 0 (validated in `startSession()`), so no divide-by-zero guard
is needed.

`lib/coach.js`'s `getCoachMoment()` gains a `'complete'` branch (it currently has no
handling for this context at all, despite the `satisfied`/`embarrassed` phrase pools
already existing unused):

```js
if (context === 'complete') {
  const { distractionRatio } = data;
  const mood = distractionRatio <= 0.15 ? 'satisfied' : 'embarrassed';
  const phrases = selectedCoach.phrases[mood];
  const randomIndex = Math.floor(Math.random() * phrases.length);
  response.phrase = phrases[randomIndex];
  response.image = chrome.runtime.getURL(selectedCoach.images[mood]);
  return response;
}
```

The 15% threshold is the single source of truth for the cutoff; it should not be
duplicated with different values between `popup.js` and `coach.js` — pass the computed
`ratio` into `getCoachMoment('complete', { distractionRatio: ratio })` rather than
recomputing the mood in two places.

### 5. Markup

`popup/popup.html`'s `#session-ended` div gets a `.coach-container` block added, in the
same shape already used by `#session-inactive` and `#session-active`:

```html
<div class="coach-container">
  <img data-coach-image src="#" alt="Coach Max" class="coach-image">
  <div class="coach-phrase-container">
    <span data-coach-phrase class="coach-phrase"></span>
  </div>
</div>
```

`CoachController` already selects `[data-coach-image]` / `[data-coach-phrase]`
globally across the whole popup document, so no JS changes are needed for it to pick
up the new elements.

## Data flow summary

```
endSession() (any trigger)
  → writes chrome.storage.local.lastSessionResult
  → (existing) notification + SESSION_ENDED message, unchanged

popup opens
  → GET_SESSION → { session, lastSessionResult }
  → session.active?  → active screen
  → lastSessionResult present? → Session Complete screen
      → ratio = distractedMs / durationMs
      → getCoachMoment('complete', { distractionRatio: ratio })
  → else → inactive screen

user actually starts a new session
  → session.active becomes true
  → Session Complete screen no longer shown (superseded, not explicitly cleared)
```

## Testing

- Start a short session, let it expire naturally with the popup closed, then reopen the
  popup → "Session Complete" screen appears with correct stats.
- Same, but end the session via the `toggle-session` keyboard shortcut with the popup
  closed → same result.
- End a session with 0 distractions → `satisfied` mood.
- End a session where `distractedMs / durationMs > 0.15` → `embarrassed` mood.
- End a session where the ratio is exactly at the 15% boundary → `satisfied` (boundary
  is inclusive, per `ratio <= 0.15`).
- After seeing the "Session Complete" screen, click "Start New Session" and actually
  start a new session → next popup open shows the active screen, not stale stats.
- After seeing the "Session Complete" screen, click "Start New Session" but close the
  popup without starting → reopening shows "Session Complete" again (expected).
- Coach image `onerror` fallback still works on the new coach card (missing/renamed
  asset doesn't break the screen).
