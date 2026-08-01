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

async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

// Load settings on page load
async function loadSettings() {
  const settings = await getSettings();

  // Grace period
  gracePeriodSlider.value = settings.gracePeriodMs / 1000;
  gracePeriodValue.textContent = settings.gracePeriodMs / 1000;

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

async function saveSetting(key, value) {
  const settings = await getSettings();
  settings[key] = value;
  await chrome.storage.local.set({ settings });
  showSaveMessage();
}

function showSaveMessage() {
  saveMessage.style.display = 'block';
  setTimeout(() => {
    saveMessage.style.display = 'none';
  }, 2000);
}

async function removeDomain(domain) {
  const settings = await getSettings();
  const blacklist = settings.blacklist.filter((d) => d !== domain);
  await saveSetting('blacklist', blacklist);
  renderBlacklist(blacklist);
}

async function addDomain() {
  const domain = normalizeDomain(newDomainInput.value);

  if (!domain) {
    alert('Please enter a valid domain, e.g. reddit.com');
    return;
  }

  const settings = await getSettings();

  if (settings.blacklist.some((d) => normalizeDomain(d) === domain)) {
    alert('Domain already in blacklist');
    return;
  }

  const blacklist = [...settings.blacklist, domain];
  await saveSetting('blacklist', blacklist);
  renderBlacklist(blacklist);

  newDomainInput.value = '';
}

async function resetToDefaults() {
  if (confirm('Reset all settings to defaults?')) {
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
    await loadSettings();
    showSaveMessage();
  }
}

// Event listeners
gracePeriodSlider.addEventListener('input', async (e) => {
  const ms = parseInt(e.target.value) * 1000;
  gracePeriodValue.textContent = e.target.value;
  await saveSetting('gracePeriodMs', ms);
});

alarmSoundToggle.addEventListener('change', async (e) => {
  await saveSetting('alarmSound', e.target.checked);
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
