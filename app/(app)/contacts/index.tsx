/**
 * The contacts screen has been replaced by conversation-based invites.
 * This screen is hidden from the tab bar but the route is kept to avoid 404s.
 */
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';

export default function ContactsScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/(app)/conversations');
  }, [router]);
  return <View />;
}
