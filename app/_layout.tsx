import { Linking } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import React, { useEffect, useRef } from 'react';

import { GoogleAuthProvider, useAuth } from '../src/auth/GoogleAuthProvider';
import { initializeOutbox } from '../src/outbox/outboxService';
import { getIncompleteDrafts, clearDraft } from '../src/recording/draftStore';

function AuthGate() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const initDone = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)');
    } else if (user && inAuthGroup) {
      router.replace('/(app)/conversations');
    }
  }, [user, isLoading, segments]);

  // Initialize Drive folder + check for orphaned drafts on first authenticated load
  useEffect(() => {
    if (!user || initDone.current) return;
    initDone.current = true;

    initializeOutbox(user).catch((err) => {
      console.error('Failed to initialize Drive folder:', err);
    });

    checkForOrphanedDrafts();
  }, [user]);

  // Handle deep links for joining conversations: offmychest://join?conv=...
  useEffect(() => {
    if (!user) return;

    function handleUrl(url: string) {
      try {
        const parsed = new URL(url);
        if (parsed.hostname === 'join') {
          const conv = parsed.searchParams.get('conv');
          const outbox = parsed.searchParams.get('outbox');
          const name = parsed.searchParams.get('name');
          const fromName = parsed.searchParams.get('fromName');
          const fromEmail = parsed.searchParams.get('fromEmail');
          if (conv && outbox) {
            const query = new URLSearchParams({ conv, outbox });
            if (name) query.set('name', name);
            if (fromName) query.set('fromName', fromName);
            if (fromEmail) query.set('fromEmail', fromEmail);
            router.push(`/(app)/conversations/join?${query.toString()}`);
          }
        }
      } catch {}
    }

    // Handle URL that opened the app
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Handle URLs while app is open
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [user, router]);

  async function checkForOrphanedDrafts() {
    try {
      const drafts = await getIncompleteDrafts();
      if (drafts.length === 0) return;
      await Promise.all(drafts.map((d) => clearDraft(d.message_id)));
    } catch (err) {
      console.error('Draft check failed:', err);
    }
  }

  return <Slot />;
}

export default function RootLayout() {
  return (
    <GoogleAuthProvider>
      <AuthGate />
    </GoogleAuthProvider>
  );
}
