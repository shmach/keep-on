// Options Page Script
// Manage extension settings

const gracePeriodSlider = document.getElementById('grace-period-slider');
const gracePeriodValue = document.getElementById('grace-period-value');
const alarmSoundToggle = document.getElementById('alarm-sound-toggle');
const newDomainInput = document.getElementById('new-domain-input');
const addDomainBtn = document.getElementById('add-domain-btn');
const resetBtn = document.getElementById('reset-btn');
const saveMessage = document.getElementById('save-message');
const blacklistContainer = document.getElementById('blacklist-container');

const DEFAULTS = {
  settings: {
    gracePeriodMs: 15000,
    alarmSound: true,
    blacklist: [
      'twitter.com', 'x.com', 'reddit.com', 'instagram.com',
      'tiktok.com', 'facebook.com', 'youtube.com'
    ]
  }
};

// Load settings on page load
async function loadSettings() {
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || DEFAULTS.settings;

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
    item.innerHTML = `
      <span class="blacklist-item-domain">${domain}</span>
      <button class="blacklist-item-remove" data-domain="${domain}">Remove</button>
    `;

    const removeBtn = item.querySelector('.blacklist-item-remove');
    removeBtn.addEventListener('click', () => removeDomain(domain));

    blacklistContainer.appendChild(item);
  });
}

async function saveSetting(key, value) {
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || DEFAULTS.settings;
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
  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || DEFAULTS.settings;
  settings.blacklist = settings.blacklist.filter((d) => d !== domain);
  await saveSetting('blacklist', settings.blacklist);
  renderBlacklist(settings.blacklist);
}

async function addDomain() {
  const domain = newDomainInput.value.trim();

  if (!domain) {
    alert('Please enter a domain');
    return;
  }

  const result = await chrome.storage.local.get('settings');
  const settings = result.settings || DEFAULTS.settings;

  if (settings.blacklist.includes(domain)) {
    alert('Domain already in blacklist');
    return;
  }

  settings.blacklist.push(domain);
  await saveSetting('blacklist', settings.blacklist);
  renderBlacklist(settings.blacklist);

  newDomainInput.value = '';
}

async function resetToDefaults() {
  if (confirm('Reset all settings to defaults?')) {
    await chrome.storage.local.set({ settings: DEFAULTS.settings });
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
