// Content Script: Overlay Injection
// Runs on all tabs, listens for alarm messages from service worker

let overlayElement = null;
let overlayStartTime = null;
let distraction = null;
let beforeUnloadHandler = null;


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SHOW_OVERLAY') {
    showAlarmOverlay(request.sessionInfo, request.distractionStartedAt, request.alarmSound !== false);
    sendResponse({ success: true });
  } else if (request.type === 'SESSION_ENDED') {
    showSessionCompleteOverlay(request.stats);
    sendResponse({ success: true });
  }
});

function showAlarmOverlay(sessionInfo, distractionStartedAt, playSound = true) {
  if (overlayElement) {
    return; // Already showing
  }

  overlayStartTime = Date.now();
  distraction = {
    sessionStartedAt: sessionInfo.startedAt,
    focusTabId: sessionInfo.focusTabId,
    distractionStartedAt: distractionStartedAt || overlayStartTime
  };

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
          You're ${Math.round((Date.now() - sessionInfo.startedAt) / 1000 / 60)} min into your session — stay sharp!
        </p>
        <p class="focus-alarm-recommendation">
          Consider closing this tab to return to your focus session.
        </p>
        <button id="focus-alarm-dismiss-btn" class="focus-alarm-btn">Dismiss</button>
      </div>
    </div>
  `;

  document.documentElement.appendChild(overlayElement);

  if (playSound) {
    playAlarmSound();
  }

  // Event listeners
  document.getElementById('focus-alarm-dismiss-btn').addEventListener('click', dismissOverlay);

  // Update counter every second
  const counterInterval = setInterval(() => {
    if (!overlayElement || !overlayElement.parentElement) {
      clearInterval(counterInterval);
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

function dismissOverlay() {
  if (overlayElement && overlayElement.parentElement) {
    overlayElement.parentElement.removeChild(overlayElement);
  }
  overlayElement = null;
  overlayStartTime = null;
  distraction = null;

  if (beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }

  // Notify service worker that overlay was dismissed
  chrome.runtime.sendMessage({
    type: 'OVERLAY_DISMISSED'
  }).catch(() => {});
}

function formatMs(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function getMotivationalMessage(distractions) {
  if (distractions === 0) return 'Perfect focus! Outstanding work.';
  if (distractions <= 2)  return 'Great job! You stayed on track.';
  if (distractions <= 5)  return 'Good session — keep reducing distractions.';
  return 'Tough session. You\'ll do better next time!';
}

function showSessionCompleteOverlay(stats) {
  // Dismiss any in-progress distraction overlay first
  if (overlayElement) {
    dismissOverlay();
  }

  overlayElement = document.createElement('div');
  overlayElement.id = 'focus-alarm-overlay';
  overlayElement.innerHTML = `
    <div class="focus-alarm-backdrop">
      <div class="focus-alarm-card">
        <h1 class="focus-alarm-title success">🎉 Session Complete!</h1>
        <p class="focus-alarm-message">
          <strong>Duration:</strong> ${formatMs(stats.durationMs)}<br>
          <strong>Distractions:</strong> ${stats.distractions}<br>
          <strong>Time distracted:</strong> ${formatMs(stats.distractedMs)}
        </p>
        <p class="focus-alarm-recommendation">
          ${getMotivationalMessage(stats.distractions)}
        </p>
        <button id="focus-alarm-close-btn" class="focus-alarm-btn">Close</button>
      </div>
    </div>
  `;

  document.documentElement.appendChild(overlayElement);

  // Close button handler
  document.getElementById('focus-alarm-close-btn').addEventListener('click', () => {
    if (overlayElement && overlayElement.parentElement) {
      overlayElement.parentElement.removeChild(overlayElement);
    }
    overlayElement = null;
  });
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
