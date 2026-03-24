import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

interface Props {
  outboxUrl: string;
  displayName: string;
  size?: number;
}

/** Builds the deep link and renders a QR code the user can share. */
export function QRGenerator({ outboxUrl, displayName, size = 240 }: Props) {
  const deepLink =
    `offmychest://add-friend` +
    `?outbox=${encodeURIComponent(outboxUrl)}` +
    `&name=${encodeURIComponent(displayName)}`;

  return (
    <View style={styles.container}>
      <QRCode value={deepLink} size={size} />
      <Text style={styles.label}>{displayName}</Text>
      <Text style={styles.hint}>Scan to add me on Off My Chest</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 12,
    padding: 24,
  },
  label: {
    fontSize: 18,
    fontWeight: '600',
  },
  hint: {
    fontSize: 14,
    color: '#666',
  },
});
