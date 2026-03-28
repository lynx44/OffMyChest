/**
 * @deprecated QR-based contact scanning replaced by conversation invite links.
 */
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { View } from 'react-native';

export default function ScanScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/(app)/conversations');
  }, [router]);
  return <View />;
}
