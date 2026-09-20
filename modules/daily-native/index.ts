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

declare class DailyNative extends NativeModule<DailyEvents> {
  hasUsagePermission(): boolean;
  openUsageSettings(): void;
  getTodayUsage(): Promise<TodayUsage>;
  setConfig(apiKey: string, model: string, speak: boolean): void;
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
export function setDailyConfig(apiKey: string, model: string, speak: boolean): void {
  native?.setConfig(apiKey, model, speak);
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
