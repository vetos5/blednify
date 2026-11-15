import { Platform } from 'react-native';

/**
 * Label for a control whose visible text is the title, artist and so on.
 *
 * On web the control's name comes from that text, so voice control ("click Lurk") matches what is on screen
 * (WCAG 2.5.3); a label such as "Lurk by Artist" is not the visible "Lurk Artist" and breaks it.
 * Native keeps the descriptive label.
 */
export function spokenLabel(label: string): string | undefined {
  return Platform.OS === 'web' ? undefined : label;
}
