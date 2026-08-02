// Content Script: Overlay Injection
// Runs on all tabs, listens for alarm messages from service worker

let overlayElement = null;
let counterInterval = null;
let distraction = null;
let beforeUnloadHandler = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SHOW_OVERLAY') {
    showAlarmOverlay(request.sessionInfo, request.distractionStartedAt, request.alarmSound !== false);
    sendResponse({ success: true });
  } else if (request.type === 'HIDE_OVERLAY') {
    // Service worker already closed out the distraction (user switched tabs,
    // session ended), so tear down without reporting it again
    removeOverlay();
    sendResponse({ success: true });
  }
});

function showAlarmOverlay(sessionInfo, distractionStartedAt, playSound = true) {
  if (overlayElement) {
    return; // Already showing
  }

  distraction = {
    sessionStartedAt: sessionInfo.startedAt,
    focusTabId: sessionInfo.focusTabId,
    distractionStartedAt: distractionStartedAt || Date.now()
  };

  const minutesIn = Math.round((Date.now() - sessionInfo.startedAt) / 1000 / 60);
  const hasFocusTab = Number.isInteger(sessionInfo.focusTabId);

  // Create overlay container
  overlayElement = document.createElement('div');
  overlayElement.id = 'focus-alarm-overlay';
  overlayElement.innerHTML = `
    <div class="focus-alarm-backdrop">
      <div class="focus-alarm-card">
        <h1 class="focus-alarm-title">⏰ Time Check</h1>
        <p class="focus-alarm-counter">
          You've been here for <span id="distraction-counter">0</span>s
        </p>
        <p class="focus-alarm-message" id="focus-alarm-message">
          You're ${minutesIn} min into your session — stay sharp!
        </p>
      <div class="coach-container">
        <img data-coach-image src="#" alt="Coach Max" class="coach-image">
        <div class="coach-phrase-container">
          <span data-coach-phrase class="coach-phrase"></span>
        </div>
      </div>
        ${hasFocusTab ? '<button id="focus-alarm-back-btn" class="focus-alarm-btn">Back to focus tab</button>' : ''}
        <button id="focus-alarm-dismiss-btn" class="focus-alarm-btn${hasFocusTab ? ' secondary' : ''}">Dismiss</button>
      </div>
    </div>
  `;

  document.documentElement.appendChild(overlayElement);

  const { image, phrase } = getCoachMoment(
    `distraction_${sessionInfo.distraction > 3 ? 'infinity' : sessionInfo.distraction}`,
    { distractions: sessionInfo.distraction }
  );

  const coachImageEl = overlayElement.querySelector('[data-coach-image]');
  const coachPhraseEl = overlayElement.querySelector('[data-coach-phrase]');

  if (image) coachImageEl.src = image;
  if (phrase) coachPhraseEl.textContent = phrase;

  coachImageEl.addEventListener('error', () => coachImageEl.style.display = 'none');

  if (playSound) {
    playAlarmSound();
  }

  // Event listeners
  document.getElementById('focus-alarm-dismiss-btn').addEventListener('click', dismissOverlay);

  const backBtn = document.getElementById('focus-alarm-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'FOCUS_TAB' }).catch(() => { });
      dismissOverlay();
    });
  }

  // Update counter every second
  counterInterval = setInterval(() => {
    if (!overlayElement || !overlayElement.parentElement) {
      clearInterval(counterInterval);
      counterInterval = null;
      return;
    }
    const elapsed = Math.round((Date.now() - distraction.distractionStartedAt) / 1000);
    const counterEl = document.getElementById('distraction-counter');
    if (counterEl) {
      counterEl.textContent = elapsed;
    }
  }, 1000);

  beforeUnloadHandler = () => dismissOverlay();
  window.addEventListener('beforeunload', beforeUnloadHandler);
}

// Tear down the overlay without notifying the service worker
function removeOverlay() {
  if (overlayElement && overlayElement.parentElement) {
    overlayElement.parentElement.removeChild(overlayElement);
  }
  overlayElement = null;
  distraction = null;

  if (counterInterval) {
    clearInterval(counterInterval);
    counterInterval = null;
  }

  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}

function dismissOverlay() {
  const wasShowing = overlayElement !== null;
  removeOverlay();

  if (wasShowing) {
    // Notify service worker so it resumes the session clock
    chrome.runtime.sendMessage({ type: 'OVERLAY_DISMISSED' }).catch(() => { });
  }
}

function playAlarmSound() {
  // Create audio context for beep
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800; // Frequency in Hz
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
  } catch (e) {
    // Audio unavailable; fail silently
  }
}
