import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';

/** Upper bound for a push animation, in case the stack never reports its end (web, animation off). */
const FALLBACK_MS = 600;

/** False while this screen's push animation is running, true once it has finished. */
export function useTransitionSettled(): boolean {
  const navigation = useNavigation();
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (settled) return;
    const done = () => setSettled(true);
    const timer = setTimeout(done, FALLBACK_MS);
    // Native stack event; other navigators simply never fire it and the timer settles the screen.
    const off = (navigation as { addListener: (e: 'transitionEnd', cb: () => void) => () => void }).addListener('transitionEnd', done);
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [navigation, settled]);
  return settled;
}

/**
 * `value` as it was on the first frame until the push animation ends, then the live value.
 * Whatever is cached still draws immediately; data that lands mid-slide waits for the slide to
 * finish, so the screen doesn't remount a list while it is moving.
 */
export function useHeldDuringTransition<T>(value: T): T {
  const settled = useTransitionSettled();
  const [initial] = useState(value);
  return settled ? value : initial;
}
