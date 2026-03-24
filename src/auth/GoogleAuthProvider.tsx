import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { type TokenResponse, makeRedirectUri } from 'expo-auth-session';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { GOOGLE_CLIENT_IDS, GOOGLE_SCOPES, SECURE_KEYS } from '../shared/constants';
import { AuthError } from '../shared/errors';
import { User } from '../shared/types';

// Required by expo-auth-session on Android
WebBrowser.maybeCompleteAuthSession();

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

  // Expo auth proxy — required for Google OAuth in Expo Go.
  // For production dev builds, replace with: makeRedirectUri() which uses offmychest://
  const redirectUri = 'https://auth.expo.io/@mclifton/offmychest';

  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: GOOGLE_CLIENT_IDS.android,
    webClientId: GOOGLE_CLIENT_IDS.web,
    scopes: GOOGLE_SCOPES,
    redirectUri,
  });

  // ---------------------------------------------------------------------------
  // Restore session on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    restoreSession().finally(() => setIsLoading(false));
  }, []);

  async function restoreSession(): Promise<void> {
    try {
      const [sub, email, name, accessToken, refreshToken, expiryStr] = await Promise.all([
        SecureStore.getItemAsync(SECURE_KEYS.userSub),
        SecureStore.getItemAsync(SECURE_KEYS.userEmail),
        SecureStore.getItemAsync(SECURE_KEYS.userName),
        SecureStore.getItemAsync(SECURE_KEYS.accessToken),
        SecureStore.getItemAsync(SECURE_KEYS.refreshToken),
        SecureStore.getItemAsync(SECURE_KEYS.tokenExpiry),
      ]);

      if (!sub || !email || !name || !accessToken) return;

      const tokenExpiry = expiryStr ? parseInt(expiryStr, 10) : 0;
      setUser({ sub, email, name, accessToken, refreshToken, tokenExpiry });
    } catch {
      // SecureStore error — treat as not logged in
    }
  }

  // ---------------------------------------------------------------------------
  // Handle OAuth response
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (response?.type !== 'success') return;
    handleAuthSuccess(response.authentication).catch(console.error);
  }, [response]);

  async function handleAuthSuccess(auth: TokenResponse | null): Promise<void> {
    if (!auth?.accessToken) throw new AuthError('No access token in response');

    // Decode the ID token to get user profile (it's a JWT — decode the payload)
    let sub = '';
    let email = '';
    let name = '';

    if (auth.idToken) {
      try {
        const payload = JSON.parse(atob(auth.idToken.split('.')[1]));
        sub = payload.sub ?? '';
        email = payload.email ?? '';
        name = payload.name ?? '';
      } catch {
        // Fall back to fetching profile
      }
    }

    // If JWT decode failed, fetch profile from Google
    if (!sub) {
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const profile = await profileRes.json();
      sub = profile.sub;
      email = profile.email;
      name = profile.name;
    }

    const tokenExpiry = Date.now() + (auth.expiresIn ?? 3600) * 1000;

    await persistTokens({ sub, email, name, accessToken: auth.accessToken, refreshToken: auth.refreshToken ?? null, tokenExpiry });

    setUser({ sub, email, name, accessToken: auth.accessToken, refreshToken: auth.refreshToken ?? null, tokenExpiry });
  }

  async function persistTokens(u: User): Promise<void> {
    await Promise.all([
      SecureStore.setItemAsync(SECURE_KEYS.userSub, u.sub),
      SecureStore.setItemAsync(SECURE_KEYS.userEmail, u.email),
      SecureStore.setItemAsync(SECURE_KEYS.userName, u.name),
      SecureStore.setItemAsync(SECURE_KEYS.accessToken, u.accessToken),
      SecureStore.setItemAsync(SECURE_KEYS.refreshToken, u.refreshToken ?? ''),
      SecureStore.setItemAsync(SECURE_KEYS.tokenExpiry, String(u.tokenExpiry)),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Sign in / out
  // ---------------------------------------------------------------------------

  const signIn = useCallback(async () => {
    await promptAsync();
  }, [promptAsync]);

  const signOut = useCallback(async () => {
    await Promise.all(
      Object.values(SECURE_KEYS).map((key) => SecureStore.deleteItemAsync(key)),
    );
    setUser(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Token refresh
  // ---------------------------------------------------------------------------

  /**
   * Returns a valid access token, refreshing if needed.
   * All Drive API calls should use this instead of user.accessToken directly.
   */
  const getValidToken = useCallback(async (): Promise<string> => {
    if (!user) throw new AuthError('Not authenticated');

    // Refresh if expiring within 5 minutes
    if (user.tokenExpiry - Date.now() > 5 * 60 * 1000) {
      return user.accessToken;
    }

    if (!user.refreshToken || !request) {
      throw new AuthError('Token expired and no refresh token available — sign in again');
    }

    // expo-auth-session doesn't expose a standalone refreshAsync in all versions;
    // we do a manual refresh using the token endpoint.
    const tokenEndpoint = 'https://oauth2.googleapis.com/token';
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_IDS.web,
        grant_type: 'refresh_token',
        refresh_token: user.refreshToken,
      }).toString(),
    });

    if (!res.ok) {
      throw new AuthError('Token refresh failed — sign in again');
    }

    const data = await res.json();
    const newToken: string = data.access_token;
    const newExpiry = Date.now() + (data.expires_in ?? 3600) * 1000;

    const updatedUser: User = { ...user, accessToken: newToken, tokenExpiry: newExpiry };
    await persistTokens(updatedUser);
    setUser(updatedUser);

    return newToken;
  }, [user, request]);

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
