"use client";

/**
 * All game sound effects are synthesized with the Web Audio API rather than
 * shipped as audio files — no licensing to track, nothing to fetch, and each
 * effect is a couple of oscillator/noise nodes with a short gain envelope.
 */

const MUTE_STORAGE_KEY = "5lapnow_sound_muted";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  // Browsers start a fresh AudioContext "suspended" until a user gesture —
  // by the time any game sound fires the player has already clicked/tapped
  // something (sit down, start hand, act), so resuming here is always safe.
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

// One second of white noise, generated once and reused (sliced via
// BufferSource.start/stop) for every noise-based effect (folds, chip clicks,
// card flips) rather than re-generating a buffer per call.
let noiseBuffer: AudioBuffer | null = null;
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buffer;
  }
  return noiseBuffer;
}

function tone(
  ctx: AudioContext,
  freq: number,
  durationSec: number,
  opts: { type?: OscillatorType; gain?: number; delaySec?: number; sweepTo?: number } = {}
) {
  const { type = "sine", gain = 0.2, delaySec = 0, sweepTo } = opts;
  const start = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(sweepTo, 1), start + durationSec);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
  osc.connect(g).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationSec + 0.02);
}

function noiseBurst(
  ctx: AudioContext,
  durationSec: number,
  opts: { filterFreq?: number; filterType?: BiquadFilterType; q?: number; gain?: number; delaySec?: number; sweepTo?: number } = {}
) {
  const { filterFreq = 2000, filterType = "bandpass", q = 1, gain = 0.15, delaySec = 0, sweepTo } = opts;
  const start = ctx.currentTime + delaySec;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFreq, start);
  if (sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(sweepTo, 1), start + durationSec);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(start);
  src.stop(start + durationSec + 0.02);
}

export function isSoundMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
}

export function setSoundMuted(muted: boolean): void {
  window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
}

/** Wraps every effect: no-ops when muted, and swallows the rare case a browser throws (e.g. AudioContext still locked). */
function play(effect: (ctx: AudioContext) => void) {
  if (isSoundMuted()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    effect(ctx);
  } catch {
    // Best-effort — a failed sound should never break gameplay.
  }
}

/**
 * Plays an uploaded audio file from /public/sounds instead of a synthesized
 * effect — a fresh `Audio` element per call (rather than one reused
 * instance) so the same cue can overlap itself (e.g. a fast eat chain)
 * without cutting the previous play-through short.
 */
function playFile(path: string, volume = 0.7) {
  if (isSoundMuted() || typeof window === "undefined") return;
  try {
    const audio = new Audio(path);
    audio.volume = volume;
    void audio.play().catch(() => {
      // Best-effort — a failed sound should never break gameplay.
    });
  } catch {
    // Best-effort — a failed sound should never break gameplay.
  }
}

/** An uploaded check sound (apps/web/public/sounds/check.mp3), played quieter than the default volume. */
export function playCheckSound(): void {
  playFile("/sounds/check.mp3", 0.35);
}

/** A muted, descending swish of cards being mucked — fold. */
export function playFoldSound(): void {
  play((ctx) => noiseBurst(ctx, 0.16, { filterFreq: 900, filterType: "lowpass", q: 0.6, gain: 0.12, sweepTo: 200 }));
}

/**
 * An uploaded bet sound (apps/web/public/sounds/bet.mp3) — chips landing in
 * the pot. Post (blinds/antes), call, and bet/raise all reuse the same
 * clip, scaled by volume to how much action it represents.
 */
export function playChipsSound(strength: "post" | "call" | "bet"): void {
  const volume = strength === "post" ? 0.4 : strength === "call" ? 0.6 : 0.85;
  playFile("/sounds/bet.mp3", volume);
}

/** Clang: an uploaded slurp sound for an Eat (apps/web/public/sounds/slurp.mp3). */
export function playEatSound(): void {
  playFile("/sounds/slurp.mp3");
}

/** An uploaded win sound (apps/web/public/sounds/win.wav) — the viewer's own seat gained money from a hand/round that just completed. */
export function playWinSound(): void {
  playFile("/sounds/win.wav");
}

/**
 * Clang: a bright metallic "clang!" for someone actually calling Clang
 * (normal or instant) — a brief metal-strike transient plus three
 * slightly-detuned tones ringing out and decaying together like a bell,
 * rather than the game's other, more percussive one-shot effects. Longest
 * layer runs 0.6s — see CLANG_CALLED_SOUND_MS below, which `useWinSound`'s
 * Clang call site uses to queue the win sound right after this one finishes
 * instead of overlapping it.
 */
export function playClangCalledSound(): void {
  play((ctx) => {
    noiseBurst(ctx, 0.03, { filterFreq: 3000, filterType: "bandpass", q: 2, gain: 0.15 });
    tone(ctx, 880, 0.5, { type: "triangle", gain: 0.22, sweepTo: 820 });
    tone(ctx, 1320, 0.4, { type: "sine", gain: 0.14, sweepTo: 1260 });
    tone(ctx, 660, 0.6, { type: "sine", gain: 0.16, sweepTo: 600 });
  });
}

/** Approximate duration of playClangCalledSound, for sequencing the win sound after it. */
export const CLANG_CALLED_SOUND_MS = 650;

/**
 * An uploaded deal-card sound (apps/web/public/sounds/dealcard.mp3), played
 * once per card — staggered to match the deal animation's own per-card delay
 * (see PlayingCard's `dealDelay`). Shared by poker's community-card deal
 * (`count` > 1 for a full street) and single-card draws in Clang / 10 Card
 * Flip (`count` = 1). Poker hole cards dealt to a player's own hand stay
 * silent (see useHandActionSounds).
 */
export function playCardDealSound(count: number): void {
  const cappedCount = Math.min(count, 5);
  for (let i = 0; i < cappedCount; i++) {
    if (i === 0) playFile("/sounds/dealcard.mp3");
    else setTimeout(() => playFile("/sounds/dealcard.mp3"), i * 120);
  }
}

/** A brighter two-note chime — distinct from every action sound above — for "it's your turn to act". */
export function playYourTurnSound(): void {
  play((ctx) => {
    tone(ctx, 660, 0.12, { type: "sine", gain: 0.22 });
    tone(ctx, 880, 0.16, { type: "sine", gain: 0.22, delaySec: 0.11 });
  });
}

/** An uploaded alert sound (apps/web/public/sounds/alert.mp3) — it's still your turn 5s in and you haven't acted yet. */
export function playTurnReminderSound(): void {
  playFile("/sounds/alert.mp3", 1);
}
