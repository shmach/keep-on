// Options Page Script
// Manage extension settings
// Depends on lib/shared.js for DEFAULT_SETTINGS and normalizeDomain

const gracePeriodSlider = document.getElementById('grace-period-slider');
const gracePeriodValue = document.getElementById('grace-period-value');
const alarmSoundToggle = document.getElementById('alarm-sound-toggle');
const newDomainInput = document.getElementById('new-domain-input');
const addDomainBtn = document.getElementById('add-domain-btn');
const resetBtn = document.getElementById('reset-btn');
const saveMessage = document.getElementById('save-message');
const blacklistContainer = document.getElementById('blacklist-container');

const MIN_GRACE_SECONDS = 5;
const MAX_GRACE_SECONDS = 60;

function clampGracePeriodSeconds(value) {
  const seconds = parseInt(value, 10);
  if (!Number.isFinite(seconds)) return MIN_GRACE_SECONDS;
  return Math.min(MAX_GRACE_SECONDS, Math.max(MIN_GRACE_SECONDS, seconds));
}

async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

// Every read-modify-write of `settings` is chained onto this promise so
// concurrent edits (e.g. two quick blacklist removals) can't clobber each
// other by both reading before either write lands.
let settingsQueue = Promise.resolve();

// `mutate` may return `false` to skip persisting (e.g. a rejected duplicate)
function updateSettings(mutate) {
  const result = settingsQueue.then(async () => {
    const settings = await getSettings();
    const changed = mutate(settings) !== false;
    if (changed) {
      await chrome.storage.local.set({ settings });
      showSaveMessage();
    }
    return settings;
  });
  settingsQueue = result.catch(() => { });
  return result;
}

// Load settings on page load
async function loadSettings() {
  const settings = await getSettings();

  // Grace period
  const seconds = clampGracePeriodSeconds(settings.gracePeriodMs / 1000);
  gracePeriodSlider.value = seconds;
  gracePeriodValue.textContent = seconds;

  // Alarm sound
  alarmSoundToggle.checked = settings.alarmSound;

  // Blacklist
  renderBlacklist(settings.blacklist);
}

function renderBlacklist(domains) {
  blacklistContainer.innerHTML = '';

  domains.forEach((domain) => {
    const item = document.createElement('div');
    item.className = 'blacklist-item';

    // Built with textContent: domains come from user input and must never be
    // interpolated into HTML
    const label = document.createElement('span');
    label.className = 'blacklist-item-domain';
    label.textContent = domain;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'blacklist-item-remove';
    removeBtn.dataset.domain = domain;
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeDomain(domain));

    item.appendChild(label);
    item.appendChild(removeBtn);
    blacklistContainer.appendChild(item);
  });
}

function showSaveMessage() {
  saveMessage.style.display = 'block';
  setTimeout(() => {
    saveMessage.style.display = 'none';
  }, 2000);
}

async function removeDomain(domain) {
  const settings = await updateSettings((s) => {
    s.blacklist = s.blacklist.filter((d) => d !== domain);
  });
  renderBlacklist(settings.blacklist);
}

async function addDomain() {
  const domain = normalizeDomain(newDomainInput.value);

  if (!domain) {
    alert('Please enter a valid domain, e.g. reddit.com');
    return;
  }

  let duplicate = false;
  const settings = await updateSettings((s) => {
    if (s.blacklist.some((d) => normalizeDomain(d) === domain)) {
      duplicate = true;
      return false;
    }
    s.blacklist = [...s.blacklist, domain];
  });

  if (duplicate) {
    alert('Domain already in blacklist');
    return;
  }

  renderBlacklist(settings.blacklist);
  newDomainInput.value = '';
}

async function resetToDefaults() {
  if (confirm('Reset all settings to defaults?')) {
    await updateSettings((s) => {
      Object.assign(s, DEFAULT_SETTINGS, { blacklist: [...DEFAULT_SETTINGS.blacklist] });
    });
    await loadSettings();
  }
}

// Event listeners
gracePeriodSlider.addEventListener('input', async (e) => {
  const seconds = clampGracePeriodSeconds(e.target.value);
  gracePeriodSlider.value = seconds;
  gracePeriodValue.textContent = seconds;
  await updateSettings((s) => { s.gracePeriodMs = seconds * 1000; });
});

alarmSoundToggle.addEventListener('change', async (e) => {
  await updateSettings((s) => { s.alarmSound = e.target.checked; });
});

addDomainBtn.addEventListener('click', addDomain);

newDomainInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addDomain();
  }
});

resetBtn.addEventListener('click', resetToDefaults);

// Initialize
loadSettings();
