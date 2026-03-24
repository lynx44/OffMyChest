import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ConversationScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.placeholder}>Conversation {threadId}</Text>
      <Text style={styles.hint}>Messages will appear here in Slice 4.</Text>

      <TouchableOpacity
        style={styles.recordButton}
        onPress={() => router.push(`/(app)/conversations/${threadId}/record`)}
      >
        <Text style={styles.recordButtonText}>Record Message</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  placeholder: { fontSize: 18, fontWeight: '600', color: '#aaa' },
  hint: { fontSize: 14, color: '#bbb' },
  recordButton: {
    marginTop: 24,
    backgroundColor: '#FF3B30',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 40,
  },
  recordButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
