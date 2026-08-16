// Offscreen document: plays the distraction alarm beep.
// Unlike the tab that triggers the alarm, this document belongs to the
// extension itself, so it isn't subject to Chrome's per-tab autoplay policy
// (which requires a user gesture on the page before Web Audio can start).

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PLAY_ALARM_SOUND') {
    playBeep();
    sendResponse({ success: true });
  }
});

function playBeep() {
  try {
    const audioContext = new AudioContext();
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
    oscillator.onended = () => audioContext.close().catch(() => { });
  } catch (e) {
    // Audio unavailable; fail silently
  }
}
