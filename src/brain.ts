import { askLocalModel, getLocalModelStatus } from '../modules/daily-native';
import { askGemini, type ChatTurn } from './gemini';
import type { Settings } from './settings';

type Brain = Settings['brain'];

const localReady = () => getLocalModelStatus().state === 'ready';

/** いまの設定で、返事を作れる状態か（APIキーの有無・端末内AIのダウンロード状況） */
export function canAnswer(brain: Brain, apiKey: string): boolean {
  if (brain === 'device') return localReady();
  if (brain === 'cloud') return apiKey.length > 0;
  return apiKey.length > 0 || localReady();
}

export function missingMessage(brain: Brain): string {
  return brain === 'device'
    ? '端末内AIのモデルがありません。右上の「設定」からダウンロードしてください。'
    : '右上の「設定」から Gemini API キーを入力してください。';
}

/**
 * 返事を作る。
 *   auto  : まず Gemini。使えないとき（回数制限・混雑・通信なし）は端末内AI
 *   cloud : Gemini だけ
 *   device: 端末内AIだけ
 */
export async function askBrain(params: {
  brain: Brain;
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: ChatTurn[];
  signal?: AbortSignal;
}): Promise<string> {
  const { brain, apiKey, model, systemPrompt, history, signal } = params;
  const local = () => askLocalModel(systemPrompt, history);

  if (brain === 'device') return local();
  if (brain === 'cloud') return askGemini({ apiKey, model, systemPrompt, history, signal });

  if (!apiKey) return local();
  try {
    return await askGemini({ apiKey, model, systemPrompt, history, signal });
  } catch (e) {
    if (signal?.aborted || !localReady()) throw e;
    return local(); // Gemini が使えないので、端末内AIで答える
  }
}
