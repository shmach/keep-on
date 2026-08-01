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
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  focusTabSelect.innerHTML = '';

  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = '-- No focus tab --';
  focusTabSelect.appendChild(noneOption);

  tabs.forEach((tab) => {
    const option = document.createElement('option');
    option.value = tab.id;
    const title = (tab.title || tab.url || 'Untitled').substring(0, 40);
    const isCurrent = activeTab && tab.id === activeTab.id;
    option.textContent = isCurrent ? `${title} (current)` : title;
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
      startLiveUpdates();
    }
  });
}

function showInactiveState() {
  sessionInactiveDiv.style.display = 'block';
  sessionActiveDiv.style.display = 'none';
  sessionEndedDiv.style.display = 'none';

  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
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

function startLiveUpdates() {
  if (updateInterval) {
    clearInterval(updateInterval);
  }

  updateInterval = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
      if (!response) return;
      const session = response.session;

      if (session && session.active) {
        currentSession = session;
        updateTimerDisplay(session);
        updateDistractionCount(session);
      } else if (session) {
        // Service worker ended the session while the popup was open
        showSessionEnded(session);
      } else {
        showInactiveState();
      }
    });
  }, 1000);
}

function formatMs(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function updateTimerDisplay(session) {
  // `endsAt` is the single source of truth: the service worker pushes it
  // forward while a distraction is paused, so this matches the real alarm
  const remaining = Math.max(0, session.endsAt - Date.now());

  document.getElementById('time-left').textContent = formatMs(remaining);
}

function updateDistractionCount(session) {
  const countEl = document.getElementById('distraction-count');
  countEl.textContent = session.distractions;
}

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

// Event listeners
startBtn.addEventListener('click', async () => {
  const minutes = parseInt(durationInput.value, 10);
  if (!Number.isFinite(minutes) || minutes < 1) {
    alert('Please enter a session duration of at least 1 minute');
    return;
  }

  const focusTabId = focusTabSelect.value ? parseInt(focusTabSelect.value, 10) : null;

  chrome.runtime.sendMessage({
    type: 'START_SESSION',
    config: {
      durationMs: minutes * 60000,
      focusTabId
    }
  }, (response) => {
    if (response && response.success === false) {
      alert(response.error || 'Could not start the session');
      return;
    }
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
  loadFocusTabs();
  showInactiveState();
});

// Session may end while the popup is open
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'SESSION_ENDED' && currentSession) {
    showSessionEnded({ ...currentSession, ...request.stats });
  }
});

// Initialize on load
init();

// Re-check session state when popup opens
window.addEventListener('focus', updateSessionState);
