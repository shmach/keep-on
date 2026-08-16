// Offscreen document: plays the distraction alarm sound.
// Unlike the tab that triggers the alarm, this document belongs to the
// extension itself, so it isn't subject to Chrome's per-tab autoplay policy
// (which requires a user gesture on the page before Web Audio can start).

const ALARM_SOUND_URL = chrome.runtime.getURL('assets/sounds/whistle-sound-effect.mp3');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PLAY_ALARM_SOUND') {
    playAlarmSound();
    sendResponse({ success: true });
  }
});

function playAlarmSound() {
  try {
    const audio = new Audio(ALARM_SOUND_URL);
    audio.volume = 0.5;
    audio.play().catch(() => { });
  } catch (e) {
    // Audio unavailable; fail silently
  }
}
