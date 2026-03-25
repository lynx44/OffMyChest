import * as SecureStore from 'expo-secure-store';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { GOOGLE_CLIENT_IDS, GOOGLE_SCOPES, SECURE_KEYS } from '../shared/constants';
import { AuthError } from '../shared/errors';
import { User } from '../shared/types';

GoogleSignin.configure({
  webClientId: GOOGLE_CLIENT_IDS.web,
  iosClientId: GOOGLE_CLIENT_IDS.ios,
  scopes: GOOGLE_SCOPES.filter(s => s !== 'openid' && s !== 'email' && s !== 'profile'),
  offlineAccess: true,
});

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getValidToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function GoogleAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    restoreSession().finally(() => setIsLoading(false));
  }, []);

  async function restoreSession(): Promise<void> {
    try {
      await GoogleSignin.signInSilently();
      const tokens = await GoogleSignin.getTokens();
      const currentUser = GoogleSignin.getCurrentUser();
      if (!currentUser || !tokens.accessToken) return;
      const u = buildUser(currentUser.user, tokens.accessToken);
      await persistUser(u);
      setUser(u);
    } catch {
      // Not previously signed in — OK
    }
  }

  // ---------------------------------------------------------------------------
  // Sign in / out
  // ---------------------------------------------------------------------------

  const signIn = useCallback(async () => {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const userInfo = await GoogleSignin.signIn();
      const tokens = await GoogleSignin.getTokens();

      if (!tokens.accessToken) throw new AuthError('No access token returned');

      const u = buildUser(userInfo.data!.user, tokens.accessToken);
      await persistUser(u);
      setUser(u);
    } catch (error: any) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) return;
      if (error.code === statusCodes.IN_PROGRESS) return;
      throw new AuthError(`Sign in failed: ${error.message}`);
    }
  }, []);

  const signOut = useCallback(async () => {
    await GoogleSignin.signOut();
    await Promise.all(
      Object.values(SECURE_KEYS).map((key) => SecureStore.deleteItemAsync(key)),
    );
    setUser(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Token refresh
  // ---------------------------------------------------------------------------

  const getValidToken = useCallback(async (): Promise<string> => {
    if (!user) throw new AuthError('Not authenticated');

    if (user.tokenExpiry - Date.now() > 5 * 60 * 1000) {
      return user.accessToken;
    }

    // Native SDK handles refresh automatically
    const tokens = await GoogleSignin.getTokens();
    const newExpiry = Date.now() + 3600 * 1000;
    const updatedUser: User = { ...user, accessToken: tokens.accessToken, tokenExpiry: newExpiry };
    await persistUser(updatedUser);
    setUser(updatedUser);
    return tokens.accessToken;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut, getValidToken }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within GoogleAuthProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUser(
  googleUser: { id: string; email: string; name: string | null },
  accessToken: string,
): User {
  return {
    sub: googleUser.id,
    email: googleUser.email,
    name: googleUser.name ?? googleUser.email,
    accessToken,
    refreshToken: null, // managed natively
    tokenExpiry: Date.now() + 3600 * 1000,
  };
}

async function persistUser(u: User): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SECURE_KEYS.userSub, u.sub),
    SecureStore.setItemAsync(SECURE_KEYS.userEmail, u.email),
    SecureStore.setItemAsync(SECURE_KEYS.userName, u.name),
    SecureStore.setItemAsync(SECURE_KEYS.accessToken, u.accessToken),
    SecureStore.setItemAsync(SECURE_KEYS.tokenExpiry, String(u.tokenExpiry)),
  ]);
}
