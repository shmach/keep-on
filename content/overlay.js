// Content Script: Overlay Injection
// Runs on all tabs, listens for alarm messages from service worker

let overlayElement = null; // shadow host, appended to document.documentElement
let shadowRoot = null;
let counterInterval = null;
let distraction = null;
let beforeUnloadHandler = null;
let cachedCss = null;

// Content scripts are treated as the page's origin for resource loading, so
// overlay.css must be listed in manifest.json's web_accessible_resources for
// this fetch to succeed — same reason the coach images need it.
async function getOverlayCss() {
  if (cachedCss) return cachedCss;
  const response = await fetch(chrome.runtime.getURL('content/overlay.css'));
  cachedCss = await response.text();
  return cachedCss;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SHOW_OVERLAY') {
    showAlarmOverlay(request.sessionInfo, request.distractionStartedAt, request.url).catch(() => { });
    sendResponse({ success: true });
  } else if (request.type === 'HIDE_OVERLAY') {
    // Service worker already closed out the distraction (user switched tabs,
    // session ended), so tear down without reporting it again
    removeOverlay();
    sendResponse({ success: true });
  }
});

async function showAlarmOverlay(sessionInfo, distractionStartedAt, url) {
  if (overlayElement) {
    return; // Already showing
  }

  distraction = {
    sessionStartedAt: sessionInfo.startedAt,
    focusTabId: sessionInfo.focusTabId,
    distractionStartedAt: distractionStartedAt || Date.now()
  };

  // Reserve the slot immediately so a second SHOW_OVERLAY firing while the
  // CSS fetch below is in flight doesn't inject a duplicate overlay
  overlayElement = document.createElement('div');
  overlayElement.id = 'keep-on-overlay-host';
  document.documentElement.appendChild(overlayElement);
  shadowRoot = overlayElement.attachShadow({ mode: 'open' });

  const minutesIn = Math.round((Date.now() - sessionInfo.startedAt) / 1000 / 60);
  const hasFocusTab = Number.isInteger(sessionInfo.focusTabId);

  const css = await getOverlayCss();

  // Host page CSS is fully blocked by the shadow boundary; only inherited
  // properties (line-height, font-size, color...) can still leak in from the
  // host element's computed style, hence the :host reset in overlay.css
  if (!overlayElement) {
    return; // removeOverlay() ran while the fetch above was in flight
  }

  shadowRoot.innerHTML = `
    <style>${css}</style>
    <div id="focus-alarm-overlay">
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
          <img data-coach-image alt="Coach Max" class="coach-image">
          <div class="coach-phrase-container">
            <span data-coach-phrase class="coach-phrase"></span>
          </div>
        </div>
          ${hasFocusTab ? '<button id="focus-alarm-back-btn" class="focus-alarm-btn">Back to focus tab</button>' : ''}
          <button id="focus-alarm-dismiss-btn" class="focus-alarm-btn${hasFocusTab ? ' secondary' : ''}">Dismiss</button>
        </div>
      </div>
    </div>
  `;

  let distractionCount;

  if (sessionInfo.distractions > 3) {
    distractionCount = 'infinity';
  } else if (sessionInfo.distractions > 0) {
    distractionCount = sessionInfo.distractions;
  } else {
    distractionCount = 1;
  }

  const { image, phrase } = getCoachMoment(
    "distraction",
    {
      distractions: distractionCount,
      minutesIn: minutesIn,
      minutesLeft: sessionInfo.durationMs / 60000 - minutesIn,
      url
    }
  );

  const coachImageEl = shadowRoot.querySelector('[data-coach-image]');
  const coachPhraseEl = shadowRoot.querySelector('[data-coach-phrase]');

  if (image) coachImageEl.src = image;
  if (phrase) coachPhraseEl.textContent = phrase;

  coachImageEl.addEventListener('error', () => coachImageEl.style.display = 'none');

  // Event listeners
  shadowRoot.getElementById('focus-alarm-dismiss-btn').addEventListener('click', dismissOverlay);

  const backBtn = shadowRoot.getElementById('focus-alarm-back-btn');
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
    const counterEl = shadowRoot.getElementById('distraction-counter');
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
  shadowRoot = null;
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
