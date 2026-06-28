// Popup Script
// Manages UI state and communication with service worker

const durationInput = document.getElementById('duration-input');
const focusTabSelect = document.getElementById('focus-tab-select');
const startBtn = document.getElementById('start-btn');
const optionsBtn = document.getElementById('options-btn');
const stopBtn = document.getElementById('stop-btn');
const startNewBtn = document.getElementById('start-new-btn');

const sessionInactiveDiv = document.getElementById('session-inactive');
const sessionActiveDiv = document.getElementById('session-active');
const sessionEndedDiv = document.getElementById('session-ended');

let currentSession = null;
let updateInterval = null;

// Initialize popup
async function init() {
  await loadFocusTabs();
  await updateSessionState();
}

// Load available tabs for focus tab selection
async function loadFocusTabs() {
  const tabs = await chrome.tabs.query({});
  focusTabSelect.innerHTML = '<option value="">-- Current Tab --</option>';

  tabs.forEach((tab) => {
    const option = document.createElement('option');
    option.value = tab.id;
    option.textContent = tab.title.substring(0, 40);
    focusTabSelect.appendChild(option);
  });
}

// Update UI based on session state
async function updateSessionState() {
  chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
    if (!response) return;
    const session = response.session;

    if (!session || !session.active) {
      showInactiveState();
    } else {
      showActiveState(session);
      startLiveUpdates(session);
    }
  });
}

function showInactiveState() {
  sessionInactiveDiv.style.display = 'block';
  sessionActiveDiv.style.display = 'none';
  sessionEndedDiv.style.display = 'none';

  if (updateInterval) {
    clearInterval(updateInterval);
  }
}

function showActiveState(session) {
  sessionInactiveDiv.style.display = 'none';
  sessionActiveDiv.style.display = 'block';
  sessionEndedDiv.style.display = 'none';

  currentSession = session;
  updateTimerDisplay(session);
  updateDistractionCount(session);
}

function startLiveUpdates(session) {
  if (updateInterval) {
    clearInterval(updateInterval);
  }

  updateInterval = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
      if (response && response.session && response.session.active) {
        currentSession = response.session;
        updateTimerDisplay(response.session);
        updateDistractionCount(response.session);
      } else {
        clearInterval(updateInterval);
      }
    });
  }, 1000);
}

function updateTimerDisplay(session) {
  let elapsed = Date.now() - session.startedAt;

  // Subtract paused time from elapsed
  elapsed -= session.pausedMs || 0;

  // If currently paused, subtract the current pause duration
  if (session.isPaused && session.pausedStartTime) {
    elapsed -= (Date.now() - session.pausedStartTime);
  }

  const remaining = Math.max(0, session.durationMs - elapsed);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  const timeLeftEl = document.getElementById('time-left');
  timeLeftEl.textContent = `${minutes}m ${seconds}s`;

  if (remaining === 0) {
    showSessionEnded(session);
  }
}

function updateDistractionCount(session) {
  const countEl = document.getElementById('distraction-count');
  countEl.textContent = session.distractions;
}

function showSessionEnded(session) {
  clearInterval(updateInterval);

  sessionInactiveDiv.style.display = 'none';
  sessionActiveDiv.style.display = 'none';
  sessionEndedDiv.style.display = 'block';

  const minutes = Math.floor(session.durationMs / 60000);
  const seconds = Math.floor((session.durationMs % 60000) / 1000);
  document.getElementById('stat-duration').textContent = `${minutes}m ${seconds}s`;
  document.getElementById('stat-distractions').textContent = session.distractions;

  const distractedMin = Math.floor(session.distractedMs / 60000);
  const distractedSec = Math.floor((session.distractedMs % 60000) / 1000);
  document.getElementById('stat-distracted-time').textContent = `${distractedMin}m ${distractedSec}s`;
}

// Event listeners
startBtn.addEventListener('click', async () => {
  const duration = parseInt(durationInput.value) * 60000;
  const focusTabId = focusTabSelect.value ? parseInt(focusTabSelect.value) : null;

  chrome.runtime.sendMessage({
    type: 'START_SESSION',
    config: {
      durationMs: duration,
      focusTabId
    }
  }, () => {
    updateSessionState();
  });
});

optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'END_SESSION' }, () => {
    updateSessionState();
  });
});

startNewBtn.addEventListener('click', () => {
  showInactiveState();
});

// Initialize on load
init();

// Re-check session state when popup opens
window.addEventListener('focus', updateSessionState);
