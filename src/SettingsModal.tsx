import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DEFAULT_MODEL, type Settings } from './settings';
import { colors } from './theme';

type Props = {
  visible: boolean;
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  onClearChat: () => void;
};

export function SettingsModal({ visible, settings, onSave, onClose, onClearChat }: Props) {
  const [draft, setDraft] = useState(settings);

  // 開くたびに保存済みの値へ戻す
  useEffect(() => {
    if (visible) setDraft(settings);
  }, [visible, settings]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>設定</Text>

          <Text style={styles.label}>Gemini API キー</Text>
          <TextInput
            style={styles.input}
            value={draft.apiKey}
            onChangeText={(apiKey) => setDraft({ ...draft, apiKey })}
            placeholder="Google AI Studio で発行したキー"
            placeholderTextColor={colors.muted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>キーはこの端末のアプリ専用の領域にだけ保存され、APKには含まれません。</Text>

          <Text style={styles.label}>モデル名</Text>
          <TextInput
            style={styles.input}
            value={draft.model}
            onChangeText={(model) => setDraft({ ...draft, model })}
            placeholder={DEFAULT_MODEL}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>返答を読み上げる</Text>
            </View>
            <Switch
              value={draft.speak}
              onValueChange={(speak) => setDraft({ ...draft, speak })}
              trackColor={{ true: colors.teal, false: colors.line }}
            />
          </View>

          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>ハンズフリー会話</Text>
              <Text style={styles.hint}>読み上げが終わると自動でもう一度聞き取ります。</Text>
            </View>
            <Switch
              value={draft.handsFree}
              onValueChange={(handsFree) => setDraft({ ...draft, handsFree })}
              trackColor={{ true: colors.teal, false: colors.line }}
            />
          </View>

          <Pressable style={styles.secondary} onPress={() => { onClearChat(); onClose(); }}>
            <Text style={styles.secondaryText}>会話履歴を消す</Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable style={[styles.secondary, styles.inline]} onPress={onClose}>
              <Text style={styles.secondaryText}>キャンセル</Text>
            </Pressable>
            <Pressable
              style={styles.primary}
              onPress={() => onSave({ ...draft, model: draft.model.trim() || DEFAULT_MODEL })}
            >
              <Text style={styles.primaryText}>保存</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 24, paddingTop: 56, gap: 8 },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink, marginTop: 12 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
  },
  hint: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  rowTitle: { fontSize: 16, color: colors.ink },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  primary: {
    flex: 1,
    backgroundColor: colors.teal,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  secondaryText: { color: colors.ink, fontSize: 16 },
  inline: { marginTop: 0 },
});
