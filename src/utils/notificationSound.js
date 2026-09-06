// The arrival cue, synthesised with the Web Audio API.
//
// WHY SYNTHESISED RATHER THAN AN AUDIO FILE
//
// This is a few hundred bytes of code that produce the same result as shipping
// an MP3, minus the asset, minus the decode, minus a request that can 404 on a
// misconfigured host, and minus a dependency. Nothing here needs a library.
//
// WHAT CHANGED, AND WHY THE PREVIOUS ONE SOUNDED CHEAP
//
// The old cue was two bare sine tones at 0.06 gain. A pure sine has no
// harmonics at all, which is precisely what makes it read as a test tone rather
// than as a notification — real notification sounds are struck, not held. Three
// things fix that, and all three matter:
//
//   1. PARTIALS. Each note is now several oscillators at once: the fundamental
//      plus quieter partials at inharmonic ratios (2.76x, 5.40x — the ratios a
//      struck bar actually produces, not whole-number harmonics). That
//      inharmonicity is what the ear hears as "a bell" instead of "a beep".
//   2. ENVELOPE. A near-instant attack and a long exponential decay, with the
//      upper partials decaying faster than the fundamental — exactly what
//      happens to a real struck object, and what stops the tone sounding
//      electronic.
//   3. LEVEL. Peak gain is ~0.28 rather than 0.06, so it is audible across a
//      room without being startling, and it is gone in about half a second.
//
// It is two notes, a rising fourth, played once. Deliberately NOT a loop, not a
// siren, not a repeating pattern: this announces a case being logged, not an
// emergency, and a cue that people learn to dread is a cue people mute.

// C6 then F6 — a rising perfect fourth, the interval most system notification
// sounds use because it reads as "attention" rather than as "alarm" (which
// tends to be a falling or repeating minor interval).
const NOTES = [
  { frequency: 1046.5, at: 0, duration: 0.5 },
  { frequency: 1396.9, at: 0.11, duration: 0.62 },
];

// Ratios of a struck metal bar. Not 2x/3x: whole-number harmonics sound like an
// organ, these sound like a chime. The gains are what keep the fundamental
// dominant so the pitch stays clear.
const PARTIALS = [
  { ratio: 1, gain: 1 },
  { ratio: 2.76, gain: 0.32 },
  { ratio: 5.4, gain: 0.12 },
];

const PEAK_GAIN = 0.28;

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

/**
 * Brings the audio system out of the suspended state browsers start it in.
 *
 * AUTOPLAY, honestly handled. Browsers refuse to start audio until the user has
 * interacted with the page, and an AudioContext created before that sits
 * 'suspended'. Nothing in JavaScript can bypass that, and this does not try to:
 * it simply asks to resume at the first moment the browser will agree, which is
 * during a real user gesture.
 *
 * Called from a global pointerdown/keydown listener installed once after
 * sign-in (see MainLayout), so by the time any notification can arrive the
 * context is normally already running. If the user somehow receives a
 * notification before touching the page at all, playNotificationChime() below
 * still asks to resume — it just may be refused, in which case the pop-up, the
 * bell and the system notification all still carry the message.
 *
 * Safe to call repeatedly; resuming a running context is a no-op.
 */
export function unlockNotificationAudio() {
  const ctx = getContext();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') {
      const resumed = ctx.resume();
      // resume() REJECTS rather than throws when the browser still refuses, so
      // the promise needs its own catch as well as the surrounding try. An
      // unhandled rejection here would surface in the console as an error the
      // user can do nothing about.
      if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
    }
  } catch {
    /* No audio available. Nothing to recover; nothing to report. */
  }
}

/**
 * Plays the arrival cue once.
 *
 * Every failure path is a silent no-op by design: a blocked or unavailable
 * sound must never surface as an error to somebody in the middle of logging a
 * crime report, and the notification itself is never carried by audio alone.
 */
export function playNotificationChime() {
  const ctx = getContext();
  if (!ctx) return;

  try {
    unlockNotificationAudio();

    // A context that is still suspended cannot schedule anything audible, and
    // scheduling into one produces silence at an unpredictable later time when
    // it does resume. Better to skip this cue entirely.
    if (ctx.state === 'suspended') return;

    const start = ctx.currentTime;

    // One shared output stage, so the two notes' partials sum through a single
    // gain rather than each fighting for headroom. The low-pass takes the edge
    // off the highest partial, which is what keeps it from sounding tinny on
    // laptop speakers.
    const output = ctx.createGain();
    output.gain.value = PEAK_GAIN;

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 7000;

    output.connect(tone);
    tone.connect(ctx.destination);

    NOTES.forEach(({ frequency, at, duration }) => {
      const t0 = start + at;

      PARTIALS.forEach(({ ratio, gain }) => {
        const oscillator = ctx.createOscillator();
        const envelope = ctx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency * ratio;

        // Struck, not switched on: 6 ms to full level, then an exponential
        // decay. Upper partials decay faster (the /ratio term), which is what
        // real resonant objects do and what makes the tail sound natural.
        const decay = duration / Math.max(1, ratio * 0.7);

        envelope.gain.setValueAtTime(0.0001, t0);
        envelope.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
        // exponentialRampToValueAtTime cannot reach zero, hence the tiny
        // non-zero floor; the oscillator is stopped immediately afterwards so
        // nothing is left ringing.
        envelope.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);

        oscillator.connect(envelope);
        envelope.connect(output);
        oscillator.start(t0);
        oscillator.stop(t0 + decay + 0.02);
      });
    });
  } catch {
    /* Audio unavailable or blocked — the pop-up, the bell and (when permitted)
       the system notification all still carry the notification, so there is
       nothing to report and nothing to recover. */
  }
}
