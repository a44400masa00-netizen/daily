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
  getControlStatus,
  getLocalModelStatus,
  openControlSettings,
  startLocalModelDownload,
  type ControlStatus,
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

/** 選択肢を横に並べた切り替え */
function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable key={o.key} style={[styles.segItem, on && styles.segItemOn]} onPress={() => onChange(o.key)}>
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** スマホの操作に必要な許可の状態を、開いている間だけ定期的に読み直す */
function useControlStatus(active: boolean): ControlStatus {
  const [status, setStatus] = useState<ControlStatus>(() => getControlStatus());
  useEffect(() => {
    if (!active) return;
    setStatus(getControlStatus());
    const timer = setInterval(() => setStatus(getControlStatus()), 1500);
    return () => clearInterval(timer);
  }, [active]);
  return status;
}

function PermissionRow({ title, granted, onPress }: { title: string; granted: boolean; onPress?: () => void }) {
  return (
    <View style={styles.permRow}>
      <Text style={[styles.flexText, styles.rowTitle]}>{title}</Text>
      {granted ? (
        <Text style={styles.granted}>許可済み</Text>
      ) : (
        <Pressable style={styles.permButton} onPress={onPress}>
          <Text style={styles.permButtonText}>許可する</Text>
        </Pressable>
      )}
    </View>
  );
}

const ADB_COMMAND = 'adb shell pm grant com.example.daily android.permission.WRITE_SECURE_SETTINGS';

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
  const control = useControlStatus(visible);

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

          <Text style={styles.label}>私の呼び方</Text>
          <Segment
            options={[
              { key: 'masa', label: '「まさ」' },
              { key: 'you', label: '「あなた」' },
            ]}
            value={draft.callName}
            onChange={(callName) => setDraft({ ...draft, callName })}
          />

          <Text style={styles.label}>話し方</Text>
          <Segment
            options={[
              { key: 'polite', label: '敬語' },
              { key: 'casual', label: 'ため口' },
            ]}
            value={draft.tone}
            onChange={(tone) => setDraft({ ...draft, tone })}
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

          <Text style={styles.label}>スマホの操作（許可）</Text>
          <Text style={styles.hint}>
            「3分のタイマー」「7時にアラーム」「ライトをつけて」「音量を下げて」などは、追加の許可なしで使えます。
            次の操作には、それぞれ許可が必要です。
          </Text>
          <PermissionRow
            title="画面の明るさ（システム設定の変更）"
            granted={control.writeSettings}
            onPress={() => openControlSettings('writeSettings')}
          />
          <PermissionRow
            title="おやすみモード・マナーモード（通知ポリシー）"
            granted={control.notificationPolicy}
            onPress={() => openControlSettings('notificationPolicy')}
          />
          <PermissionRow
            title="正確な時刻のタイマー・アラーム"
            granted={control.exactAlarm}
            onPress={() => openControlSettings('exactAlarm')}
          />
          <View style={styles.permRow}>
            <Text style={[styles.flexText, styles.rowTitle]}>電力モード（バッテリーセーバー）</Text>
            {control.secureSettings ? <Text style={styles.granted}>許可済み</Text> : null}
          </View>
          {!control.secureSettings && (
            <Text style={styles.hint}>
              電力モードの切り替えだけは、パソコンからの一度きりの設定が必要です。スマホの「開発者向けオプション」で
              USBデバッグをオンにし、パソコンにつないで次のコマンドを実行してください。{'\n'}
              <Text selectable style={styles.code}>{ADB_COMMAND}</Text>
            </Text>
          )}
          <Text style={styles.hint}>
            Wi-Fi・Bluetooth・機内モードの切り替えと、アプリの起動は、Android の制限で直接はできません。
            その代わり「画面の通知をタップすると設定が開く」形で案内します。
          </Text>

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
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  flexText: { flex: 1 },
  granted: { fontSize: 13, color: colors.teal, fontWeight: '700' },
  permButton: { backgroundColor: colors.teal, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  permButtonText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  code: { fontFamily: 'monospace', fontSize: 12, color: colors.ink },
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
