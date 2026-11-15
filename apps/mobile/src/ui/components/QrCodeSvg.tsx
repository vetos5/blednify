import QRCode from 'qrcode';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/** Payloads above this make modules too small to scan off a phone screen. */
export const QR_MAX_LENGTH = 1200;

/**
 * QR code drawn as one SVG path. Always dark modules on white with a quiet zone: scanners expect that
 * contrast, so it ignores the app theme on purpose.
 */
export function QrCode({ value, size }: { value: string; size: number }) {
  const { d, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: value.length > 400 ? 'L' : 'M' });
    const n = qr.modules.size;
    let path = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        // Merge horizontal runs into one rect each to keep the path short.
        if (!qr.modules.get(y, x)) continue;
        let w = 1;
        while (x + w < n && qr.modules.get(y, x + w)) w++;
        path += `M${x + QUIET} ${y + QUIET}h${w}v1h-${w}z`;
        x += w - 1;
      }
    }
    return { d: path, count: n + QUIET * 2 };
  }, [value]);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} accessibilityLabel="QR code">
      <Rect width={count} height={count} fill="#FFFFFF" />
      <Path d={d} fill="#0A0A0C" />
    </Svg>
  );
}

const QUIET = 2;
