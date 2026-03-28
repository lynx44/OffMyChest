import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getNotes, saveNotes, pushClearHistory, popClearHistory, getClearHistoryCount } from './notesStore';

interface Props {
  threadId: string;
  visible: boolean;
  onToggle: () => void;
}

export function NotesOverlay({ threadId, visible, onToggle }: Props) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.all([getNotes(threadId), getClearHistoryCount(threadId)]).then(([notes, count]) => {
      setText(notes);
      setUndoCount(count);
      setLoaded(true);
    });
  }, [threadId]);

  // Auto-save with debounce
  const handleChange = useCallback(
    (value: string) => {
      setText(value);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveNotes(threadId, value);
      }, 500);
    },
    [threadId],
  );

  // Save immediately on blur
  const handleBlur = useCallback(() => {
    setEditing(false);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveNotes(threadId, text);
  }, [threadId, text]);

  const handleEdit = useCallback(() => {
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleDone = useCallback(() => {
    Keyboard.dismiss();
    setEditing(false);
    saveNotes(threadId, text);
  }, [threadId, text]);

  const handleClear = useCallback(async () => {
    await pushClearHistory(threadId, text);
    setUndoCount((n) => Math.min(n + 1, 3));
    setText('');
    saveNotes(threadId, '');
    setEditing(false);
  }, [threadId, text]);

  const handleUndo = useCallback(async () => {
    const restored = await popClearHistory(threadId);
    if (restored === null) return;
    setText(restored);
    await saveNotes(threadId, restored);
    setUndoCount((n) => Math.max(n - 1, 0));
  }, [threadId]);

  if (!visible || !loaded) return null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      pointerEvents="box-none"
    >
      <View style={styles.overlay} pointerEvents="box-none">
        {editing ? (
          <View style={styles.editContainer}>
            <View style={styles.editHeader}>
              <Text style={styles.title}>Notes</Text>
              <View style={styles.editActions}>
                {undoCount > 0 && (
                  <TouchableOpacity onPress={handleUndo} style={styles.undoBtn}>
                    <Text style={styles.undoText}>Undo{undoCount > 1 ? ` (${undoCount})` : ''}</Text>
                  </TouchableOpacity>
                )}
                {text.length > 0 && (
                  <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
                    <Text style={styles.clearText}>Clear</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={handleDone} style={styles.doneBtn}>
                  <Text style={styles.doneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={text}
              onChangeText={handleChange}
              onBlur={handleBlur}
              multiline
              placeholder="Add notes for this conversation..."
              placeholderTextColor="rgba(255,255,255,0.4)"
              textAlignVertical="top"
              autoFocus
            />
          </View>
        ) : (
          <View style={styles.displayContainer}>
            <TouchableOpacity onPress={handleEdit} activeOpacity={0.8} style={styles.displayTouchable}>
              {text.trim() ? (
                <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
                  <Text style={styles.noteText}>{text}</Text>
                </ScrollView>
              ) : (
                <Text style={styles.placeholderText}>Tap to add notes...</Text>
              )}
            </TouchableOpacity>
            {undoCount > 0 && (
              <TouchableOpacity onPress={handleUndo} style={styles.undoBtnDisplay}>
                <Text style={styles.undoText}>↩ Undo clear{undoCount > 1 ? ` (${undoCount})` : ''}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Toggle button to show/hide notes — place in the top bar */
export function NotesToggleButton({
  visible,
  onToggle,
  hasNotes,
}: {
  visible: boolean;
  onToggle: () => void;
  hasNotes: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={[styles.toggleBtn, visible && styles.toggleBtnActive]}
    >
      <Text style={styles.toggleText}>
        {hasNotes ? '📝' : '📝'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    left: 16,
    right: 16,
    bottom: 120,
    zIndex: 20,
  },
  overlay: {
    flex: 1,
  },
  displayContainer: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    overflow: 'hidden',
    maxHeight: '60%',
  },
  displayTouchable: {
    padding: 16,
  },
  scrollView: {
    maxHeight: 200,
  },
  noteText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
  },
  placeholderText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    fontStyle: 'italic',
  },
  editContainer: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 12,
    padding: 16,
    maxHeight: '80%',
  },
  editHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editActions: {
    flexDirection: 'row',
    gap: 12,
  },
  undoBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  undoBtnDisplay: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  undoText: {
    color: '#FFD60A',
    fontSize: 14,
    fontWeight: '600',
  },
  clearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '600',
  },
  doneBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  doneText: {
    color: '#4CD964',
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    color: '#fff',
    fontSize: 16,
    lineHeight: 22,
    minHeight: 100,
    maxHeight: 250,
  },
  toggleBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  toggleText: {
    fontSize: 14,
  },
});
