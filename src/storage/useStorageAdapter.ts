import { useEffect, useRef } from 'react';

import { useAuth } from '../auth/GoogleAuthProvider';
import { GoogleDriveAdapter } from './GoogleDriveAdapter';

/**
 * Returns a stable GoogleDriveAdapter instance for the current user.
 * The adapter's access token is updated automatically when it changes after refresh.
 * Returns null when the user is not signed in.
 */
export function useStorageAdapter(): GoogleDriveAdapter | null {
  const { user, getValidToken } = useAuth();
  const adapterRef = useRef<GoogleDriveAdapter | null>(null);

  // Create the adapter once when user first signs in
  if (user && !adapterRef.current) {
    adapterRef.current = new GoogleDriveAdapter({
      userSub: user.sub,
      userEmail: user.email,
      userName: user.name,
      accessToken: user.accessToken,
      getValidToken,
    });
  }

  // Clear adapter on sign out
  if (!user) {
    adapterRef.current = null;
  }

  // Keep token fresh after refreshes
  useEffect(() => {
    if (user && adapterRef.current) {
      adapterRef.current.updateAccessToken(user.accessToken);
    }
  }, [user?.accessToken]);

  return adapterRef.current;
}
