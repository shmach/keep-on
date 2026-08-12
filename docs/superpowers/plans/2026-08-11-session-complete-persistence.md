# Session-Complete Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the popup's existing "Session Complete" screen the next time the popup opens, even if it was closed when the session actually ended, with the coach card's mood driven by how much of the session was lost to distractions.

**Architecture:** `endSession()` in the service worker (the single function every end path already calls) persists a `lastSessionResult` snapshot to `chrome.storage.local`. `GET_SESSION` returns it alongside `session`. The popup prefers the active screen, falls back to the ended screen when `lastSessionResult` exists, and falls back to the inactive screen otherwise — no explicit "dismiss" needed, since a new session starting supersedes it naturally. Coach mood is a two-tier `satisfied`/`embarrassed` split based on `distractedMs / durationMs`.

**Tech Stack:** Vanilla JS, Manifest V3 (`chrome.storage.local`, `chrome.runtime` messaging). No build step, no test runner — verification is manual via the browser and the extension's DevTools consoles, per this project's existing `CLAUDE.md` Testing Checklist convention.

## Global Constraints

- No new `settings`/options fields (spec: Non-goals).
- No in-page overlay / content-script changes for this feature (spec: Non-goals).
- Only two coach mood tiers exist: `satisfied` and `embarrassed` — no `neutral` tier (spec: Non-goals).
- The 15% ratio threshold (`distractedMs / durationMs <= 0.15 → satisfied`) is computed once and passed into `getCoachMoment('complete', { distractionRatio })` — never recomputed or duplicated with a different value elsewhere (spec: Design §4).
- Extension icon badge behavior is unchanged (spec: Non-goals).

---

### Task 1: Persist and expose the last session's result

**Files:**
- Modify: `background/service_worker.js:114-163` (`endSession`)
- Modify: `background/service_worker.js:537-548` (`GET_SESSION` handler)

**Interfaces:**
- Produces: `chrome.storage.local` key `lastSessionResult: { durationMs: number, distractions: number, distractedMs: number, endedAt: number }`, written every time a session ends (manual stop, natural expiry, watchdog force-end, `toggle-session` shortcut — all funnel through `endSession()`).
- Produces: `GET_SESSION` response shape changes from `{ session }` to `{ session, lastSessionResult: object | null }`.

- [ ] **Step 1: Write `lastSessionResult` inside `endSession()`**

  Open `background/service_worker.js`. Find the `stats` block (currently lines 124-129):

  ```js
  // Capture stats before mutating session state
  const stats = {
    durationMs: session.durationMs,
    distractions: session.distractions,
    distractedMs: session.distractedMs
  };

  const overlayTabId = session.overlayTabId;
  ```

  Add a storage write immediately after it:

  ```js
  // Capture stats before mutating session state
  const stats = {
    durationMs: session.durationMs,
    distractions: session.distractions,
    distractedMs: session.distractedMs
  };

  const overlayTabId = session.overlayTabId;

  await chrome.storage.local.set({
    lastSessionResult: {
      durationMs: stats.durationMs,
      distractions: stats.distractions,
      distractedMs: stats.distractedMs,
      endedAt: Date.now()
    }
  });
  ```

- [ ] **Step 2: Return `lastSessionResult` from the `GET_SESSION` handler**

  Find the `GET_SESSION` handler (currently lines 537-548):

  ```js
  if (request.type === 'GET_SESSION') {
    (async () => {
      let session = await getSession();
      // Close out a session whose end alarm fired late or not at all
      if (session && session.active && !session.isPaused && Date.now() >= session.endsAt) {
        await endSession(true);
        session = await getSession();
      }
      sendResponse({ session });
    })();
    return true; // async response
  }
  ```

  Replace the body so it also reads and returns `lastSessionResult`:

  ```js
  if (request.type === 'GET_SESSION') {
    (async () => {
      let session = await getSession();
      // Close out a session whose end alarm fired late or not at all
      if (session && session.active && !session.isPaused && Date.now() >= session.endsAt) {
        await endSession(true);
        session = await getSession();
      }
      const { lastSessionResult } = await chrome.storage.local.get('lastSessionResult');
      sendResponse({ session, lastSessionResult: lastSessionResult || null });
    })();
    return true; // async response
  }
  ```

- [ ] **Step 3: Reload the extension and verify manually**

  1. Go to `chrome://extensions/`, click the reload icon on "Keep on".
  2. Click **Service worker** to open its DevTools console.
  3. Run `chrome.storage.local.get('lastSessionResult', console.log)` — should log `{}` (key absent) unless a previous run left one.
  4. Open the popup, start a 1-minute session, click **Stop Session**.
  5. Back in the service worker console, rerun `chrome.storage.local.get('lastSessionResult', console.log)` — should now log an object with `durationMs`, `distractions: 0`, `distractedMs: 0`, and a recent `endedAt` timestamp.
  6. Still in the service worker console, run `chrome.runtime.sendMessage({ type: 'GET_SESSION' }, console.log)` — the logged response must have both `session` (with `active: false`, since the session was already stopped) and `lastSessionResult`.

- [ ] **Step 4: Commit**

  ```bash
  git add background/service_worker.js
  git commit -m "feat: persist last session result for popup to show after close"
  ```

---

### Task 2: Add the `complete` context to the coach data module

**Files:**
- Modify: `lib/coach.js:90-117` (`getCoachMoment`)

**Interfaces:**
- Consumes: `coaches.max.phrases.satisfied` and `coaches.max.phrases.embarrassed` (arrays of strings, already defined in `lib/coach.js`); `coaches.max.images.satisfied` and `coaches.max.images.embarrassed` (already defined).
- Produces: `getCoachMoment('complete', { distractionRatio: number })` → `{ phrase: string, image: string }`, where `image` is a `chrome.runtime.getURL(...)` result. Mood selection: `distractionRatio <= 0.15 → 'satisfied'`, else `'embarrassed'`.

- [ ] **Step 1: Add the `complete` branch to `getCoachMoment`**

  Open `lib/coach.js`. Find the `distraction` branch's closing (currently lines 95-106):

  ```js
  if (context === 'distraction') {
    const { distractions, minutesIn, minutesLeft, url } = data;

    const distractionCount = distractions > 3 ? 'infinity' : distractions;

    const distractionPhrases = selectedCoach.phrases.distraction[distractionCount];
    randomIndex = Math.floor(Math.random() * distractionPhrases.length);
    response.phrase = distractionPhrases[randomIndex];
    response.image = chrome.runtime.getURL(selectedCoach.images.angry);

    return response;
  }

  const phrases = selectedCoach.phrases[context];
  ```

  Insert a new `complete` branch between the `distraction` block's `return response; }` and the generic fallback:

  ```js
  if (context === 'distraction') {
    const { distractions, minutesIn, minutesLeft, url } = data;

    const distractionCount = distractions > 3 ? 'infinity' : distractions;

    const distractionPhrases = selectedCoach.phrases.distraction[distractionCount];
    randomIndex = Math.floor(Math.random() * distractionPhrases.length);
    response.phrase = distractionPhrases[randomIndex];
    response.image = chrome.runtime.getURL(selectedCoach.images.angry);

    return response;
  }

  if (context === 'complete') {
    const { distractionRatio } = data;
    const mood = distractionRatio <= 0.15 ? 'satisfied' : 'embarrassed';

    const completePhrases = selectedCoach.phrases[mood];
    randomIndex = Math.floor(Math.random() * completePhrases.length);
    response.phrase = completePhrases[randomIndex];
    response.image = chrome.runtime.getURL(selectedCoach.images[mood]);

    return response;
  }

  const phrases = selectedCoach.phrases[context];
  ```

- [ ] **Step 2: Reload the extension and verify manually**

  1. Go to `chrome://extensions/`, click reload on "Keep on".
  2. Open the popup, right-click it, choose **Inspect** to open its DevTools console (`lib/coach.js` is loaded there via `<script src="/lib/coach.js">` in `popup/popup.html`).
  3. Run `getCoachMoment('complete', { distractionRatio: 0 })` — `phrase` must be one of the strings in `coaches.max.phrases.satisfied`.
  4. Run `getCoachMoment('complete', { distractionRatio: 0.15 })` — `phrase` must still come from `satisfied` (boundary is inclusive: `<= 0.15`).
  5. Run `getCoachMoment('complete', { distractionRatio: 0.16 })` — `phrase` must come from `coaches.max.phrases.embarrassed`.
  6. Run `getCoachMoment('complete', { distractionRatio: 1 })` — `phrase` must come from `embarrassed`.

- [ ] **Step 3: Commit**

  ```bash
  git add lib/coach.js
  git commit -m "feat: add complete context to getCoachMoment for session-end mood"
  ```

---

### Task 3: Add the coach card markup to the Session Complete screen

**Files:**
- Modify: `popup/popup.html:71-92` (`#session-ended`)

**Interfaces:**
- Produces: a third `.coach-container` block (with `[data-coach-image]` / `[data-coach-phrase]` elements) inside `#session-ended`, matching the existing blocks in `#session-inactive` and `#session-active`. No JS changes needed for `CoachController` to pick it up — it already selects these attributes globally across the popup document.

- [ ] **Step 1: Add the coach-container block**

  Open `popup/popup.html`. Find the `#session-ended` div's opening (currently lines 71-75):

  ```html
    <!-- Session ended state -->
    <div id="session-ended" class="session-state" style="display: none;">
      <h1>✅ Session Complete!</h1>

      <div class="session-stats">
  ```

  Insert a coach-container between the `<h1>` and the stats block:

  ```html
    <!-- Session ended state -->
    <div id="session-ended" class="session-state" style="display: none;">
      <h1>✅ Session Complete!</h1>

      <div class="coach-container">
        <img data-coach-image src="#" alt="Coach Max" class="coach-image">
        <div class="coach-phrase-container">
          <span data-coach-phrase class="coach-phrase"></span>
        </div>
      </div>

      <div class="session-stats">
  ```

- [ ] **Step 2: Reload the extension and verify manually**

  1. Go to `chrome://extensions/`, click reload on "Keep on".
  2. Open the popup, right-click it, choose **Inspect**.
  3. In the console, run `document.querySelectorAll('[data-coach-image]').length` — must be `3` (previously `2`, one each for inactive and active states).
  4. Run `document.getElementById('session-ended').querySelector('.coach-container')` — must return the new element, not `null`.

- [ ] **Step 3: Commit**

  ```bash
  git add popup/popup.html
  git commit -m "feat: add coach card markup to session-complete screen"
  ```

---

### Task 4: Wire the popup to show the persisted result with the right coach mood

**Files:**
- Modify: `popup/popup.js:72-85` (`updateSessionState`)
- Modify: `popup/popup.js:154-167` (`showSessionEnded`)

**Interfaces:**
- Consumes: `GET_SESSION` response shape `{ session, lastSessionResult }` from Task 1; `getCoachMoment('complete', { distractionRatio })` from Task 2; `.coach-container` markup inside `#session-ended` from Task 3; existing module-level `coachController` (a `CoachController` instance, already declared in `popup/popup.js`).
- Produces: `showSessionEnded(session)` now also drives the coach card — this is called from three places (the live-update loop, the `SESSION_ENDED` message listener, and the new `lastSessionResult` fallback in `updateSessionState`), so all three automatically get the coach card once this task lands.

- [ ] **Step 1: Prefer `lastSessionResult` over the inactive screen in `updateSessionState`**

  Open `popup/popup.js`. Find `updateSessionState` (currently lines 73-85):

  ```js
  async function updateSessionState() {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
      if (!response) return;
      const session = response.session;

      if (!session || !session.active) {
        showInactiveState();
      } else {
        showActiveState(session);
        startLiveUpdates();
      }
    });
  }
  ```

  Replace it with:

  ```js
  async function updateSessionState() {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
      if (!response) return;
      const session = response.session;

      if (session && session.active) {
        showActiveState(session);
        startLiveUpdates();
      } else if (response.lastSessionResult) {
        showSessionEnded(response.lastSessionResult);
      } else {
        showInactiveState();
      }
    });
  }
  ```

- [ ] **Step 2: Drive the coach card from `showSessionEnded`**

  Find `showSessionEnded` (currently lines 154-167):

  ```js
  function showSessionEnded(session) {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }

    sessionInactiveDiv.style.display = 'none';
    sessionActiveDiv.style.display = 'none';
    sessionEndedDiv.style.display = 'block';

    document.getElementById('stat-duration').textContent = formatMs(session.durationMs);
    document.getElementById('stat-distractions').textContent = session.distractions;
    document.getElementById('stat-distracted-time').textContent = formatMs(session.distractedMs);
  }
  ```

  Add the ratio computation and coach call at the end:

  ```js
  function showSessionEnded(session) {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }

    sessionInactiveDiv.style.display = 'none';
    sessionActiveDiv.style.display = 'none';
    sessionEndedDiv.style.display = 'block';

    document.getElementById('stat-duration').textContent = formatMs(session.durationMs);
    document.getElementById('stat-distractions').textContent = session.distractions;
    document.getElementById('stat-distracted-time').textContent = formatMs(session.distractedMs);

    const distractionRatio = session.distractedMs / session.durationMs;
    coachController.updateCoachMoment('complete', { distractionRatio });
  }
  ```

- [ ] **Step 3: Verify the full flow manually — natural end with popup closed**

  1. Go to `chrome://extensions/`, click reload on "Keep on".
  2. Open the popup, start a 1-minute session, close the popup immediately (click elsewhere on the page).
  3. Wait for the minute to pass without reopening the popup.
  4. Open the popup — it must show the "✅ Session Complete!" screen (not the start form), with `Duration: 1m 0s`, `Distractions: 0`, and a coach phrase from the `satisfied` pool (0 distractions → ratio 0).
  5. Click **Start New Session**, then actually start a new session.
  6. Close the popup, reopen it — it must show the active screen with the live countdown, not the stale "Session Complete" screen.

- [ ] **Step 4: Verify the embarrassed mood path**

  1. In `options`, set the grace period to 5s and add a test domain you can reach (or use an existing blacklisted domain like `reddit.com`).
  2. Start a 1-minute session with the popup, close the popup, navigate to the blacklisted site and stay past the grace period so the overlay fires and stays up for over ~9 seconds (>15% of 60s).
  3. Dismiss the overlay, let the session run out, then open the popup.
  4. The "Session Complete" screen must show a coach phrase from the `embarrassed` pool (`distractedMs / durationMs > 0.15`).

- [ ] **Step 5: Verify the keyboard-shortcut end path**

  1. Start a session from the popup, close the popup.
  2. Trigger the `toggle-session` keyboard shortcut (check `chrome://extensions/shortcuts` for the current binding) to stop the session.
  3. Open the popup — the "Session Complete" screen must appear with the correct stats, confirming `lastSessionResult` is written on this end path too (not just natural expiry).

- [ ] **Step 6: Commit**

  ```bash
  git add popup/popup.js
  git commit -m "feat: show persisted session-complete screen with coach mood on popup open"
  ```

---

## Self-Review Notes

- **Spec coverage:** Design §1 → Task 1 Step 1; §2 → Task 1 Step 2; §3 → Task 4 Step 1; §4 → Task 2 + Task 4 Step 2; §5 → Task 3. All "Testing" bullets from the spec are covered by Task 4's verification steps (natural end, shortcut end, satisfied mood, embarrassed mood, restart supersedes stale screen, closing without restarting re-shows it — implied by Step 3.6 confirming the opposite case works, combined with the "no explicit dismiss" design already covered by Step 1's logic).
- **Type consistency:** `lastSessionResult` shape (`durationMs`, `distractions`, `distractedMs`, `endedAt`) is identical everywhere it's referenced (Task 1 write, Task 4 read). `getCoachMoment('complete', { distractionRatio })` signature matches between Task 2's definition and Task 4's call site. No placeholders remain in any step.
