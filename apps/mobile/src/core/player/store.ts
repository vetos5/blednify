import { create, useStore } from 'zustand';

import type { PlayerState } from '../types';
import { playButtonLabel, playButtonMode, type PlayButtonMode } from './stall';

export const playerStore = create<PlayerState>(() => ({
  queue: [],
  index: -1,
  current: null,
  isPlaying: false,
  isBuffering: false,
  retrying: false,
  repeat: 'off',
  shuffle: false,
  error: null,
  errorId: 0,
}));

/** What the play button shows and says (`playButtonMode`): steady through a whole network retry. */
export function usePlayButton(): { mode: PlayButtonMode; label: string } {
  const mode = useStore(playerStore, playButtonMode);
  const retrying = useStore(playerStore, (s) => s.retrying);
  return { mode, label: playButtonLabel(mode, retrying) };
}

type Progress = { positionMs: number; durationMs: number };

/** Kept apart from `playerStore` so 4 Hz position updates only re-render progress UI. */
export const progressStore = create<Progress>(() => ({ positionMs: 0, durationMs: 0 }));

export function usePlayer<T>(selector: (s: PlayerState) => T): T {
  return useStore(playerStore, selector);
}

export function useProgress(): Progress {
  const positionMs = useStore(progressStore, (s) => s.positionMs);
  const durationMs = useStore(progressStore, (s) => s.durationMs);
  return { positionMs, durationMs };
}

/** Whole seconds played and the duration, for time labels: re-renders once a second instead of on every tick. */
export function useProgressSeconds(): { positionSec: number; durationMs: number } {
  const positionSec = useStore(progressStore, (s) => Math.floor(s.positionMs / 1000));
  const durationMs = useStore(progressStore, (s) => s.durationMs);
  return { positionSec, durationMs };
}

/** Calls `fn` now and on every progress tick, outside React. For driving animated values without re-renders. */
export function onProgress(fn: (p: Progress) => void): () => void {
  fn(progressStore.getState());
  return progressStore.subscribe(fn);
}
