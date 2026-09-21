import * as SecureStore from 'expo-secure-store';

// gemini-3.8-flash は 2026年9月時点の最新 Flash。設定画面から変更できる。
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export type Settings = {
  apiKey: string;
  model: string;
  /** 返事を作る頭脳。auto=Gemini→使えないとき端末内AI / cloud=Geminiのみ / device=端末内AIのみ */
  brain: 'auto' | 'cloud' | 'device';
  /** 返答を音声で読み上げる */
  speak: boolean;
  /** 読み上げ後に自動で聞き取りを再開する */
  handsFree: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: DEFAULT_MODEL,
  brain: 'auto',
  speak: true,
  handsFree: false,
};

const KEY_API = 'gemini_api_key';
const KEY_PREFS = 'app_prefs';

// APIキーは APK に埋め込まず、端末の Keystore に保存する（SecureStore）
export async function loadSettings(): Promise<Settings> {
  try {
    const [apiKey, prefsJson] = await Promise.all([
      SecureStore.getItemAsync(KEY_API),
      SecureStore.getItemAsync(KEY_PREFS),
    ]);
    const prefs = prefsJson ? JSON.parse(prefsJson) : {};
    return {
      ...DEFAULT_SETTINGS,
      ...prefs,
      apiKey: apiKey ?? '',
      model: (prefs.model as string | undefined)?.trim() || DEFAULT_MODEL,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  const { apiKey, ...prefs } = s;
  await Promise.all([
    SecureStore.setItemAsync(KEY_API, apiKey.trim()),
    SecureStore.setItemAsync(KEY_PREFS, JSON.stringify(prefs)),
  ]);
}
