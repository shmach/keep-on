# Keep on

![Keep on Logo](/assets/keep-on-banner.png)

A Chrome/Firefox browser extension that enforces focus sessions with smart, real-time distraction detection.

Start a timed focus session and pick a focus tab. When you wander onto a blacklisted site (social media, etc.), an alarm triggers after a short grace period — overlaying a motivational message and a button to jump back to your focus tab.

**Why it's different:** Unlike blockers that permanently lock you out, Keep On reacts in real time and respects breaks. It's a *partner*, not a *jailer*.

## Features

- ⏱️ **Timed sessions** — set a duration and track time left from the popup
- 🚨 **Smart distraction detection** — blacklisted sites trigger an alarm only after a configurable grace period, so quick glances don't punish you
- 🖼️ **Full-page overlay** — blurred background, distraction counter, motivational message and advices to focus back
- 🔊 **Optional audio alarm**
- 📊 **Session stats** — distraction count and total time distracted, shown when the session ends
- ⚙️ **Configurable settings** — editable blacklist, grace period (5–60s), and alarm sound toggle
- ⌨️ **Keyboard shortcut** — `Alt+F` to toggle a session on/off
- 🎨 **Icon state** — the toolbar icon reflects whether a session is active

## Tech Stack

- **Manifest V3** — current Chrome/Firefox standard
- **Vanilla JavaScript** — no build step, no dependencies
- **Chrome Storage API** — persistent state (`chrome.storage.local`)
- **Chrome Tabs API** — active tab tracking and manipulation

## Firefox Compatibility

Firefox supports Manifest V3 extensions, but background service workers require the `background.service_worker` key, which is only available in **Firefox 128 or later**. If you're running an older version, the extension will fail to load. To enable service worker support in compatible versions, go to `about:config` and set `extensions.backgroundServiceWorker.enabled` to `true` — this flag may not be present in all builds, as it was still behind a preference during early MV3 rollout.

## Installation (Chrome)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select this project's root directory
5. The extension appears in your toolbar — click it to open the popup

## Usage

1. Click the Keep on icon to open the popup.
2. Enter a session duration (in minutes) and optionally choose a focus tab.
3. Click **Start Session**.
4. Stay on task. If you open a blacklisted site, you have a grace period (default 15s) before the alarm fires.
5. When the alarm triggers, navigate away or close the blacklist tab and the overlay dismisses itself.
6. When time runs out, the popup shows your session stats.

Adjust the blacklist, grace period, and alarm sound from the **Settings** page (the **Settings** button in the popup, or the extension's options page).

## Project Structure

```
.
├── manifest.json              # MV3 manifest config
├── background/
│   └── service_worker.js      # Session state machine, tab monitoring, alarm logic
├── content/
│   ├── overlay.js             # Injects the alarm overlay into tabs
│   └── overlay.css            # Overlay styling
├── popup/
│   ├── popup.html             # Session control UI
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html           # Settings: blacklist, grace period, alarm sound
│   ├── options.js
│   └── options.css
├── lib/
│   └── shared.js              # Default settings + domain normalization/matching
├── privacy-policy.html        # Privacy policy published for the Chrome Web Store
└── assets/                    # Icons, logo, banner, store screenshots
```

## How It Works

- The **service worker** holds the session state machine. It listens to `chrome.tabs.onActivated` / `onUpdated` / `onRemoved`, extracts each tab's hostname, and matches it against the blacklist (exact host or subdomain, so `notyoutube.com` never counts as `youtube.com`).
- On a blacklist match it starts a per-tab grace period. Leave the tab in time and it's cancelled; otherwise the overlay is shown in that tab.
- **The session clock pauses while the overlay is up.** Distracted time is never charged against your focus time: the session's target end time is pushed forward by exactly the paused duration, and the `session-end` alarm is rescheduled to match — so the countdown you see and the alarm that actually fires can't drift apart.
- A distraction ends when you dismiss the overlay, switch tabs, navigate away, or close the tab.
- **Timers:** the session end uses `chrome.alarms` (`when: endsAt`), which survives the service worker sleeping. Grace periods can be as short as 5s — below the ~30s floor Chrome enforces on alarms — so they run on `setTimeout`, with their start time persisted to `chrome.storage.local` and a 30s watchdog alarm that rebuilds them whenever the worker has been asleep.
- Session state and settings live in `chrome.storage.local`, so they persist across reloads.

## Manual Smoke Test

There's no automated suite (the behaviour only exists inside a real browser). After changing session, tab or timer logic, load the unpacked extension and check:

1. Start a 2-minute session → the popup counts down and the toolbar badge reads `ON`.
2. Open a blacklisted site → the overlay appears after the grace period, with the alarm sound if enabled.
3. Leave before the grace period is up → no overlay.
4. Sit on the overlay for ~30s, then switch tabs → the overlay closes on its own and the countdown resumes where it stopped (it does **not** lose those 30s).
5. Let the session run out → system notification, `✓` badge, and stats in the popup.
6. In Settings, add `https://Example.com/path` → it's stored as `example.com`; visiting `notexample.com` triggers nothing.

## Debugging

- **Service worker logs:** `chrome://extensions/` → click **Service worker** for this extension
- **Content script logs:** right-click any page → Inspect → Console
- **Popup logs:** right-click the popup → Inspect → Console

## License

MIT
