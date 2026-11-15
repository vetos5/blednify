import { lazy, Suspense } from 'react';
import { View } from 'react-native';

/** Payloads above this make modules too small to scan off a phone screen. */
export const QR_MAX_LENGTH = 1200;

// The encoder is only needed when a share sheet shows a code; keep it out of the startup bundle.
const QrCodeSvg = lazy(() => import('./QrCodeSvg'));

/** QR code for `value`; a white square stands in while the encoder loads. */
export function QrCode({ value, size }: { value: string; size: number }) {
  return (
    <Suspense fallback={<View style={{ width: size, height: size, backgroundColor: '#FFFFFF' }} />}>
      <QrCodeSvg value={value} size={size} />
    </Suspense>
  );
}
