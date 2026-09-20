import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { SettingsModal } from './src/SettingsModal';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './src/settings';
import { colors } from './src/theme';
import { useDailyService } from './src/useDailyService';
import { formatDuration } from './src/usage';
import { useVoiceChat, type Message, type Status } from './src/useVoiceChat';

const STATUS_LABEL: Record<Status, string> = {
  idle: 'タップして話しかける',
  listening: '聞いています… 話し終わったらタップ',
  thinking: '考えています…',
  speaking: '話しています… タップで止める',
};

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList<Message>>(null);

  const chat = useVoiceChat(settings);
  const daily = useDailyService(settings, chat.status !== 'idle', chat.addExternalMessage);

  // 初回: 設定を読み込み、APIキーが無ければ設定画面を開く
  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
      if (!s.apiKey) setShowSettings(true);
    });
  }, []);

  const busy = chat.status !== 'idle';
  const topApps = chat.usage?.apps.slice(0, 3) ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.appTitle}>デイリー</Text>
        <Pressable onPress={() => setShowSettings(true)} hitSlop={12}>
          <Text style={styles.headerLink}>設定</Text>
        </Pressable>
      </View>

      {/* 今日のスマホ使用状況 */}
      <View style={styles.usageCard}>
        {!chat.usageAvailable ? (
          <Text style={styles.usageNote}>
            使用状況の取得は Android の開発ビルド / APK でのみ動作します。
          </Text>
        ) : !chat.usagePermitted ? (
          <View style={styles.permRow}>
            <Text style={[styles.usageNote, styles.flex]}>
              スマホの使い方をアドバイスするには、「使用状況へのアクセス」の許可が必要です。
            </Text>
            <Pressable style={styles.permButton} onPress={chat.requestUsagePermission}>
              <Text style={styles.permButtonText}>許可する</Text>
            </Pressable>
          </View>
        ) : chat.usage ? (
          <Pressable onPress={() => void chat.refreshUsage()}>
            <Text style={styles.usageMain}>
              今日の使用 {formatDuration(chat.usage.totalMs)}　画面オン {chat.usage.screenOnCount}回
            </Text>
            <Text style={styles.usageNote} numberOfLines={2}>
              {topApps.length > 0
                ? topApps.map((a) => `${a.label} ${formatDuration(a.totalMs)}`).join('、')
                : 'まだ記録がありません'}
            </Text>
          </Pressable>
        ) : (
          <ActivityIndicator color={colors.teal} />
        )}
      </View>

      {/* 「デイリー」の呼びかけで起動する常時待機 */}
      {daily.available && (
        <View style={styles.dailyCard}>
          <View style={styles.permRow}>
            <View style={styles.flex}>
              <Text style={styles.usageMain}>「ヘイ、デイリー」で呼び出す</Text>
              <Text style={styles.usageNote}>
                {daily.running
                  ? `オン（${daily.stateLabel}）「ヘイ、デイリー」と呼ぶと会話モードになり、あとは呼ばずに続けて話せます。「デイリー戻って」で待機に戻ります。`
                  : 'オンにすると、InstagramやLINEを見ながらでも、画面ロック中でも、「ヘイ、デイリー」と呼びかけるだけで会話できます。'}
              </Text>
            </View>
            <Switch
              value={daily.running}
              onValueChange={(v) => void daily.toggle(v)}
              trackColor={{ true: colors.teal, false: colors.line }}
            />
          </View>
          <Pressable onPress={daily.openBatterySettings} hitSlop={8}>
            <Text style={styles.link}>電池の最適化から除外する（止まりにくくなります）</Text>
          </Pressable>
          {daily.error ? <Text style={styles.errorNote}>{daily.error}</Text> : null}
        </View>
      )}

      {/* 会話 */}
      <FlatList
        ref={listRef}
        style={styles.flex}
        contentContainerStyle={styles.chatContent}
        data={chat.messages}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <Text style={styles.empty}>
            マイクをタップして話しかけてみてください。{'\n'}
            「今日どれくらいスマホ使ってる？」と聞くと、使用状況を見て答えます。
          </Text>
        }
        renderItem={({ item }) => <Bubble message={item} />}
      />

      {chat.partial ? <Text style={styles.partial}>{chat.partial}</Text> : null}

      {/* 操作エリア */}
      <KeyboardAvoidingView behavior="padding">
        <View style={styles.controls}>
          <Text style={styles.statusText}>{STATUS_LABEL[chat.status]}</Text>

          <View style={styles.micRow}>
            <View style={styles.micSide} />
            <Pressable
              onPress={chat.onMicPress}
              disabled={!loaded}
              accessibilityRole="button"
              accessibilityLabel="マイク"
              style={[
                styles.mic,
                chat.status === 'listening' && styles.micListening,
                chat.status === 'speaking' && styles.micSpeaking,
                chat.status === 'thinking' && styles.micThinking,
              ]}
            >
              {chat.status === 'thinking' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <MicGlyph active={chat.status === 'listening'} stop={chat.status === 'speaking'} />
              )}
            </Pressable>
            <View style={styles.micSide}>
              {busy && (
                <Pressable onPress={chat.cancel} hitSlop={12}>
                  <Text style={styles.cancel}>中止</Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="文字で送ることもできます"
              placeholderTextColor={colors.muted}
              returnKeyType="send"
              onSubmitEditing={() => {
                chat.sendText(input);
                setInput('');
              }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      <SettingsModal
        visible={showSettings}
        settings={settings}
        onClearChat={chat.clearChat}
        onClose={() => setShowSettings(false)}
        onSave={async (s) => {
          setSettings(s);
          await saveSettings(s);
          setShowSettings(false);
        }}
      />
    </SafeAreaView>
  );
}

function Bubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  const isError = message.role === 'error';
  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : isError ? styles.bubbleError : styles.bubbleAi]}>
        <Text style={[styles.bubbleText, isUser && styles.bubbleTextUser, isError && styles.bubbleTextError]}>
          {message.text}
        </Text>
      </View>
    </View>
  );
}

/** アイコン画像を使わずに View だけで描いたマイク / 停止マーク */
function MicGlyph({ active, stop }: { active: boolean; stop: boolean }) {
  if (stop) return <View style={styles.stopSquare} />;
  return (
    <View style={styles.micGlyph}>
      <View style={[styles.micCapsule, active && styles.micCapsuleActive]} />
      <View style={styles.micStem} />
      <View style={styles.micBase} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  appTitle: { fontSize: 22, fontWeight: '700', color: colors.ink },
  headerLink: { fontSize: 16, color: colors.teal, fontWeight: '600' },

  usageCard: {
    marginHorizontal: 16,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dailyCard: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 14,
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  link: { fontSize: 13, color: colors.teal, fontWeight: '600' },
  errorNote: { fontSize: 13, color: colors.danger, lineHeight: 19 },
  usageMain: { fontSize: 16, fontWeight: '700', color: colors.ink },
  usageNote: { fontSize: 13, color: colors.muted, lineHeight: 19, marginTop: 2 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  permButton: {
    backgroundColor: colors.teal,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  permButtonText: { color: '#fff', fontWeight: '700' },

  chatContent: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { color: colors.muted, textAlign: 'center', lineHeight: 24, marginTop: 48 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  bubbleUser: { backgroundColor: colors.teal, borderBottomRightRadius: 4 },
  bubbleAi: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderBottomLeftRadius: 4,
  },
  bubbleError: { backgroundColor: colors.dangerSoft, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 16, lineHeight: 24, color: colors.ink },
  bubbleTextUser: { color: '#fff' },
  bubbleTextError: { color: colors.danger },

  partial: {
    marginHorizontal: 20,
    marginBottom: 4,
    color: colors.muted,
    fontSize: 15,
    fontStyle: 'italic',
  },

  controls: { paddingHorizontal: 16, paddingBottom: 12, paddingTop: 4, alignItems: 'center' },
  statusText: { fontSize: 13, color: colors.muted, marginBottom: 10 },
  micRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  micSide: { flex: 1, alignItems: 'center' },
  cancel: { fontSize: 15, color: colors.danger, fontWeight: '600' },
  mic: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micListening: { backgroundColor: colors.amber },
  micSpeaking: { backgroundColor: colors.tealDeep },
  micThinking: { backgroundColor: colors.muted },
  micGlyph: { alignItems: 'center' },
  micCapsule: {
    width: 20,
    height: 32,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#fff',
  },
  micCapsuleActive: { backgroundColor: '#fff' },
  micStem: { width: 3, height: 8, backgroundColor: '#fff' },
  micBase: { width: 22, height: 3, borderRadius: 2, backgroundColor: '#fff' },
  stopSquare: { width: 26, height: 26, borderRadius: 5, backgroundColor: '#fff' },

  inputRow: { width: '100%', marginTop: 14 },
  textInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
});
