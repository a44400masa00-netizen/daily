import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform, type Permission } from 'react-native';

import {
  isDailyAvailable,
  isDailyServiceRunning,
  onDailyMessage,
  onDailyState,
  openBatterySettings,
  setDailyConfig,
  setDailyServicePaused,
  startDailyService,
  stopDailyService,
  type DailyState,
} from '../modules/daily-native';
import type { Settings } from './settings';

const STATE_LABEL: Record<DailyState['state'], string> = {
  listening: '呼びかけ待ち',
  awake: 'どうぞ話してください',
  thinking: '考え中…',
  speaking: '話しています…',
  paused: 'アプリで会話中（一時停止）',
  stopped: '',
};

/**
 * 「デイリー」の呼びかけで起動する常時待機サービスの ON/OFF と状態表示。
 * @param paused アプリ画面で会話中は true（マイクの取り合いを避けるため待機を一時停止）
 * @param onMessage バックグラウンドで交わされた会話を画面に反映する
 */
export function useDailyService(
  settings: Settings,
  paused: boolean,
  onMessage: (role: 'user' | 'model' | 'error', text: string) => void
) {
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<DailyState['state']>('stopped');
  const [error, setError] = useState('');
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    setRunning(isDailyServiceRunning());
    const s1 = onDailyState(({ state: st }) => {
      setState(st);
      setRunning(st !== 'stopped');
    });
    const s2 = onDailyMessage((m) => onMessageRef.current(m.role, m.text));
    return () => {
      s1.remove();
      s2.remove();
    };
  }, []);

  // 設定を変えたら、サービス側の保存値も更新（アプリを閉じてもこの値が使われる）
  useEffect(() => {
    if (isDailyAvailable && settings.apiKey) {
      setDailyConfig(settings.apiKey, settings.model, settings.speak, settings.picovoiceKey);
    }
  }, [settings.apiKey, settings.model, settings.speak, settings.picovoiceKey]);

  useEffect(() => {
    if (running) setDailyServicePaused(paused);
  }, [paused, running]);

  const toggle = useCallback(
    async (on: boolean) => {
      setError('');
      if (!on) {
        stopDailyService();
        setRunning(false);
        return;
      }
      if (!settings.apiKey) {
        setError('先に右上の「設定」で Gemini API キーを入力してください。');
        return;
      }
      const mic = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO as Permission;
      const perms: Permission[] = [mic];
      if (Number(Platform.Version) >= 33) {
        perms.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS as Permission);
      }
      const result = await PermissionsAndroid.requestMultiple(perms);
      if (result[mic] !== 'granted') {
        setError('マイクの許可が必要です。');
        return;
      }
      try {
        setDailyConfig(settings.apiKey, settings.model, settings.speak, settings.picovoiceKey);
        startDailyService();
        setRunning(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : '開始できませんでした。');
      }
    },
    [settings.apiKey, settings.model, settings.speak, settings.picovoiceKey]
  );

  return {
    available: isDailyAvailable,
    running,
    stateLabel: STATE_LABEL[state],
    error,
    toggle,
    openBatterySettings,
  };
}
