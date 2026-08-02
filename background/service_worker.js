// Keep on Service Worker
// Manages session state, monitors tabs, and triggers alarms

importScripts('/lib/shared.js');

const SESSION_END_ALARM = 'session-end';
const WATCHDOG_ALARM = 'grace-watchdog';

// Chrome clamps alarms to a ~30s floor, which is too coarse for a 5-60s grace
// period. So grace periods run on setTimeout (precise, but lost when the worker
// sleeps) and this periodic alarm rebuilds them from storage on wake.
const WATCHDOG_PERIOD_MIN = 0.5;

const MAX_SESSION_MS = 24 * 60 * 60 * 1000;

// In-memory mirror of the grace periods persisted under `graceTimers`
const graceTimeouts = new Map();

// Initialize defaults on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('settings', (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
  });
});

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getSession() {
  const { session } = await chrome.storage.local.get('session');
  return session || null;
}

async function setSession(session) {
  await chrome.storage.local.set({ session });
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// { [tabId]: { startedAt, sessionId } }
async function getGraceTimers() {
  const { graceTimers } = await chrome.storage.local.get('graceTimers');
  return graceTimers || {};
}

async function safeGetTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null; // Tab was closed or is inaccessible
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

// The session clock is driven by `endsAt` (wall-clock target). Pausing clears
// the end alarm; resuming pushes `endsAt` forward by the paused duration and
// reschedules, so the visible countdown and the real alarm never diverge.
function scheduleSessionEnd(session) {
  chrome.alarms.create(SESSION_END_ALARM, { when: session.endsAt });
}

// Start a focus session
async function startSession(config) {
  const durationMs = Number(config && config.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_SESSION_MS) {
    return { success: false, error: 'Invalid session duration' };
  }

  const focusTabId = Number.isInteger(config.focusTabId) ? config.focusTabId : null;
  const now = Date.now();
  const session = {
    id: now,
    active: true,
    startedAt: now,
    durationMs,
    endsAt: now + durationMs,
    focusTabId,
    distractions: 0,
    distractedMs: 0,
    pausedMs: 0,
    isPaused: false,
    pausedStartTime: null,
    overlayTabId: null
  };

  await clearAllGracePeriods();
  await setSession(session);

  scheduleSessionEnd(session);
  chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MIN });

  updateIcon(true);

  // If the active tab is already blacklisted, start the grace period now
  // (onActivated won't fire because no tab switch occurred)
  const activeTab = await getActiveTab();
  if (activeTab) {
    await handleTabFocus(activeTab.id);
  }

  return { success: true };
}

// End the session and record stats
async function endSession(isTimerExpired = false) {
  const session = await getSession();
  if (!session || !session.active) return;

  // If the distraction overlay is still showing when the session ends,
  // accumulate that in-progress distraction time before computing stats
  if (session.isPaused && session.pausedStartTime) {
    session.distractedMs += Date.now() - session.pausedStartTime;
  }

  // Capture stats before mutating session state
  const stats = {
    durationMs: session.durationMs,
    distractions: session.distractions,
    distractedMs: session.distractedMs
  };

  const overlayTabId = session.overlayTabId;

  session.active = false;
  session.isPaused = false;
  session.pausedStartTime = null;
  session.overlayTabId = null;
  await setSession(session);

  await clearAllGracePeriods();
  await chrome.alarms.clear(SESSION_END_ALARM);
  await chrome.alarms.clear(WATCHDOG_ALARM);

  if (overlayTabId !== null) {
    hideOverlay(overlayTabId);
  }

  updateIcon(false);

  // Only show completion notification if timer naturally expired (not manually stopped)
  if (isTimerExpired) {
    showSessionCompleteNotification(stats);

    // Badge shows checkmark until next session
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#fd611b' });
  }

  // Notify popup
  chrome.runtime.sendMessage({
    type: 'SESSION_ENDED',
    stats
  }).catch(() => {}); // Popup might not be open
}

// Stop counting a distraction: bank the time and give it back to the session
async function endDistraction(session) {
  if (!session || !session.active || !session.isPaused) return session;

  const pauseDuration = Date.now() - (session.pausedStartTime || Date.now());
  session.pausedMs += pauseDuration;
  session.distractedMs += pauseDuration;
  session.endsAt += pauseDuration;
  session.isPaused = false;
  session.pausedStartTime = null;
  session.overlayTabId = null;

  await setSession(session);
  scheduleSessionEnd(session);

  return session;
}

// ---------------------------------------------------------------------------
// Icon, notification
// ---------------------------------------------------------------------------

// Update extension icon (full-color when active, grayscale when stopped) and badge
async function updateIcon(isActive) {
  const iconData = await generateStateIcon(isActive);
  chrome.action.setIcon({ imageData: iconData });
  if (isActive) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#03a9aa' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function getIconDataUrl() {
  const url = chrome.runtime.getURL('assets/keep-on-128x128.png');
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:image/png;base64,' + btoa(binary);
}

async function showSessionCompleteNotification(stats) {
  const durationMin = Math.round(stats.durationMs / 60000);
  const distractedMin = Math.round(stats.distractedMs / 60000);

  let message = `You focused for ${durationMin} minute${durationMin !== 1 ? 's' : ''}.`;
  if (stats.distractions > 0) {
    message += ` ${stats.distractions} distraction${stats.distractions !== 1 ? 's' : ''} (${distractedMin}m lost).`;
  } else {
    message += ' No distractions — perfect session!';
  }

  const iconUrl = await getIconDataUrl();

  chrome.notifications.create('session-complete', {
    type: 'basic',
    iconUrl,
    title: 'Focus session complete!',
    message
  });
}

// Render the real extension logo, grayscale when the session is inactive
async function generateStateIcon(isActive) {
  const url = chrome.runtime.getURL('assets/keep-on-128x128.png');
  const response = await fetch(url);
  const bitmap = await createImageBitmap(await response.blob());

  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  if (!isActive) {
    ctx.filter = 'grayscale(100%)';
  }
  ctx.drawImage(bitmap, 0, 0, 128, 128);
  return ctx.getImageData(0, 0, 128, 128);
}

// ---------------------------------------------------------------------------
// Grace periods
// ---------------------------------------------------------------------------

function armGraceTimeout(tabId, delayMs) {
  const timeoutId = setTimeout(() => {
    graceTimeouts.delete(tabId);
    triggerOverlay(tabId);
  }, Math.max(0, delayMs));

  graceTimeouts.set(tabId, timeoutId);
}

function clearGraceTimeout(tabId) {
  const timeoutId = graceTimeouts.get(tabId);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    graceTimeouts.delete(tabId);
  }
}

async function clearGracePeriod(tabId) {
  clearGraceTimeout(tabId);

  const timers = await getGraceTimers();
  if (timers[tabId] !== undefined) {
    delete timers[tabId];
    await chrome.storage.local.set({ graceTimers: timers });
  }
}

async function clearAllGracePeriods() {
  for (const timeoutId of graceTimeouts.values()) {
    clearTimeout(timeoutId);
  }
  graceTimeouts.clear();
  await chrome.storage.local.set({ graceTimers: {} });
}

// Start a grace period, or re-arm an existing one after the worker slept.
// Never restarts a countdown that is already running for this session.
async function ensureGracePeriod(tabId, session, graceMs) {
  const timers = await getGraceTimers();
  const existing = timers[tabId];

  if (existing && existing.sessionId === session.id) {
    const remaining = existing.startedAt + graceMs - Date.now();
    if (remaining <= 0) {
      await triggerOverlay(tabId);
    } else if (!graceTimeouts.has(tabId)) {
      armGraceTimeout(tabId, remaining);
    }
    return;
  }

  clearGraceTimeout(tabId);
  timers[tabId] = { startedAt: Date.now(), sessionId: session.id };
  await chrome.storage.local.set({ graceTimers: timers });
  armGraceTimeout(tabId, graceMs);
}

// Trigger overlay for a blacklisted tab
async function triggerOverlay(tabId) {
  const timers = await getGraceTimers();
  const graceEntry = timers[tabId];
  await clearGracePeriod(tabId);

  const session = await getSession();
  if (!session || !session.active || session.isPaused) return;
  if (graceEntry && graceEntry.sessionId !== session.id) return; // Stale timer
  if (tabId === session.focusTabId) return;

  const settings = await getSettings();

  // Only alarm if the user is still sitting on this tab
  const tab = await safeGetTab(tabId);
  if (!tab || !tab.active || !isBlacklistedUrl(tab.url, settings.blacklist)) return;

  session.distractions++;
  session.isPaused = true;
  session.pausedStartTime = Date.now();
  session.overlayTabId = tabId;
  await setSession(session);

  // The session clock is paused, so the end alarm must not keep counting down
  await chrome.alarms.clear(SESSION_END_ALARM);

  const distractionStartedAt = graceEntry ? graceEntry.startedAt : Date.now();

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_OVERLAY',
      sessionInfo: session,
      distractionStartedAt,
      alarmSound: settings.alarmSound
    });
  } catch {
    // Content script unreachable (restricted page, document not ready). Roll
    // back so the session isn't left paused waiting on an overlay that never
    // appeared.
    session.distractions--;
    session.isPaused = false;
    session.pausedStartTime = null;
    session.overlayTabId = null;
    await setSession(session);
    scheduleSessionEnd(session);
  }
}

function hideOverlay(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'HIDE_OVERLAY' }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Tab monitoring
// ---------------------------------------------------------------------------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab && tab.id !== undefined ? tab : null;
}

// Single entry point for "the user is now looking at this tab"
async function handleTabFocus(tabId) {
  let session = await getSession();
  if (!session || !session.active) return;

  // Leaving the tab that shows the overlay ends the distraction, even if the
  // user never clicked Dismiss
  if (session.overlayTabId !== null && session.overlayTabId !== tabId) {
    const previousTabId = session.overlayTabId;
    session = await endDistraction(session);
    hideOverlay(previousTabId);
  }

  // A grace period only applies while its tab is the one being looked at
  const timers = await getGraceTimers();
  const tracked = new Set([...graceTimeouts.keys(), ...Object.keys(timers).map(Number)]);
  for (const trackedTabId of tracked) {
    if (trackedTabId !== tabId) {
      await clearGracePeriod(trackedTabId);
    }
  }

  if (tabId === session.focusTabId) {
    await clearGracePeriod(tabId);
    return;
  }

  if (session.isPaused) return; // Overlay already up somewhere

  const tab = await safeGetTab(tabId);
  if (!tab) return;

  const settings = await getSettings();
  if (!isBlacklistedUrl(tab.url, settings.blacklist)) {
    await clearGracePeriod(tabId);
    return;
  }

  await ensureGracePeriod(tabId, session, settings.gracePeriodMs);
}

// Handle tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await handleTabFocus(activeInfo.tabId);
});

// Handle tab updates (URL change)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;

  let session = await getSession();
  if (!session || !session.active) return;

  // URL changed, so any pending grace period for the old URL no longer applies
  await clearGracePeriod(tabId);

  // Navigating destroys the overlay along with the old document, so the
  // distraction has to be closed out here too
  if (session.overlayTabId === tabId) {
    session = await endDistraction(session);
  }

  if (!tab.active || tabId === session.focusTabId || session.isPaused) return;

  const settings = await getSettings();
  if (isBlacklistedUrl(changeInfo.url, settings.blacklist)) {
    await ensureGracePeriod(tabId, session, settings.gracePeriodMs);
  }
});

// Closing a tab must not leave the session paused forever
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await clearGracePeriod(tabId);

  const session = await getSession();
  if (session && session.active && session.overlayTabId === tabId) {
    await endDistraction(session);
  }
});

// ---------------------------------------------------------------------------
// Watchdog — recovers state the sleeping service worker lost
// ---------------------------------------------------------------------------

async function runWatchdog() {
  const session = await getSession();
  if (!session || !session.active) {
    await chrome.alarms.clear(WATCHDOG_ALARM);
    return;
  }

  // chrome.alarms has a ~30s floor and can fire late, so verify the clock here
  if (!session.isPaused && Date.now() >= session.endsAt) {
    await endSession(true);
    return;
  }

  // Drop grace periods left over from a previous session
  const timers = await getGraceTimers();
  for (const key of Object.keys(timers)) {
    if (timers[key].sessionId !== session.id) {
      await clearGracePeriod(Number(key));
    }
  }

  const activeTab = await getActiveTab();
  if (activeTab) {
    await handleTabFocus(activeTab.id);
  }
}

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SESSION_END_ALARM) {
    const session = await getSession();
    // Ignore a stale end alarm that fires while the session is paused
    if (session && session.active && session.isPaused) return;
    await endSession(true);
  } else if (alarm.name === WATCHDOG_ALARM) {
    await runWatchdog();
  }
});

// Runs on install and on every wake, rebuilding what lived only in memory
async function bootstrap() {
  const session = await getSession();
  if (!session || !session.active) return;

  // A session started before this version has no clock target; derive one so
  // the upgrade doesn't strand it with a NaN countdown
  if (typeof session.endsAt !== 'number') {
    session.id = session.id || session.startedAt;
    session.endsAt = session.startedAt + session.durationMs + (session.pausedMs || 0);
    session.overlayTabId = session.overlayTabId ?? null;
    await setSession(session);
  }

  chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_PERIOD_MIN });
  if (!session.isPaused) {
    scheduleSessionEnd(session);
  }
  updateIcon(true);

  await runWatchdog();
}

chrome.runtime.onStartup.addListener(() => {
  bootstrap().catch(() => {});
});

bootstrap().catch(() => {});

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_SESSION') {
    startSession(request.config).then(sendResponse);
    return true; // async response
  }

  if (request.type === 'END_SESSION') {
    endSession().then(() => sendResponse({ success: true }));
    return true; // async response
  }

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

  if (request.type === 'OVERLAY_DISMISSED') {
    (async () => {
      const session = await getSession();
      await endDistraction(session);
      sendResponse({ success: true });
    })();
    return true; // async response
  }

  if (request.type === 'FOCUS_TAB') {
    (async () => {
      const session = await getSession();
      const focusTabId = session && session.focusTabId;
      const tab = focusTabId ? await safeGetTab(focusTabId) : null;
      if (tab) {
        try {
          await chrome.tabs.update(focusTabId, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
        } catch {
          // Tab or window disappeared between the lookup and the switch
        }
      }
      sendResponse({ success: true });
    })();
    return true; // async response
  }
});

// Command handler for keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-session') return;

  const session = await getSession();
  if (session && session.active) {
    await endSession();
  } else {
    // Default: 45 min session
    await startSession({ durationMs: 45 * 60000 });
  }
});
