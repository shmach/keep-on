// Content Script: Overlay Injection
// Runs on all tabs, listens for alarm messages from service worker

let overlayElement = null;
let overlayStartTime = null;
let distraction = null;

function injectSharedStyles() {
  if (!document.getElementById('focus-alarm-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'focus-alarm-styles';
    styleEl.textContent = `
      #focus-alarm-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 2147483647;
      }

      .focus-alarm-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        z-index: 2147483647;
      }

      .focus-alarm-card {
        background: white;
        border-radius: 12px;
        padding: 32px;
        max-width: 420px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        text-align: center;
      }

      .focus-alarm-title {
        margin: 0 0 16px 0;
        font-size: 28px;
        color: #d32f2f;
        font-weight: 600;
      }

      .focus-alarm-title.success {
        color: #4CAF50;
      }

      .focus-alarm-counter {
        margin: 0 0 16px 0;
        font-size: 18px;
        color: #666;
        font-weight: 500;
      }

      #distraction-counter {
        color: #d32f2f;
        font-weight: 600;
      }

      .focus-alarm-message {
        margin: 0 0 16px 0;
        font-size: 16px;
        color: #333;
        line-height: 1.5;
      }

      .focus-alarm-recommendation {
        margin: 0 0 24px 0;
        font-size: 14px;
        color: #666;
        font-style: italic;
        line-height: 1.5;
      }

      .focus-alarm-btn {
        display: block;
        width: 100%;
        padding: 12px 16px;
        margin: 8px 0;
        border: none;
        border-radius: 6px;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .focus-alarm-btn:not(.secondary) {
        background: #4CAF50;
        color: white;
      }

      .focus-alarm-btn:not(.secondary):hover {
        background: #45a049;
      }

      .focus-alarm-btn.secondary {
        background: #e0e0e0;
        color: #333;
      }

      .focus-alarm-btn.secondary:hover {
        background: #d0d0d0;
      }
    `;
    document.head.appendChild(styleEl);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Focus Alarm Content] Received message:', request.type);
  if (request.type === 'SHOW_OVERLAY') {
    console.log('[Focus Alarm Content] Showing overlay for distraction');
    showAlarmOverlay(request.sessionInfo, request.distractionStartedAt);
    sendResponse({ success: true });
  } else if (request.type === 'SESSION_COMPLETE') {
    console.log('[Focus Alarm Content] Showing session complete overlay');
    showSessionCompleteOverlay(request.stats);
    sendResponse({ success: true });
  }
});

function showAlarmOverlay(sessionInfo, distractionStartedAt) {
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

  // Inject shared styles if not already there
  injectSharedStyles();

  // Play alarm sound
  playAlarmSound();

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

  // Auto-dismiss if tab URL changes
  const handleUrlChange = () => {
    dismissOverlay();
  };
  window.addEventListener('beforeunload', handleUrlChange);
}

function dismissOverlay() {
  if (overlayElement && overlayElement.parentElement) {
    overlayElement.parentElement.removeChild(overlayElement);
  }
  overlayElement = null;
  overlayStartTime = null;
  distraction = null;

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

  // Inject shared styles if not already present
  injectSharedStyles();

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
    console.log('Could not play alarm sound:', e);
  }
}
