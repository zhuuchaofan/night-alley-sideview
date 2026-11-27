import { getSoundState, setSoundMuted } from './sound.ts';

let audio: HTMLAudioElement | null = null;
let bgmStarted = false;
let toggleBound = false;

export function startBgm(): void {
  if (!audio) {
    audio = new Audio('./audio/night-alley-bgm.mp3');
    audio.loop = true;
    audio.volume = 0.5;
  }
  audio.muted = getSoundState().soundMuted;
  audio
    .play()
    .then(() => {
      bgmStarted = true;
    })
    .catch(() => {});
}

export function isBgmStarted(): boolean {
  return bgmStarted;
}

export function syncSoundToggleUi(): void {
  const btn = document.getElementById('sound-toggle') as HTMLButtonElement | null;
  if (btn) {
    btn.setAttribute('aria-pressed', String(getSoundState().soundMuted));
  }
}

export function toggleMute(): void {
  const nextMuted = !getSoundState().soundMuted;
  setSoundMuted(nextMuted);
  if (audio) {
    audio.muted = nextMuted;
  }
  syncSoundToggleUi();
}

export function bindSoundToggle(): void {
  const btn = document.getElementById('sound-toggle') as HTMLButtonElement | null;
  if (!btn) {
    return;
  }
  btn.hidden = false;
  syncSoundToggleUi();
  if (toggleBound) {
    return;
  }
  toggleBound = true;
  btn.addEventListener('click', () => {
    toggleMute();
    btn.blur();
  });
}
