// Short notification chime, synthesised with the Web Audio API.
//
// Why synthesised rather than an audio file: this is two sine tones and a
// gentle fade, about a hundred bytes of code, so the alternative would be
// shipping an asset to the browser for something the browser can already
// produce. It also sidesteps decoding and caching entirely.
//
// AUTOPLAY. Browsers refuse to start audio until the user has interacted with
// the page, and an AudioContext created before that starts 'suspended'.
// Signing in IS an interaction, so by the time any notification can arrive the
// context is normally allowed to run. Everything below is nonetheless written
// so that a refusal is a silent no-op: resume() is best-effort and every path
// is wrapped, because a blocked sound must never surface as an error to
// somebody logging a crime report.

let audioContext = null;

function getContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) {
    try {
      audioContext = new Ctor();
    } catch {
      return null;
    }
  }
  return audioContext;
}

// Two soft tones a fifth apart (988 Hz / 1319 Hz), 90 ms apart, each about a
// fifth of a second and peaking at 0.06 gain — audible in an office, nowhere
// near attention-grabbing. Deliberately not a loop and not a sequence: one
// short, low, professional cue.
const TONES = [
  { frequency: 987.77, at: 0 },
  { frequency: 1318.51, at: 0.09 },
];

export function playNotificationChime() {
  const ctx = getContext();
  if (!ctx) return;

  try {
    // A context created before any interaction sits suspended; resume() is
    // rejected rather than throwing when the browser still refuses, hence the
    // catch on the promise as well as the surrounding try.
    if (ctx.state === 'suspended') {
      const resumed = ctx.resume();
      if (resumed && typeof resumed.catch === 'function') {
        resumed.catch(() => {});
      }
    }

    const start = ctx.currentTime;

    TONES.forEach(({ frequency, at }) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;

      // Ramped rather than switched, so the tone does not click on or off.
      const t0 = start + at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(t0);
      oscillator.stop(t0 + 0.24);
    });
  } catch {
    /* Audio unavailable or blocked — the popup and the bell still carry the
       notification, so there is nothing to report and nothing to recover. */
  }
}
