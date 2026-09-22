import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// ---- 使用状況 (UsageStats) の型 ------------------------------------------------
export type AppUsage = {
  packageName: string;
  label: string;
  /** 今日の前面使用時間(ms) */
  totalMs: number;
  /** 今日の起動(切り替え)回数 */
  launchCount: number;
  /** 最後に使った時刻(epoch ms) */
  lastUsed: number;
};

export type LaunchEvent = {
  packageName: string;
  label: string;
  timestamp: number;
};

export type TodayUsage = {
  startOfDay: number;
  now: number;
  /** 今日の合計使用時間(ms)。このアプリ自身とホーム画面は除く */
  totalMs: number;
  screenOnCount: number;
  unlockCount: number;
  /** 使用時間の長い順 */
  apps: AppUsage[];
  /** 起動したアプリの時系列（古い→新しい、最大40件） */
  launches: LaunchEvent[];
};

// ---- 常時待機サービスのイベント ---------------------------------------------------
export type DailyMessage = { role: 'user' | 'model' | 'error'; text: string };
/** listening=呼びかけ待ち / awake=会話中（続けて話せる） / thinking / speaking / paused=アプリで会話中 / stopped */
export type DailyState = { state: 'listening' | 'awake' | 'thinking' | 'speaking' | 'paused' | 'stopped' };

type DailyEvents = {
  onMessage(e: DailyMessage): void;
  onState(e: DailyState): void;
};

/** 端末内AI（Gemma 4 E2B）のモデルファイルの状態 */
export type LocalModelStatus = {
  state: 'none' | 'downloading' | 'ready' | 'failed';
  downloaded: number;
  total: number;
};

/** スマホの操作に必要な許可の状態 */
export type ControlStatus = {
  /** システム設定の変更（画面の明るさ） */
  writeSettings: boolean;
  /** 通知ポリシー（おやすみモード・マナーモード） */
  notificationPolicy: boolean;
  /** WRITE_SECURE_SETTINGS（電力モード）。パソコンからの adb 許可が必要 */
  secureSettings: boolean;
  /** 正確な時刻のアラーム */
  exactAlarm: boolean;
  /** 通知へのアクセス。許可すると、アプリを開く・音楽を再生するのがタップなしのハンズフリーになる */
  notificationListener: boolean;
};

declare class DailyNative extends NativeModule<DailyEvents> {
  hasUsagePermission(): boolean;
  openUsageSettings(): void;
  getTodayUsage(): Promise<TodayUsage>;
  setConfig(
    apiKey: string,
    model: string,
    speak: boolean,
    brain: string,
    callName: string,
    tone: string,
    musicApp: string
  ): void;
  getPromptExtras(callName: string, tone: string, musicApp: string): string;
  processReply(reply: string): Promise<string>;
  getControlStatus(): ControlStatus;
  openControlSettings(kind: string): void;
  getLocalModelStatus(): LocalModelStatus;
  startModelDownload(): void;
  deleteLocalModel(): void;
  askLocalModel(systemPrompt: string, history: { role: string; text: string }[]): Promise<string>;
  startThinkingSound(): void;
  stopThinkingSound(): void;
  startService(): void;
  stopService(): void;
  isServiceRunning(): boolean;
  setServicePaused(paused: boolean): void;
  openBatterySettings(): void;
}

// Expo Go や iOS ではネイティブモジュールが無いので null（アプリは落とさない）
const native = Platform.OS === 'android' ? requireOptionalNativeModule<DailyNative>('Daily') : null;

/** このビルドでネイティブ機能が使えるか（開発ビルド/APK なら true） */
export const isDailyAvailable = native != null;
export const isUsageStatsAvailable = isDailyAvailable;

// ---- 使用状況 ------------------------------------------------------------------
export function hasUsagePermission(): boolean {
  return native?.hasUsagePermission() ?? false;
}
export function openUsageAccessSettings(): void {
  native?.openUsageSettings();
}
/** 許可されていない / 使えない場合は null */
export async function getTodayUsage(): Promise<TodayUsage | null> {
  if (!native || !native.hasUsagePermission()) return null;
  return native.getTodayUsage();
}

// ---- 常時待機サービス -----------------------------------------------------------
export function setDailyConfig(
  apiKey: string,
  model: string,
  speak: boolean,
  brain: string,
  callName: string,
  tone: string,
  musicApp: string
): void {
  native?.setConfig(apiKey, model, speak, brain, callName, tone, musicApp);
}
export function startDailyService(): void {
  native?.startService();
}
export function stopDailyService(): void {
  native?.stopService();
}
export function isDailyServiceRunning(): boolean {
  return native?.isServiceRunning() ?? false;
}
export function setDailyServicePaused(paused: boolean): void {
  native?.setServicePaused(paused);
}
/** 「考え中」のポコポコ音（鳴らし続ける）。stop するまで続く */
export function startThinkingSound(): void {
  native?.startThinkingSound();
}
export function stopThinkingSound(): void {
  native?.stopThinkingSound();
}
export function openBatterySettings(): void {
  native?.openBatterySettings();
}

type Sub = { remove(): void };
const noSub: Sub = { remove() {} };

export function onDailyMessage(cb: (m: DailyMessage) => void): Sub {
  return native ? native.addListener('onMessage', cb) : noSub;
}
export function onDailyState(cb: (s: DailyState) => void): Sub {
  return native ? native.addListener('onState', cb) : noSub;
}

// ---- 端末内AI（Gemma 4 E2B） ---------------------------------------------------
export function getLocalModelStatus(): LocalModelStatus {
  return native?.getLocalModelStatus() ?? { state: 'none', downloaded: 0, total: 0 };
}
export function startLocalModelDownload(): void {
  native?.startModelDownload();
}
/** ダウンロードの中止、または保存済みモデルの削除 */
export function deleteLocalModel(): void {
  native?.deleteLocalModel();
}
export async function askLocalModel(systemPrompt: string, history: { role: string; text: string }[]): Promise<string> {
  if (!native) throw new Error('端末内AIはこの環境では使えません。');
  return native.askLocalModel(systemPrompt, history);
}

// ---- 呼び方・話し方、スマホの操作 -------------------------------------------------
/** システムプロンプトに足す「呼び方・話し方・スマホ操作のしかた」 */
export function getPromptExtras(callName: string, tone: string, musicApp: string): string {
  return native?.getPromptExtras(callName, tone, musicApp) ?? '';
}
/** AIの返事に含まれる操作([[ACTION:...]])を実行し、読み上げる文章を返す */
export async function processReply(reply: string): Promise<string> {
  if (!native) return reply;
  return native.processReply(reply);
}
export function getControlStatus(): ControlStatus {
  return (
    native?.getControlStatus() ?? {
      writeSettings: false,
      notificationPolicy: false,
      secureSettings: false,
      exactAlarm: false,
      notificationListener: false,
    }
  );
}
export function openControlSettings(
  kind: 'writeSettings' | 'notificationPolicy' | 'exactAlarm' | 'notificationListener'
): void {
  native?.openControlSettings(kind);
}
