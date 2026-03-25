import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../../src/auth/GoogleAuthProvider';
import { addContact, resolveContactEmail } from '../../../src/contacts/contactStore';

export default function ScanScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission is required to scan QR codes.</Text>
        <Button title="Grant Permission" onPress={requestPermission} />
      </View>
    );
  }

  async function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned || !user) return;
    setScanned(true);

    try {
      const url = new URL(data);
      if (url.protocol !== 'offmychest:' || url.hostname !== 'add-friend') {
        throw new Error('Not a valid Off My Chest QR code');
      }

      const outboxUrl = url.searchParams.get('outbox');
      const name = url.searchParams.get('name');

      if (!outboxUrl || !name) throw new Error('Missing outbox or name');

      await addContact(user.sub, {
        name,
        email: `pending:${outboxUrl}`,
        outbox_url: outboxUrl,
        added_at: new Date().toISOString(),
        last_seen_updated_at: null,
      });

      // Resolve real email in background — don't block navigation
      resolveContactEmail(user.sub, outboxUrl);

      setScanned(false);
      router.replace('/(app)/contacts');
    } catch (err) {
      console.error('QR scan error:', err);
      setScanned(false);
    }
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />
      {scanned && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>Scanned! Adding contact...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  text: { fontSize: 16, textAlign: 'center', padding: 24 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: { color: '#fff', fontSize: 18, fontWeight: '600' },
});
