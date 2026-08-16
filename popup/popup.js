// Popup Script
// Manages UI state and communication with service worker

const durationInput = document.getElementById('duration-input');
const focusTabSelect = document.getElementById('focus-tab-select');
const startBtn = document.getElementById('start-btn');
const optionsBtns = document.querySelectorAll('.options-btn');
const stopBtn = document.getElementById('stop-btn');
const startNewBtn = document.getElementById('start-new-btn');

const sessionInactiveDiv = document.getElementById('session-inactive');
const sessionActiveDiv = document.getElementById('session-active');
const sessionEndedDiv = document.getElementById('session-ended');

let currentSession = null;
let updateInterval = null;

// Coach controller 
class CoachController {
  constructor(
    imagesElements = document.querySelectorAll('[data-coach-image]'),
    phrasesElements = document.querySelectorAll('[data-coach-phrase]'),
  ) {
    this.imagesElements = imagesElements;
    this.phrasesElements = phrasesElements;

    // A missing/renamed image must never break the UI — hide it and let the
    // phrase stand alone
    this.imagesElements.forEach((el) => {
      el.addEventListener('error', () => { el.style.display = 'none'; });
    });
  }

  updateCoachMoment(context, data) {
    const { image, phrase } = getCoachMoment(context, data);

    if (image) {
      this.imagesElements.forEach(el => {
        el.style.display = '';
        el.src = image;
      });
    };

    if (phrase) {
      this.phrasesElements.forEach(el => el.textContent = phrase);
    };
  };
}

const coachController = new CoachController();

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

// Update UI based on session state. Returns a promise that resolves once the
// screen has actually been (re)rendered — callers that `await` this are
// guaranteed not to run before the real state is known.
function updateSessionState() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SESSION' }, (response) => {
      if (!response) { resolve(); return; }
      const session = response.session;

      if (session && session.active) {
        showActiveState(session);
        startLiveUpdates();
      } else if (response.lastSession) {
        showSessionEnded(response.lastSession);
      } else {
        showInactiveState();
      }
      resolve();
    });
  });
}

function showInactiveState() {
  sessionInactiveDiv.style.display = 'block';
  sessionActiveDiv.style.display = 'none';
  sessionEndedDiv.style.display = 'none';

  coachController.updateCoachMoment('welcome', {});

  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

function showActiveState(session) {
  sessionInactiveDiv.style.display = 'none';
  sessionActiveDiv.style.display = 'block';
  sessionEndedDiv.style.display = 'none';

  console.log('Session active: ', session);
  coachController.updateCoachMoment('active', {});

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


  const distractionRatio = session.distractedMs / session.durationMs;
  coachController.updateCoachMoment('complete', { distractionRatio });
}

// Event listeners
const MAX_DURATION_MINUTES = 240;

startBtn.addEventListener('click', async () => {
  const minutes = parseInt(durationInput.value, 10);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_DURATION_MINUTES) {
    alert(`Please enter a session duration between 1 and ${MAX_DURATION_MINUTES} minutes`);
    return;
  }

  let focusTabId = focusTabSelect.value ? parseInt(focusTabSelect.value, 10) : null;
  if (focusTabId !== null) {
    try {
      await chrome.tabs.get(focusTabId);
    } catch {
      focusTabId = null; // Selected tab was closed before Start was clicked
    }
  }

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

optionsBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
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
