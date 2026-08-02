# Keep on Extension — Developer Guide

## Project Overview

A Chrome/Firefox browser extension that enforces focus sessions with smart distraction detection. Users start a timed focus session; when they visit blacklisted sites (social media), an alarm triggers after a configurable grace period (default 15s), overlaying a motivational message with a countdown.

**Key differentiator:** Unlike blockers that permanently prevent access, this tool reacts in real-time, making it a *partner* rather than a *jailer*.

## Tech Stack

- **Manifest V3** — current Chrome/Firefox standard
- **Vanilla JavaScript** — no build step, no dependencies
- **Chrome Storage API** — persistent state (`chrome.storage.local`)
- **Chrome Tabs API** — active tab tracking and manipulation

## Architecture

### File Structure

```
.
├── manifest.json                 # MV3 manifest config
├── background/
│   └── service_worker.js         # Session state machine, tab monitoring, timer logic
├── content/
│   ├── overlay.js                # Injects alarm overlay into tabs
│   └── overlay.css               # Overlay styling
├── popup/
│   ├── popup.html                # Session control UI
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html              # Settings: blacklist, grace period
│   ├── options.js
│   └── options.css
├── lib/
│   └── shared.js                 # DEFAULT_SETTINGS + domain normalization/matching
│                                 # (importScripts in the SW, <script> in options.html)
├── privacy-policy.html           # Chrome Web Store privacy policy page
└── assets/                       # Icons (16/32/48/128), logo, banner, store screenshots
```

The alarm is a WebAudio beep generated in `content/overlay.js` — there is no audio file to ship.

**Planned (phase 7, not implemented yet):** `lib/coach.js` and `assets/coaches/max/*.png`.

### Core Data Model

```js
// chrome.storage.local.session
{
  id: number,                     // = startedAt; tags timers so stale ones are ignored
  active: boolean,
  startedAt: number,              // timestamp (ms)
  durationMs: number,
  endsAt: number,                 // wall-clock target; pushed forward on every pause
  focusTabId: number | null,      // never alarms on this tab
  distractions: number,           // count of alarm triggers
  distractedMs: number,           // cumulative time with the overlay up
  pausedMs: number,               // cumulative paused time (= distractedMs today)
  isPaused: boolean,              // true while a distraction overlay is showing
  pausedStartTime: number | null,
  overlayTabId: number | null     // tab currently showing the overlay
}

// chrome.storage.local.settings  (defaults in lib/shared.js — DEFAULT_SETTINGS)
{
  gracePeriodMs: 15000,           // grace period before alarm (ms)
  alarmSound: true,               // whether to play sound
  blacklist: [
    'twitter.com', 'x.com', 'reddit.com', 'instagram.com',
    'tiktok.com', 'facebook.com', 'youtube.com'
  ],
}

// chrome.storage.local.graceTimers — grace periods in flight, so a sleeping
// service worker can rebuild them on wake
{ [tabId]: { startedAt: number, sessionId: number } }
```

### Key Flows

**Session Start**
1. User opens popup, enters duration (min), optionally picks a focus tab, clicks Start
2. Popup sends `START_SESSION`; the service worker validates the duration and owns all state writes
3. Service worker sets `endsAt`, schedules the `session-end` alarm + the `grace-watchdog` alarm, and evaluates the currently active tab

**Blacklist Detection & Alarm**
1. Service worker listens to `chrome.tabs.onActivated`, `onUpdated` and `onRemoved`
2. On tab change, extract hostname and match it against the blacklist via `isBlacklistedUrl` (exact host or real subdomain — never substring)
3. If match: start a grace period — `setTimeout` for precision, plus a `{ startedAt, sessionId }` record in `storage.graceTimers`
4. If the user leaves the tab before it fires: clear both
5. If it fires: re-check the tab is still active and blacklisted, then send `SHOW_OVERLAY` to the content script

**Session Clock & Pause**
- `endsAt` is the single source of truth for both the popup countdown and the `session-end` alarm
- Showing the overlay pauses the session: `session-end` is cleared, `pausedStartTime` recorded
- Ending a distraction (dismiss, tab switch, navigation, tab close) adds the paused duration to `endsAt` and reschedules the alarm — the UI and the real alarm can never drift apart
- `grace-watchdog` (every 30s while a session is active) rebuilds in-memory timers the sleeping worker lost, drops timers from old sessions, and force-ends a session whose alarm fired late

**Overlay Behavior**
1. Content script receives `{ type: 'SHOW_OVERLAY', sessionInfo, distractionStartedAt, alarmSound }`
2. Injects a full-page overlay: blurred background, live distraction counter, motivational message, "Back to focus tab" (only when `focusTabId` is set) and Dismiss
3. Dismiss → `OVERLAY_DISMISSED` → service worker resumes the clock
4. Switching tabs / ending the session → service worker sends `HIDE_OVERLAY` and closes out the distraction itself

**Session End**
1. `session-end` alarm fires, the watchdog notices the clock passed `endsAt`, or the user clicks Stop
2. Service worker clears `session-end` + `grace-watchdog`, hides any open overlay, computes final stats
3. Natural expiry also fires a system notification and a `✓` badge
4. Sends `{ type: 'SESSION_ENDED', stats }` to the popup, which swaps to the stats screen if it's open

### Coach Character System

A recurring "coach" character delivers humorous motivational phrases with matching AI-generated art across the UI. One character for now (Coach Max); the data structure supports adding more characters and a settings picker later.

**Design decisions (validated 2026-08-01):**

- Images are pre-generated with AI and bundled in `assets/coaches/` — no runtime image-generation API
- Phrases are in English, organized by context, picked randomly within the matching context pool (~6 per pool)
- Coach appears on all four screens: popup idle, popup active session, distraction alarm overlay, session-complete screen

**Data module — `lib/coach.js`** (plain script, no ES modules; loaded by both popup and content script):

```js
const COACHES = {
  max: {
    id: 'max',
    name: 'Coach Max',
    images: {                    // paths relative to extension root
      happy: 'assets/coaches/max/happy.png',
      neutral: 'assets/coaches/max/neutral.png',
      angry: 'assets/coaches/max/angry.png',
      proud: 'assets/coaches/max/proud.png',
      disappointed: 'assets/coaches/max/disappointed.png'
    },
    phrases: {
      welcome: [...],            // popup idle
      active: [...],             // popup during session
      distraction_1: [...],      // 1st distraction — light tone
      distraction_2: [...],      // 2nd — ironic
      distraction_3plus: [...],  // 3rd+ — comically angry
      complete_good: [...],      // 0–2 distractions → proud
      complete_ok: [...],        // 3–5 → neutral
      complete_bad: [...]        // 6+ → disappointed (with humor)
    }
  }
};

// context: 'welcome' | 'active' | 'distraction' | 'complete'
// data: { distractions, minutesIn, minutesLeft }
// → { name, imageUrl, phrase }  (imageUrl resolved via chrome.runtime.getURL)
function getCoachMoment(context, data) { ... }
```

- Phrases support simple placeholders: `{minutes}`, `{distractions}`
- `distraction` and `complete` contexts map `data.distractions` to both the phrase pool and the image mood
- Phrase is picked once per render (popup open / state change / overlay show), not on every countdown tick

**Coach card UI:** circular character image + speech bubble. In the popup it sits below the logo (idle), above the countdown (active), and above the stats (ended). In the overlay it replaces the generic motivational message in both the alarm card and the session-complete card.

**Error handling:** if a coach image fails to load (`onerror`), hide the image and show the phrase alone — a missing asset must never break the UI.

## Development

### Loading the Extension (Chrome)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the project root directory
5. Extension appears in toolbar; click to open popup

### Debugging

- **Service worker logs:** `chrome://extensions/` → click **Service worker** for this extension
- **Content script logs:** Right-click any page → Inspect → Console (if content script injected)
- **Popup logs:** Click extension icon → right-click popup → Inspect → Console

### Testing Checklist

Before considering a phase done:

1. **Session control**
   - [ ] Start a 5-minute session from popup
   - [ ] Current session shows in popup (countdown updates)
   - [ ] Stop button works, session clears
   - [ ] Extension icon shows active state (color change)

2. **Blacklist detection**
   - [ ] Navigate to `reddit.com` → wait 15s → overlay appears
   - [ ] Overlay shows distraction counter + motivational message
   - [ ] Audio alarm plays (if enabled)
   - [ ] Leave reddit before 15s → no overlay appears

3. **Overlay interactions**
   - [ ] Overlay dismisses when navigating away
   - [ ] Distraction counter increments correctly
   - [ ] Switch to another tab while the overlay is up → overlay disappears and the countdown resumes
   - [ ] Close the blacklisted tab while the overlay is up → countdown resumes
   - [ ] With a focus tab set: "Back to focus tab" switches to it and dismisses the overlay

4. **Settings**
   - [ ] Add/remove items from blacklist (options page)
   - [ ] Adjust grace period (5s–60s)
   - [ ] Toggle alarm sound off → overlay appears silently
   - [ ] Changes persist across extension reload
   - [ ] Paste `https://Example.com/some/path` → stored as `example.com`
   - [ ] Enter `<b>x</b>` → rejected as invalid, never rendered as HTML

5. **Stats & clock**
   - [ ] Session ends → popup shows distraction count and total distracted time
   - [ ] Stats match manual count (if you deliberately triggered alarms)
   - [ ] Sit on the overlay for ~1 min → the countdown is frozen and the session really ends 1 min later than originally scheduled
   - [ ] `notyoutube.com` does **not** trigger the alarm; `m.youtube.com` does

6. **Coach character**
   - [ ] Coach card (image + phrase) appears on all four screens: popup idle, popup active, alarm overlay, session complete
   - [ ] Phrase changes between popup opens (random within context pool)
   - [ ] Tone escalates on 2nd and 3rd distraction (phrase pool + image mood change)
   - [ ] Session complete shows proud image for 0–2 distractions, disappointed for 6+
   - [ ] Coach images load inside third-party pages (e.g., reddit.com overlay) — verifies `web_accessible_resources`
   - [ ] Rename an image file → phrase still shows, UI doesn't break (onerror fallback)

## Implementation Phases

See `/plan` for detailed breakdown. TL;DR:

0. **Setup** — folder, git, CLAUDE.md ✓
1. **Manifest + skeleton** — file structure, basic manifest.json ✓
2. **Service worker** — session logic, tab monitoring, timers ✓
3. **Overlay** — content script, visual + audio ✓
4. **Popup UI** — session control + live display ✓
5. **Options page** — blacklist + settings editor ✓
6. **Polish** — icon color change, keyboard shortcut, sound ✓
7. **Coach character** — `lib/coach.js` data module + phrases, AI-generated art in `assets/coaches/max/`, coach card in popup (3 states) and overlay (alarm + complete), manifest changes (`web_accessible_resources` for `assets/coaches/*`, load `lib/coach.js` before `overlay.js` in `content_scripts`), service worker sends `distractions` in `SHOW_OVERLAY`

Out of scope for phase 7 (structure already supports them): character picker in options, additional characters, i18n.

## Notes

- **Service worker persistence:** Chrome's service workers sleep after ~30s of inactivity. Nothing behavioural may live only in memory: `session` (with `endsAt`) and `graceTimers` are persisted, `bootstrap()` runs on every wake, and `grace-watchdog` re-checks state every 30s.
- **Why grace periods aren't `chrome.alarms`:** Chrome clamps alarms to a ~30s minimum, but the grace period is configurable from 5s. So grace periods use `setTimeout` for precision, backed by a persisted `startedAt` + the watchdog for durability. The `session-end` alarm *is* a real alarm (`when: endsAt`), since it's always minutes away.
- **Permissions:** `tabs` covers reading tab URLs; `content_scripts.matches: <all_urls>` (plus `host_permissions`) covers injecting the overlay anywhere. `activeTab` was removed — it was redundant with `tabs`. Any permission change must be mirrored in `privacy-policy.html`.
- **Icon state:** We update the extension icon via `chrome.action.setIcon()` when session starts/ends to give visual feedback without opening the popup. `updateIcon()` in `background/service_worker.js` renders the real logo (`assets/keep-on-128x128.png`) onto an `OffscreenCanvas`, applying `ctx.filter = 'grayscale(100%)'` when the session is inactive — full color while active, grayscale while stopped.
- **Domain matching:** Always go through `isBlacklistedUrl` / `normalizeDomain` in `lib/shared.js`. Matching is exact-host-or-subdomain — never `hostname.includes(domain)`, which made `notyoutube.com` match `youtube.com`.
- **User input in the DOM:** Blacklist entries are user-supplied. Render them with `textContent`, never by interpolating into `innerHTML`.
- **Coach images on third-party pages:** The overlay runs inside pages like reddit.com, so bundled images only load there if declared in `web_accessible_resources` in manifest.json (`assets/coaches/*` with `<all_urls>` matches). Always resolve paths with `chrome.runtime.getURL()` — works in both popup and content script contexts.
- **Coach art specs:** 256×256 PNG, transparent background, one file per mood (happy, neutral, angry, proud, disappointed). Generate all moods for a character in the same AI session with a shared base prompt so the style stays consistent.

## Useful Chrome API Docs

- https://developer.chrome.com/docs/extensions/reference/tabs/
- https://developer.chrome.com/docs/extensions/reference/storage/
- https://developer.chrome.com/docs/extensions/reference/action/
