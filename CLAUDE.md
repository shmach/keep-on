# Focus Alarm Extension — Developer Guide

## Project Overview

A Chrome/Firefox browser extension that enforces focus sessions with smart distraction detection. Users start a timed focus session and set a focus tab; when they visit blacklisted sites (social media), an alarm triggers after a configurable grace period (default 15s), overlaying a motivational message with a countdown and a button to return to the focus tab.

**Key differentiator:** Unlike blockers that permanently prevent access, this tool reacts in real-time and respects breaks, making it a *partner* rather than a *jailer*.

## Tech Stack

- **Manifest V3** — current Chrome/Firefox standard
- **Vanilla JavaScript** — no build step, no dependencies
- **Chrome Storage API** — persistent state (`chrome.storage.local`)
- **Chrome Alarms API** — timers (survives service worker sleep)
- **Chrome Tabs API** — active tab tracking and manipulation

## Architecture

### File Structure

```
.
├── manifest.json                 # MV3manifest config
├── background/
│   └── service_worker.js         # Session state machine, tab monitoring, alarm logic
├── content/
│   ├── overlay.js                # Injects alarm overlay into tabs
│   └── overlay.css               # Overlay styling
├── popup/
│   ├── popup.html                # Session control UI
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html              # Settings: blacklist, grace period, pomodoro config
│   ├── options.js
│   └── options.css
├── lib/
│   └── storage.js                # Storage abstraction (optional, can be omitted for simplicity)
└── assets/
    ├── alarm.mp3                 # Alarm sound
    └── icons/                    # 16x16, 48x48, 128x128 extension icons
```

### Core Data Model

```js
// chrome.storage.local.session
{
  active: boolean,
  startedAt: number,              // timestamp (ms)
  durationMs: number,
  focusTabId: number | null,
  pomodoroMode: boolean,
  phase: 'focus' | 'break',       // only if pomodoro enabled
  distractions: number,           // count of alarm triggers
  distractedMs: number,           // cumulative time on blacklist tabs
  lastBlacklistVisit: number      // timestamp of last blacklist tab activation
}

// chrome.storage.local.settings
{
  gracePeriodMs: 15000,           // grace period before alarm (ms)
  alarmSound: true,               // whether to play sound
  blacklist: [
    'twitter.com', 'x.com', 'reddit.com', 'instagram.com',
    'tiktok.com', 'facebook.com', 'youtube.com'
  ],
  pomodoroDurationMs: 1500000,    // 25 min
  breakDurationMs: 300000,        // 5 min
}

// chrome.storage.local.history (optional)
[
  { date: number, durationMs, distractions, distractedMs },
  ...
]
```

### Key Flows

**Session Start**
1. User opens popup, enters duration (min), optionally pins current tab as focus tab, clicks Start
2. Popup writes session state + settings to `chrome.storage.local`
3. Service worker reads change, starts monitoring tabs + sets up alarms

**Blacklist Detection & Alarm**
1. Service worker listens to `chrome.tabs.onActivated` and `chrome.tabs.onUpdated`
2. On tab change, extract hostname; check if in blacklist + session is active (not in break phase)
3. If match: set a `chrome.alarms.create('grace-period-[tabId]', { delayInMinutes: gracePeriodMs/60000 })`
4. If user leaves tab before alarm fires: `chrome.alarms.clear('grace-period-[tabId]')`
5. If alarm fires: service worker sends message to content script → overlay injected

**Overlay Behavior**
1. Content script receives `{ type: 'SHOW_OVERLAY', sessionInfo, focusTabId }`
2. Injects full-page overlay with:
   - Blurred background
   - Distraction counter (e.g., "You've been here for 23 seconds")
   - Motivational message (e.g., "You're 15 min into your session — stay sharp")
   - "Go Back to Focus Tab" button
3. Button click: `chrome.tabs.update(focusTabId, { active: true })`
4. Overlay auto-dismisses if user navigates away (detects URL change)

**Session End**
1. Timer reaches 0 OR user clicks Stop
2. Service worker clears all alarms, computes final stats
3. Sends `{ type: 'SESSION_ENDED', stats }` to popup
4. Popup displays stats, then clears session state

**Pomodoro Mode**
1. If enabled: session alternates between focus phase (25 min) and break phase (5 min)
2. During break: blacklist is *not* enforced (no overlay triggered)
3. Phase transition is automatic via `chrome.alarms.create('phase-end')`

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
   - [ ] Click "Go Back to Focus Tab" → redirects to focus tab
   - [ ] Overlay dismisses when navigating away
   - [ ] Distraction counter increments correctly

4. **Pomodoro mode**
   - [ ] Enable Pomodoro, start session
   - [ ] After 25 min, phase switches to "break"
   - [ ] Visit blacklist site during break → no overlay (check popup shows "break" state)
   - [ ] After 5 min break, phase switches back to "focus"

5. **Settings**
   - [ ] Add/remove items from blacklist (options page)
   - [ ] Adjust grace period (5s–60s)
   - [ ] Toggle alarm sound
   - [ ] Changes persist across extension reload

6. **Stats**
   - [ ] Session ends → popup shows distraction count and total distracted time
   - [ ] Stats match manual count (if you deliberately triggered alarms)

## Implementation Phases

See `/plan` for detailed breakdown. TL;DR:

0. **Setup** — folder, git, CLAUDE.md ✓
1. **Manifest + skeleton** — file structure, basic manifest.json
2. **Service worker** — session logic, tab monitoring, alarms
3. **Overlay** — content script, visual + audio
4. **Popup UI** — session control + live display
5. **Options page** — blacklist + settings editor
6. **Polish** — icon color change, keyboard shortcut, sound

## Notes

- **Service worker persistence:** Chrome's service workers sleep after 5 min of inactivity. Use `chrome.alarms` for long-running timers (our pomodoro/session timers), not `setInterval` or `setTimeout`.
- **Content script permissions:** We use `content_scripts` that match `<all_urls>`, so the overlay can inject into any page. This is safe (no privilege escalation) and necessary for the feature.
- **Icon state:** We update the extension icon color via `chrome.action.setIcon()` when session starts/ends to give visual feedback without opening the popup.
- **Hostname extraction:** Use `new URL(tab.url).hostname` for consistent domain parsing (handles www vs non-www, ports, etc.).

## Useful Chrome API Docs

- https://developer.chrome.com/docs/extensions/reference/tabs/
- https://developer.chrome.com/docs/extensions/reference/storage/
- https://developer.chrome.com/docs/extensions/reference/alarms/
- https://developer.chrome.com/docs/extensions/reference/action/
