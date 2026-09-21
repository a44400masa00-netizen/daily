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

import {
  deleteLocalModel,
  getLocalModelStatus,
  startLocalModelDownload,
  type LocalModelStatus,
} from '../modules/daily-native';
import { DEFAULT_MODEL, type Settings } from './settings';
import { colors } from './theme';

const BRAINS: { key: Settings['brain']; label: string }[] = [
  { key: 'auto', label: '自動' },
  { key: 'cloud', label: 'Geminiのみ' },
  { key: 'device', label: '端末内のみ' },
];

const BRAIN_HINT: Record<Settings['brain'], string> = {
  auto: 'まず Gemini で答えます。回数制限・混雑・通信なしで使えないときは、端末内AIが代わりに答えます。',
  cloud: 'Gemini だけを使います。',
  device: '端末内AIだけを使います。通信がなくても動きます（返事の質は Gemini より下がります）。',
};

const gb = (bytes: number) => (bytes / 1e9).toFixed(2);

/** 端末内AIモデルのダウンロード状況を、開いている間だけ定期的に読み直す */
function useLocalModelStatus(active: boolean): LocalModelStatus {
  const [status, setStatus] = useState<LocalModelStatus>(() => getLocalModelStatus());
  useEffect(() => {
    if (!active) return;
    setStatus(getLocalModelStatus());
    const timer = setInterval(() => setStatus(getLocalModelStatus()), 1500);
    return () => clearInterval(timer);
  }, [active]);
  return status;
}

type Props = {
  visible: boolean;
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  onClearChat: () => void;
};

export function SettingsModal({ visible, settings, onSave, onClose, onClearChat }: Props) {
  const [draft, setDraft] = useState(settings);
  const model = useLocalModelStatus(visible);

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

          <Text style={styles.label}>AIの頭脳</Text>
          <View style={styles.segment}>
            {BRAINS.map((b) => {
              const on = draft.brain === b.key;
              return (
                <Pressable
                  key={b.key}
                  style={[styles.segItem, on && styles.segItemOn]}
                  onPress={() => setDraft({ ...draft, brain: b.key })}
                >
                  <Text style={[styles.segText, on && styles.segTextOn]}>{b.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>{BRAIN_HINT[draft.brain]}</Text>

          <Text style={styles.label}>端末内AI（Gemma 4 E2B・約2.5GB）</Text>
          <Text style={styles.hint}>
            {model.state === 'ready'
              ? '準備完了。オフラインでも答えられます。'
              : model.state === 'downloading'
                ? `ダウンロード中… ${gb(model.downloaded)} / ${model.total > 0 ? gb(model.total) : '?'} GB（Wi-Fi に接続している間だけ進みます）`
                : model.state === 'failed'
                  ? 'ダウンロードに失敗しました。もう一度お試しください。'
                  : '未ダウンロード。Wi-Fi で約2.5GBをダウンロードします（空き容量3GB以上を目安に）。'}
          </Text>
          {model.state === 'ready' || model.state === 'downloading' ? (
            <Pressable style={[styles.secondary, styles.gapTop]} onPress={deleteLocalModel}>
              <Text style={styles.secondaryText}>{model.state === 'ready' ? '端末内AIを削除' : 'ダウンロードを中止'}</Text>
            </Pressable>
          ) : (
            <Pressable style={[styles.primary, styles.modelButton]} onPress={startLocalModelDownload}>
              <Text style={styles.primaryText}>ダウンロード（Wi-Fi）</Text>
            </Pressable>
          )}

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
  gapTop: { marginTop: 8 },
  modelButton: { flex: 0, marginTop: 8 },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  segItem: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  segItemOn: { backgroundColor: colors.teal },
  segText: { fontSize: 14, color: colors.ink },
  segTextOn: { color: '#fff', fontWeight: '700' },
});
