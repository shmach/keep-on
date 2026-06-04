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
└── assets/
    └── icons/                 # Extension icons
```

## How It Works

- The **service worker** holds the session state machine. It listens to `chrome.tabs.onActivated` / `onUpdated`, extracts each tab's hostname, and checks it against the blacklist.
- On a blacklist match it schedules a per-tab `chrome.alarms` grace-period timer. Leave the tab in time and the alarm is cleared; otherwise it fires and tells the content script to show the overlay.
- Long-running timers use `chrome.alarms` (not `setTimeout`) so they survive the service worker sleeping after ~5 min of inactivity.
- Session state and settings live in `chrome.storage.local`, so they persist across reloads.

## Debugging

- **Service worker logs:** `chrome://extensions/` → click **Service worker** for this extension
- **Content script logs:** right-click any page → Inspect → Console
- **Popup logs:** right-click the popup → Inspect → Console

## License

MIT
