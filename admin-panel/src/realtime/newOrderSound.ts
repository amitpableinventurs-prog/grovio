import { useSyncExternalStore } from 'react';

// "New order" chime for the Live Orders board — generated with Web Audio so there's no sound file
// to ship. Browsers only allow audio after the user has interacted with the page, which an admin
// working the panel always has; if not, the chime is silently skipped.
const STORAGE_KEY = 'grovio_admin_order_sound';

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let enabled = readEnabled();
const listeners = new Set<() => void>();

export function setOrderSoundEnabled(value: boolean) {
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // Storage unavailable — the choice just won't survive a reload.
  }
  listeners.forEach((l) => l());
  if (value) playNewOrderSound();
}

export function useOrderSoundEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => enabled,
  );
}

let audioCtx: AudioContext | null = null;

export function playNewOrderSound() {
  if (!enabled) return;
  try {
    audioCtx ??= new AudioContext();
    const start = audioCtx.currentTime;
    // Two rising tones, like a shop-door bell.
    [880, 1318.5].forEach((freq, i) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = start + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    // Web Audio unavailable — the toast and the board still show the order.
  }
}
