export type SoundCue = 'swing' | 'hit' | 'kill' | 'levelUp' | 'bossEntrance';

export interface SoundState {
  soundUnlocked: boolean;
  soundMuted: boolean;
}

const MASTER_GAIN = 0.3;
const COMBAT_GATE_SECONDS = 0.12;
const GATE_EPSILON = 1e-9;
const NOISE_BUFFER_SECONDS = 0.4;

type AudioContextConstructor = typeof AudioContext;

interface EnvPoint {
  ms: number;
  gain: number;
}

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = false;
let lastHitTime = -Infinity;
let lastKillTime = -Infinity;

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const g = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return g.AudioContext ?? g.webkitAudioContext;
}

function getOrCreateNoiseBuffer(audioCtx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === audioCtx.sampleRate) {
    return noiseBuffer;
  }
  // Noise draws come straight from Math.random(). Live gameplay randomness
  // is unseeded (spawns and upgrade choices also use Math.random()), so the
  // shifted sequence changes nothing deterministic; the sim uses its own
  // seeded RNG and never imports this module.
  const length = Math.ceil(audioCtx.sampleRate * NOISE_BUFFER_SECONDS);
  const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

function applyGainEnvelope(gainParam: AudioParam, baseTime: number, points: readonly EnvPoint[]): number {
  gainParam.setValueAtTime(points[0].gain, baseTime + points[0].ms / 1000);
  for (let i = 1; i < points.length; i += 1) {
    gainParam.linearRampToValueAtTime(points[i].gain, baseTime + points[i].ms / 1000);
  }
  return baseTime + points[points.length - 1].ms / 1000;
}

function scheduleOscLayer(
  audioCtx: AudioContext,
  dest: GainNode,
  type: OscillatorType,
  startHz: number,
  endHz: number | null,
  startTime: number,
  sweepEndMs: number,
  points: readonly EnvPoint[],
): void {
  const osc = audioCtx.createOscillator();
  const layerGain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(startHz, startTime);
  if (endHz !== null) {
    osc.frequency.exponentialRampToValueAtTime(endHz, startTime + sweepEndMs / 1000);
  }
  const stopTime = applyGainEnvelope(layerGain.gain, startTime, points);
  osc.connect(layerGain);
  layerGain.connect(dest);
  osc.onended = () => {
    osc.disconnect();
    layerGain.disconnect();
  };
  osc.start(startTime);
  osc.stop(stopTime);
}

function scheduleNoiseLayer(
  audioCtx: AudioContext,
  dest: GainNode,
  filterType: BiquadFilterType,
  freqHz: number,
  q: number,
  startTime: number,
  points: readonly EnvPoint[],
): void {
  const source = audioCtx.createBufferSource();
  source.buffer = getOrCreateNoiseBuffer(audioCtx);
  source.loop = false;

  const filter = audioCtx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freqHz, startTime);
  filter.Q.setValueAtTime(q, startTime);

  const layerGain = audioCtx.createGain();
  const stopTime = applyGainEnvelope(layerGain.gain, startTime, points);

  source.connect(filter);
  filter.connect(layerGain);
  layerGain.connect(dest);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    layerGain.disconnect();
  };
  source.start(startTime, 0);
  source.stop(stopTime);
}

export function unlockSound(): void {
  if (!ctx) {
    const AudioCtx = getAudioContextConstructor();
    if (!AudioCtx) {
      return;
    }
    try {
      const created = new AudioCtx();
      const gain = created.createGain();
      gain.gain.value = muted ? 0 : MASTER_GAIN;
      gain.connect(created.destination);
      ctx = created;
      masterGain = gain;
    } catch {
      ctx = null;
      masterGain = null;
      return;
    }
  }

  if (ctx.state === 'suspended') {
    try {
      const res = ctx.resume();
      if (res && typeof res.catch === 'function') {
        res.catch(() => {});
      }
    } catch {
      // Leave the game playable and silent if resume rejects synchronously.
    }
  }
}

export function setSoundMuted(nextMuted: boolean): void {
  muted = nextMuted;
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : MASTER_GAIN;
  }
}

export function getSoundState(): SoundState {
  return {
    soundUnlocked: ctx !== null && ctx.state === 'running',
    soundMuted: muted,
  };
}

export function playSound(cue: SoundCue): void {
  if (muted || !ctx || !masterGain || ctx.state !== 'running') {
    return;
  }

  const t = ctx.currentTime;
  if (cue === 'hit') {
    if (t - lastHitTime < COMBAT_GATE_SECONDS - GATE_EPSILON) {
      return;
    }
    lastHitTime = t;
  } else if (cue === 'kill') {
    if (t - lastKillTime < COMBAT_GATE_SECONDS - GATE_EPSILON) {
      return;
    }
    lastKillTime = t;
  }

  switch (cue) {
    case 'swing':
      scheduleOscLayer(ctx, masterGain, 'triangle', 360, 120, t, 80, [
        { ms: 0, gain: 0 },
        { ms: 5, gain: 0.13 },
        { ms: 80, gain: 0 },
      ]);
      scheduleNoiseLayer(ctx, masterGain, 'bandpass', 1100, 0.8, t, [
        { ms: 0, gain: 0 },
        { ms: 8, gain: 0.28 },
        { ms: 95, gain: 0 },
      ]);
      break;
    case 'hit':
      scheduleOscLayer(ctx, masterGain, 'triangle', 230, 105, t, 55, [
        { ms: 0, gain: 0 },
        { ms: 3, gain: 0.26 },
        { ms: 55, gain: 0 },
      ]);
      scheduleNoiseLayer(ctx, masterGain, 'lowpass', 1500, 0.707, t, [
        { ms: 0, gain: 0 },
        { ms: 2, gain: 0.16 },
        { ms: 26, gain: 0 },
      ]);
      break;
    case 'kill':
      scheduleOscLayer(ctx, masterGain, 'triangle', 460, 145, t, 120, [
        { ms: 0, gain: 0 },
        { ms: 4, gain: 0.33 },
        { ms: 36, gain: 0.16 },
        { ms: 120, gain: 0 },
      ]);
      scheduleNoiseLayer(ctx, masterGain, 'bandpass', 720, 1.1, t, [
        { ms: 0, gain: 0 },
        { ms: 3, gain: 0.17 },
        { ms: 48, gain: 0 },
      ]);
      break;
    case 'levelUp': {
      const notes = [
        { freq: 523.25, delayMs: 0 },
        { freq: 659.25, delayMs: 70 },
        { freq: 783.99, delayMs: 140 },
      ];
      for (const note of notes) {
        scheduleOscLayer(
          ctx,
          masterGain,
          'triangle',
          note.freq,
          null,
          t + note.delayMs / 1000,
          0,
          [
            { ms: 0, gain: 0 },
            { ms: 6, gain: 0.23 },
            { ms: 55, gain: 0.09 },
            { ms: 105, gain: 0 },
          ],
        );
      }
      break;
    }
    case 'bossEntrance':
      scheduleOscLayer(ctx, masterGain, 'triangle', 110, 55, t, 420, [
        { ms: 0, gain: 0 },
        { ms: 24, gain: 0.37 },
        { ms: 135, gain: 0.22 },
        { ms: 420, gain: 0 },
      ]);
      scheduleOscLayer(ctx, masterGain, 'sine', 165, 82.5, t, 300, [
        { ms: 0, gain: 0 },
        { ms: 16, gain: 0.14 },
        { ms: 300, gain: 0 },
      ]);
      scheduleNoiseLayer(ctx, masterGain, 'lowpass', 460, 0.707, t, [
        { ms: 0, gain: 0 },
        { ms: 30, gain: 0.24 },
        { ms: 160, gain: 0.1 },
        { ms: 380, gain: 0 },
      ]);
      break;
  }
}
