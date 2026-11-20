import { useConnection, type Unreachable } from '@/core';

import { nav } from '../nav';
import { EmptyState } from './EmptyState';
import { PrimaryButton } from './PrimaryButton';

/**
 * Server content that couldn't load. A refused token is not "server down": Try again can't fix it, the
 * connection settings can.
 */
export function ServerUnreachable({ reason, message, retry }: { reason: Exclude<Unreachable, false>; message: string; retry: () => void }) {
  const { phoneOffline } = useConnection();
  if (reason === 'refused')
    return (
      <EmptyState icon="key-outline" title="Your server didn’t accept the access token" message="Check the access token in Settings. Downloaded songs still play.">
        <PrimaryButton label="Open Settings" icon="settings-outline" variant="surface" onPress={nav.settings} />
      </EmptyState>
    );
  return (
    <EmptyState icon="cloud-offline-outline" title={phoneOffline ? 'You’re offline' : 'Can’t reach your server'} message={message}>
      <PrimaryButton label="Try again" icon="refresh" variant="surface" onPress={retry} />
    </EmptyState>
  );
}
