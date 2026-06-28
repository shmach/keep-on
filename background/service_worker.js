// Keep on Service Worker
// Manages session state, monitors tabs, and triggers alarms

const DEFAULTS = {
  settings: {
    gracePeriodMs: 15000,
    alarmSound: true,
    blacklist: [
      'twitter.com', 'x.com', 'reddit.com', 'instagram.com',
      'tiktok.com', 'facebook.com', 'youtube.com'
    ]
  }
};

// Initialize defaults on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('settings', (result) => {
    if (!result.settings) {
      chrome.storage.local.set({ settings: DEFAULTS.settings });
    }
  });
});

// Start a focus session
async function startSession(config) {
  const now = Date.now();
  const session = {
    active: true,
    startedAt: now,
    durationMs: config.durationMs,
    focusTabId: config.focusTabId || null,
    distractions: 0,
    distractedMs: 0,
    pausedMs: 0,
    isPaused: false
  };

  await chrome.storage.local.set({ session });

  // Set up session timer
  const durationMin = config.durationMs / 60000;
  chrome.alarms.create('session-end', { delayInMinutes: durationMin });

  // Update icon
  updateIcon(true);

  // If the currently active tab is already blacklisted, start grace period immediately
  // (onActivated won't fire because no tab switch occurred)
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.id !== session.focusTabId && activeTab.url) {
    const blacklisted = await isBlacklisted(activeTab.url);
    if (blacklisted) {
      const storedSettings = await chrome.storage.local.get('settings');
      const graceMs = storedSettings.settings.gracePeriodMs;
      gracePeriodStartTimes.set(activeTab.id, Date.now());
      const timeoutId = setTimeout(() => {
        triggerOverlay(activeTab.id);
      }, graceMs);
      gracePeriodTimeouts.set(activeTab.id, timeoutId);
    }
  }
}

// End the session and record stats
async function endSession(isTimerExpired = false) {
  const result = await chrome.storage.local.get('session');
  const session = result.session;

  if (session && session.active) {
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

    session.active = false;
    await chrome.storage.local.set({ session });

    // Clear all grace period timeouts
    for (const timeoutId of gracePeriodTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    gracePeriodTimeouts.clear();

    // Clear alarms
    chrome.alarms.clearAll();

    // Update icon
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
}

// Update extension icon color and badge based on session state
async function updateIcon(isActive) {
  if (isActive) {
    const greenIconData = generateSimpleIcon('#4CAF50');
    chrome.action.setIcon({ imageData: greenIconData });
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#03a9aa' });
  } else {
    const grayIconData = generateSimpleIcon('#808080');
    chrome.action.setIcon({ imageData: grayIconData });
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

// Generate a simple icon (128x128 colored square)
function generateSimpleIcon(color) {
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  return ctx.getImageData(0, 0, 128, 128);
}

// Check if a tab is on a blacklist domain
async function isBlacklisted(tabUrl) {
  try {
    const settings = await chrome.storage.local.get('settings');
    const hostname = new URL(tabUrl).hostname.replace(/^www\./, '');
    return settings.settings.blacklist.some(domain =>
      hostname.includes(domain.replace(/^www\./, ''))
    );
  } catch {
    return false;
  }
}

// Track grace period timeouts by tab ID
const gracePeriodTimeouts = new Map();

// Track when each grace period started
const gracePeriodStartTimes = new Map();

// Trigger overlay for a blacklisted tab
async function triggerOverlay(tabId) {
  const result = await chrome.storage.local.get('session');
  const session = result.session;

  if (session && session.active) {
    // Increment distraction count
    session.distractions++;

    // Pause the session timer
    session.isPaused = true;
    session.pausedStartTime = Date.now();

    await chrome.storage.local.set({ session });

    const settingsResult = await chrome.storage.local.get('settings');
    const alarmSound = settingsResult.settings?.alarmSound ?? true;

    // Get the grace period start time
    const gracePeriodStartTime = gracePeriodStartTimes.get(tabId) || Date.now();

    // Send overlay message to tab
    chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_OVERLAY',
      sessionInfo: session,
      distractionStartedAt: gracePeriodStartTime,
      alarmSound
    }).catch(() => {});
  }

  // Clear the timeout from tracking
  gracePeriodTimeouts.delete(tabId);
  gracePeriodStartTimes.delete(tabId);
}

// Clear grace period timeout for a tab
function clearGracePeriod(tabId) {
  if (gracePeriodTimeouts.has(tabId)) {
    clearTimeout(gracePeriodTimeouts.get(tabId));
    gracePeriodTimeouts.delete(tabId);
    gracePeriodStartTimes.delete(tabId);
  }
}

// Handle tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const session = await chrome.storage.local.get('session');

  if (!session.session || !session.session.active) {
    return;
  }

  // Skip if we're on the focus tab
  if (activeInfo.tabId === session.session.focusTabId) {
    clearGracePeriod(activeInfo.tabId);
    return;
  }

  // Clear grace period for any other tab that was active
  for (const tabId of gracePeriodTimeouts.keys()) {
    if (tabId !== activeInfo.tabId) {
      clearGracePeriod(tabId);
    }
  }

  const tab = await chrome.tabs.get(activeInfo.tabId);
  const blacklisted = await isBlacklisted(tab.url);

  if (blacklisted) {
    // Start grace period
    const settings = await chrome.storage.local.get('settings');
    const graceMs = settings.settings.gracePeriodMs;
    const gracePeriodStart = Date.now();

    gracePeriodStartTimes.set(activeInfo.tabId, gracePeriodStart);
    const timeoutId = setTimeout(() => {
      triggerOverlay(activeInfo.tabId);
    }, graceMs);

    gracePeriodTimeouts.set(activeInfo.tabId, timeoutId);
  }
});

// Handle tab updates (URL change)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // URL changed, clear any pending grace period for this tab
    clearGracePeriod(tabId);

    // Re-check if the new URL is blacklisted
    const session = await chrome.storage.local.get('session');
    if (!session.session || !session.session.active) return;

    const blacklisted = await isBlacklisted(tab.url);
    if (blacklisted) {
      const settings = await chrome.storage.local.get('settings');
      const graceMs = settings.settings.gracePeriodMs;
      const gracePeriodStart = Date.now();

      gracePeriodStartTimes.set(tabId, gracePeriodStart);
      const timeoutId = setTimeout(() => {
        triggerOverlay(tabId);
      }, graceMs);

      gracePeriodTimeouts.set(tabId, timeoutId);
    }
  }
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'session-end') {
    await endSession(true); // Pass true to indicate timer naturally expired
  }
});

// Listen for messages from popup/content
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_SESSION') {
    startSession(request.config);
    sendResponse({ success: true });
  } else if (request.type === 'END_SESSION') {
    endSession().then(() => {
      sendResponse({ success: true });
    });
    return true; // async response
  } else if (request.type === 'GET_SESSION') {
    chrome.storage.local.get('session', (result) => {
      sendResponse({ session: result.session });
    });
    return true; // async response
  } else if (request.type === 'OVERLAY_DISMISSED') {
    // Resume session timer and record distracted time
    chrome.storage.local.get('session', (result) => {
      const session = result.session;
      if (session && session.active && session.isPaused) {
        const pauseDuration = Date.now() - session.pausedStartTime;
        session.pausedMs += pauseDuration;
        session.distractedMs += pauseDuration;
        session.isPaused = false;
        delete session.pausedStartTime;
        chrome.storage.local.set({ session });
      }
      sendResponse({ success: true });
    });
    return true; // async response
  }
});

// Command handler for keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-session') {
    chrome.storage.local.get('session', async (result) => {
      if (result.session && result.session.active) {
        await endSession();
      } else {
        // Default: 45 min session
        startSession({ durationMs: 45 * 60000 });
      }
    });
  }
});
