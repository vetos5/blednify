import { useEffect } from 'react';

import { player, progressStore, setVolume, toggleLike, toggleMute, volumeStore } from '@/core';
import { libIndex } from '@/core/lib-index';
import { playerStore } from '@/core/player/store';

import { attempt } from '../actions';
import { nav } from '../nav';
import { closeSheet, useOverlay } from '../overlay';
import { closeNowPlaying, toggleNowPlaying } from './now-playing';
import { deskStore, requestSearchFocus, setPanel, setShortcutsOpen, togglePanel } from './store';

export type Shortcut = { keys: string; label: string };

/** Shown in the "?" overview; keep in sync with `handle` below. */
export const SHORTCUTS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Playback',
    items: [
      { keys: 'Space', label: 'Play / pause' },
      { keys: 'Shift →', label: 'Next song' },
      { keys: 'Shift ←', label: 'Previous song' },
      { keys: '→  ←', label: 'Seek 5 seconds' },
      { keys: '↑  ↓', label: 'Volume' },
      { keys: 'M', label: 'Mute' },
      { keys: 'S', label: 'Shuffle' },
      { keys: 'R', label: 'Repeat' },
      { keys: 'L', label: 'Like the current song' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: 'Ctrl K', label: 'Search' },
      { keys: 'Q', label: 'Queue panel' },
      { keys: 'Y', label: 'Lyrics panel' },
      { keys: 'F', label: 'Now playing view' },
      { keys: 'Esc', label: 'Close menu, panel or view' },
      { keys: '?', label: 'This list' },
    ],
  },
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** A focused slider (volume, seek bar) uses the arrow keys itself. */
function isSlider(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el?.getAttribute && (el.getAttribute('role') === 'slider' || el.hasAttribute('aria-valuenow'));
}

function seekBy(deltaMs: number) {
  const { positionMs, durationMs } = progressStore.getState();
  if (!playerStore.getState().current || durationMs <= 0) return;
  player.seekTo(Math.max(0, Math.min(durationMs - 500, positionMs + deltaMs)));
}

function handle(e: KeyboardEvent): boolean {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && !e.altKey && e.key.toLowerCase() === 'k') {
    nav.tab('search');
    requestSearchFocus();
    return true;
  }

  if (e.key === 'Escape') {
    if (useOverlay.getState().sheet) closeSheet();
    else if (deskStore.getState().shortcuts) setShortcutsOpen(false);
    else if (typeof window !== 'undefined' && window.location.pathname === '/player') closeNowPlaying();
    else if (deskStore.getState().panel) setPanel(null);
    else return false;
    return true;
  }

  if (isTyping(e.target) || mod || e.altKey) return false;
  // A menu or dialog owns the keyboard while open.
  if (useOverlay.getState().sheet) return false;

  const hasTrack = !!playerStore.getState().current;
  if (e.key.startsWith('Arrow') && isSlider(e.target)) return false;
  switch (e.key) {
    case ' ':
      // Space on a focused button would also press it; the shortcut wins.
      if (hasTrack) player.togglePlay();
      return true;
    case 'ArrowRight':
      if (e.shiftKey) player.next();
      else seekBy(5000);
      return hasTrack;
    case 'ArrowLeft':
      if (e.shiftKey) player.previous();
      else seekBy(-5000);
      return hasTrack;
    case 'ArrowUp':
    case 'ArrowDown': {
      const { volume, muted } = volumeStore.getState();
      const base = muted ? 0 : volume;
      setVolume(base + (e.key === 'ArrowUp' ? 0.05 : -0.05));
      return true;
    }
    case '/':
      nav.tab('search');
      requestSearchFocus();
      return true;
    case '?':
      setShortcutsOpen(!deskStore.getState().shortcuts);
      return true;
  }
  if (e.shiftKey) return false;
  switch (e.key.toLowerCase()) {
    case 'm':
      toggleMute();
      return true;
    case 's':
      if (hasTrack) player.toggleShuffle();
      return true;
    case 'r':
      if (hasTrack) player.cycleRepeat();
      return true;
    case 'l': {
      const track = playerStore.getState().current;
      if (track) {
        const was = libIndex.getState().liked.has(track.key);
        void attempt(toggleLike(track), was ? `Removed “${track.title}” from Liked` : `Liked “${track.title}”`);
      }
      return true;
    }
    case 'q':
      togglePanel('queue');
      return true;
    case 'y':
      togglePanel('lyrics');
      return true;
    case 'f':
      toggleNowPlaying();
      return true;
  }
  return false;
}

/** Desktop keyboard shortcuts (wide layout only). */
export function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.repeat && e.key === ' ')) return;
      if (!handle(e)) return;
      e.preventDefault();
      // Keyboard use makes Chrome draw a focus ring on whatever was last clicked; a shortcut isn't aimed at it.
      // Focus a keyboard user moved there on purpose (:focus-visible) stays, so Tab navigation isn't lost.
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && !isTyping(active) && !active.matches(':focus-visible')) active.blur();
    };
    // Capture: runs before a focused button turns Space into a click.
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [enabled]);
}
