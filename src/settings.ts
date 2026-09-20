import * as SecureStore from 'expo-secure-store';

// gemini-3.8-flash は 2026年9月時点の最新 Flash。設定画面から変更できる。
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export type Settings = {
  apiKey: string;
  model: string;
  /** Picovoice AccessKey（任意）。入れると「デイリー」「ヘイデイリー」を専用エンジンで端末内検出する */
  picovoiceKey: string;
  /** 返答を音声で読み上げる */
  speak: boolean;
  /** 読み上げ後に自動で聞き取りを再開する */
  handsFree: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  picovoiceKey: '',
  speak: true,
  handsFree: false,
};

const KEY_API = 'gemini_api_key';
const KEY_PICOVOICE = 'picovoice_access_key';
const KEY_PREFS = 'app_prefs';

// APIキーは APK に埋め込まず、端末の Keystore に保存する（SecureStore）
export async function loadSettings(): Promise<Settings> {
  try {
    const [apiKey, picovoiceKey, prefsJson] = await Promise.all([
      SecureStore.getItemAsync(KEY_API),
      SecureStore.getItemAsync(KEY_PICOVOICE),
      SecureStore.getItemAsync(KEY_PREFS),
    ]);
    const prefs = prefsJson ? JSON.parse(prefsJson) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...prefs,
      apiKey: apiKey ?? '',
      picovoiceKey: picovoiceKey ?? '',
      model: (prefs.model as string | undefined)?.trim() || DEFAULT_MODEL,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const { apiKey, picovoiceKey, ...prefs } = s;
  await Promise.all([
    SecureStore.setItemAsync(KEY_API, apiKey.trim()),
    SecureStore.setItemAsync(KEY_PICOVOICE, picovoiceKey.trim()),
    SecureStore.setItemAsync(KEY_PREFS, JSON.stringify(prefs)),
  ]);
}
