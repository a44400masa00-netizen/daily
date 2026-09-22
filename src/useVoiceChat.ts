import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';

import {
  getTodayUsage,
  hasUsagePermission,
  isUsageStatsAvailable,
  getPromptExtras,
  openUsageAccessSettings,
  processReply,
  startThinkingSound,
  stopThinkingSound,
  type TodayUsage,
} from '../modules/daily-native';
import { askBrain, canAnswer, missingMessage } from './brain';
import type { ChatTurn } from './gemini';
import type { Settings } from './settings';
import { buildSystemPrompt } from './usage';

export type Status = 'idle' | 'listening' | 'thinking' | 'speaking';
export type Message = { id: string; role: 'user' | 'model' | 'error'; text: string };

const MAX_HISTORY_TURNS = 20;
const MAX_SILENT_RETRIES = 2; // ハンズフリー中、無音が続いたら自動終了する回数

/** 画面表示用のメッセージ → Gemini に渡す履歴（同じ役割が連続したら結合） */
function toHistory(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const m of messages) {
    if (m.role === 'error') continue;
    const last = turns[turns.length - 1];
    if (last && last.role === m.role) last.text += `\n${m.text}`;
    else turns.push({ role: m.role, text: m.text });
  }
  const recent = turns.slice(-MAX_HISTORY_TURNS);
  while (recent.length > 0 && recent[0].role !== 'user') recent.shift();
  return recent;
}

/** 読み上げに向かない記号を取り除く */
function cleanForSpeech(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>~]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useVoiceChat(settings: Settings) {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const statusRef = useRef<Status>('idle');
  const [partial, setPartial] = useState('');
  const [usage, setUsage] = useState<TodayUsage | null>(null);
  const [usagePermitted, setUsagePermitted] = useState(false);

  const transcriptRef = useRef('');
  const recognitionErrorRef = useRef<string | null>(null);
  const silentCountRef = useRef(0);
  const loopRef = useRef(false); // ハンズフリーの会話ループ中か
  const sessionRef = useRef(0); // 中断したら +1 して、古い非同期結果を捨てる
  const abortRef = useRef<AbortController | null>(null);
  const idCounter = useRef(0);

  // ---- 小さなヘルパー -------------------------------------------------------
  const changeStatus = (s: Status) => {
    const prev = statusRef.current;
    statusRef.current = s;
    setStatus(s);
    // 考え中はポコポコ音を鳴らし続ける
    if (s === 'thinking' && prev !== 'thinking') startThinkingSound();
    else if (s !== 'thinking' && prev === 'thinking') stopThinkingSound();
  };

  const addMessage = (role: Message['role'], text: string) => {
    idCounter.current += 1;
    const msg: Message = { id: `${Date.now()}-${idCounter.current}`, role, text };
    messagesRef.current = [...messagesRef.current, msg];
    setMessages(messagesRef.current);
  };

  // ---- スマホ使用状況 ---------------------------------------------------------
  const refreshUsage = useCallback(async (): Promise<TodayUsage | null> => {
    const permitted = hasUsagePermission();
    setUsagePermitted(permitted);
    if (!permitted) {
      setUsage(null);
      return null;
    }
    try {
      const u = await getTodayUsage();
      setUsage(u);
      return u;
    } catch (e) {
      console.warn('getTodayUsage failed', e);
      return null;
    }
  }, []);

  // 起動時と、設定画面から戻ってきたときに再取得
  useEffect(() => {
    void refreshUsage();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshUsage();
    });
    return () => sub.remove();
  }, [refreshUsage]);

  const requestUsagePermission = useCallback(() => openUsageAccessSettings(), []);

  // ---- 会話の流れ -------------------------------------------------------------
  const stopAll = () => {
    sessionRef.current += 1;
    loopRef.current = false;
    silentCountRef.current = 0;
    abortRef.current?.abort();
    abortRef.current = null;
    Speech.stop();
    if (statusRef.current === 'listening') {
      // status を先に idle にしてから abort する（終了イベントを無視させるため）
      changeStatus('idle');
      ExpoSpeechRecognitionModule.abort();
    }
    transcriptRef.current = '';
    setPartial('');
    changeStatus('idle');
  };

  const startListening = async () => {
    if (statusRef.current === 'thinking') return;
    Speech.stop();
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      addMessage('error', 'マイクの許可が必要です。端末の設定からこのアプリのマイクを許可してください。');
      loopRef.current = false;
      changeStatus('idle');
      return;
    }
    transcriptRef.current = '';
    recognitionErrorRef.current = null;
    setPartial('');
    changeStatus('listening');
    ExpoSpeechRecognitionModule.start({
      lang: 'ja-JP',
      interimResults: true,
      continuous: false,
    });
  };

  const afterReply = () => {
    if (loopRef.current) void startListening();
    else changeStatus('idle');
  };

  const speakReply = (text: string, session: number) => {
    if (!settingsRef.current.speak) {
      afterReply();
      return;
    }
    changeStatus('speaking');
    const finish = () => {
      if (sessionRef.current !== session || statusRef.current !== 'speaking') return;
      afterReply();
    };
    Speech.speak(cleanForSpeech(text), {
      language: 'ja-JP',
      onDone: finish,
      onError: finish,
    });
  };

  const send = async (text: string) => {
    const session = ++sessionRef.current;
    addMessage('user', text);
    changeStatus('thinking');

    const s = settingsRef.current;
    if (!canAnswer(s.brain, s.apiKey)) {
      addMessage('error', missingMessage(s.brain));
      loopRef.current = false;
      changeStatus('idle');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // 毎回、最新の使用状況を取り直してシステムプロンプトに入れる
      const u = await refreshUsage();
      const reply = await askBrain({
        brain: s.brain,
        apiKey: s.apiKey,
        model: s.model,
        systemPrompt:
          buildSystemPrompt(u, {
            available: isUsageStatsAvailable,
            permitted: hasUsagePermission(),
          }) +
          '\n\n' +
          getPromptExtras(s.callName, s.tone, s.musicApp), // 呼び方・話し方・スマホ操作のしかた
        history: toHistory(messagesRef.current),
        signal: controller.signal,
      });
      if (sessionRef.current !== session) return;
      // 返事に含まれるスマホの操作(タイマー等)を実行し、読み上げる文章を受け取る
      const spoken = await processReply(reply);
      if (sessionRef.current !== session) return;
      addMessage('model', spoken);
      speakReply(spoken, session);
    } catch (e) {
      if (sessionRef.current !== session) return; // 中断された
      addMessage('error', e instanceof Error ? e.message : '不明なエラーが発生しました。');
      loopRef.current = false;
      changeStatus('idle');
    }
  };

  const handleSilence = () => {
    silentCountRef.current += 1;
    if (loopRef.current && silentCountRef.current < MAX_SILENT_RETRIES) {
      void startListening();
    } else {
      loopRef.current = false;
      silentCountRef.current = 0;
      changeStatus('idle');
    }
  };

  // ---- 音声認識イベント ---------------------------------------------------------
  useSpeechRecognitionEvent('result', (event) => {
    const t = event.results?.[0]?.transcript ?? '';
    if (t) {
      transcriptRef.current = t;
      setPartial(t);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    recognitionErrorRef.current = event.error;
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.warn('speech error', event.error, event.message);
    }
  });

  // エラーの後にも end が来るので、結果の処理は end に一本化する
  useSpeechRecognitionEvent('end', () => {
    if (statusRef.current !== 'listening') return;
    const text = transcriptRef.current.trim();
    const err = recognitionErrorRef.current;
    transcriptRef.current = '';
    recognitionErrorRef.current = null;
    setPartial('');

    if (text) {
      silentCountRef.current = 0;
      void send(text);
    } else if (err && err !== 'no-speech' && err !== 'aborted') {
      addMessage('error', `音声認識に失敗しました (${err})。もう一度お試しください。`);
      loopRef.current = false;
      changeStatus('idle');
    } else {
      handleSilence();
    }
  });

  useEffect(() => () => stopAll(), []); // アンマウント時に全部止める

  // ---- 画面から呼ぶ操作 ---------------------------------------------------------
  /** マイクボタン: 待機中→聞き取り開始 / 聞き取り中→話し終わり / それ以外→中断 */
  const onMicPress = () => {
    switch (statusRef.current) {
      case 'idle':
        loopRef.current = settingsRef.current.handsFree;
        silentCountRef.current = 0;
        void startListening();
        break;
      case 'listening':
        ExpoSpeechRecognitionModule.stop(); // 途中までの結果を確定 → end イベント
        break;
      default:
        stopAll();
    }
  };

  const sendText = (text: string) => {
    const t = text.trim();
    if (!t || statusRef.current === 'thinking') return;
    if (statusRef.current !== 'idle') stopAll();
    loopRef.current = false;
    void send(t);
  };

  const clearChat = () => {
    stopAll();
    messagesRef.current = [];
    setMessages([]);
  };

  return {
    messages,
    status,
    partial,
    usage,
    usagePermitted,
    usageAvailable: isUsageStatsAvailable,
    onMicPress,
    cancel: stopAll,
    sendText,
    clearChat,
    /** 常時待機サービス(バックグラウンド)での会話を画面に追加する */
    addExternalMessage: addMessage,
    refreshUsage,
    requestUsagePermission,
  };
}
