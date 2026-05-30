// Focus Alarm Service Worker
// Manages session state, monitors tabs, and triggers alarms

const DEFAULTS = {
  settings: {
    gracePeriodMs: 15000,
    alarmSound: true,
    blacklist: [
      'twitter.com', 'x.com', 'reddit.com', 'instagram.com',
      'tiktok.com', 'facebook.com', 'youtube.com'
    ],
    pomodoroDurationMs: 1500000,  // 25 min
    breakDurationMs: 300000       // 5 min
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
    pomodoroMode: config.pomodoroMode || false,
    phase: 'focus',
    distractions: 0,
    distractedMs: 0,
    lastBlacklistVisit: null
  };

  await chrome.storage.local.set({ session });

  // Set up session timer
  const durationMin = config.durationMs / 60000;
  chrome.alarms.create('session-end', { delayInMinutes: durationMin });

  // If pomodoro, set phase-end alarm for first phase (focus)
  if (config.pomodoroMode) {
    const settings = await chrome.storage.local.get('settings');
    const focusMin = settings.settings.pomodoroDurationMs / 60000;
    chrome.alarms.create('phase-end', { delayInMinutes: focusMin });
  }

  // Update icon
  updateIcon(true);
}

// End the session and record stats
async function endSession() {
  const result = await chrome.storage.local.get('session');
  const session = result.session;

  if (session && session.active) {
    session.active = false;
    await chrome.storage.local.set({ session });

    // Clear alarms
    chrome.alarms.clearAll();

    // Update icon
    updateIcon(false);

    // Notify popup
    chrome.runtime.sendMessage({
      type: 'SESSION_ENDED',
      stats: {
        durationMs: session.durationMs,
        distractions: session.distractions,
        distractedMs: session.distractedMs
      }
    }).catch(() => {}); // Popup might not be open
  }
}

// Update extension icon color based on session state
async function updateIcon(isActive) {
  if (isActive) {
    // Green icon (active)
    const greenIconData = generateSimpleIcon('#4CAF50');
    chrome.action.setIcon({ imageData: greenIconData });
  } else {
    // Gray icon (inactive)
    const grayIconData = generateSimpleIcon('#808080');
    chrome.action.setIcon({ imageData: grayIconData });
  }
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

// Handle tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const session = await chrome.storage.local.get('session');

  if (!session.session || !session.session.active) return;

  // Skip if we're on the focus tab
  if (activeInfo.tabId === session.session.focusTabId) {
    // Clear any grace period for this tab
    chrome.alarms.clear(`grace-${activeInfo.tabId}`);
    return;
  }

  const tab = await chrome.tabs.get(activeInfo.tabId);
  const blacklisted = await isBlacklisted(tab.url);

  if (blacklisted && session.session.phase === 'focus') {
    // Start grace period
    const settings = await chrome.storage.local.get('settings');
    const graceSec = settings.settings.gracePeriodMs / 1000;
    chrome.alarms.create(`grace-${activeInfo.tabId}`, { delayInSeconds: graceSec });
  }
});

// Handle tab updates (URL change)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // URL changed, clear any pending grace alarm for this tab
    chrome.alarms.clear(`grace-${tabId}`);

    // Re-check if the new URL is blacklisted
    const session = await chrome.storage.local.get('session');
    if (!session.session || !session.session.active) return;

    const blacklisted = await isBlacklisted(tab.url);
    if (blacklisted && session.session.phase === 'focus') {
      const settings = await chrome.storage.local.get('settings');
      const graceSec = settings.settings.gracePeriodMs / 1000;
      chrome.alarms.create(`grace-${tabId}`, { delayInSeconds: graceSec });
    }
  }
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'session-end') {
    endSession();
  } else if (alarm.name === 'phase-end') {
    // Pomodoro phase transition
    const result = await chrome.storage.local.get('session');
    const session = result.session;

    if (session && session.active && session.pomodoroMode) {
      const settings = await chrome.storage.local.get('settings');
      const wasBreak = session.phase === 'break';
      session.phase = wasBreak ? 'focus' : 'break';

      const nextPhaseDurationMs = wasBreak
        ? settings.settings.pomodoroDurationMs
        : settings.settings.breakDurationMs;

      await chrome.storage.local.set({ session });

      // Set up next phase-end alarm
      const nextPhaseMin = nextPhaseDurationMs / 60000;
      chrome.alarms.create('phase-end', { delayInMinutes: nextPhaseMin });

      // Notify popup of phase change
      chrome.runtime.sendMessage({
        type: 'PHASE_CHANGED',
        phase: session.phase
      }).catch(() => {});
    }
  } else if (alarm.name.startsWith('grace-')) {
    // Grace period expired, show overlay
    const tabId = parseInt(alarm.name.split('-')[1]);
    const session = await chrome.storage.local.get('session');

    if (session.session && session.session.active) {
      // Increment distraction count
      session.session.distractions++;
      await chrome.storage.local.set({ session });

      // Send overlay message to tab
      chrome.tabs.sendMessage(tabId, {
        type: 'SHOW_OVERLAY',
        sessionInfo: session.session
      }).catch(() => {}); // Tab might not have content script ready
    }
  }
});

// Listen for messages from popup/content
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_SESSION') {
    startSession(request.config);
    sendResponse({ success: true });
  } else if (request.type === 'END_SESSION') {
    endSession();
    sendResponse({ success: true });
  } else if (request.type === 'GET_SESSION') {
    chrome.storage.local.get('session', (result) => {
      sendResponse({ session: result.session });
    });
    return true; // async response
  }
});

// Command handler for keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-session') {
    chrome.storage.local.get('session', (result) => {
      if (result.session && result.session.active) {
        endSession();
      } else {
        // Default: 45 min session
        startSession({ durationMs: 45 * 60000 });
      }
    });
  }
});
