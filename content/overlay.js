// Content Script: Overlay Injection
// Runs on all tabs, listens for alarm messages from service worker

let overlayElement = null;
let overlayStartTime = null;
let distraction = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SHOW_OVERLAY') {
    showAlarmOverlay(request.sessionInfo);
    sendResponse({ success: true });
  }
});

function showAlarmOverlay(sessionInfo) {
  if (overlayElement) {
    return; // Already showing
  }

  overlayStartTime = Date.now();
  distraction = {
    sessionStartedAt: sessionInfo.startedAt,
    focusTabId: sessionInfo.focusTabId
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
        <button id="focus-alarm-back-btn" class="focus-alarm-btn">↩ Go Back to Focus Tab</button>
        <button id="focus-alarm-dismiss-btn" class="focus-alarm-btn secondary">Dismiss</button>
      </div>
    </div>
  `;

  document.documentElement.appendChild(overlayElement);

  // Inject styles if not already there
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
        margin: 0 0 24px 0;
        font-size: 16px;
        color: #333;
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

  // Play alarm sound
  playAlarmSound();

  // Event listeners
  document.getElementById('focus-alarm-back-btn').addEventListener('click', () => {
    if (distraction.focusTabId) {
      chrome.tabs.update(distraction.focusTabId, { active: true });
    }
    dismissOverlay();
  });

  document.getElementById('focus-alarm-dismiss-btn').addEventListener('click', dismissOverlay);

  // Update counter every second
  const counterInterval = setInterval(() => {
    if (!overlayElement || !overlayElement.parentElement) {
      clearInterval(counterInterval);
      return;
    }
    const elapsed = Math.round((Date.now() - overlayStartTime) / 1000);
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
