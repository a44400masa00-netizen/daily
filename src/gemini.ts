export type ChatTurn = { role: 'user' | 'model'; text: string };

type GeminiPart = { text?: string; thought?: boolean };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

/**
 * Gemini API (generateContent) を REST で直接呼ぶ。
 * SDK を使わないのでネイティブ依存が増えず、React Native でもそのまま動く。
 */
export async function askGemini(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  history: ChatTurn[];
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, model, systemPrompt, history, signal } = params;

  const generationConfig: Record<string, unknown> = {};
  // Gemini 3.x は thinkingLevel で思考量を調整（音声会話は速さ重視で low）。
  // temperature などのサンプリング設定は Gemini 3 では既定値のままが推奨。
  if (/^gemini-3/.test(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  }

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig,
  };

  // 通信が固まったときのために 30 秒でタイムアウト
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 30_000);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });

    if (!res.ok) {
      const raw = await res.text();
      throw new GeminiError(friendlyHttpError(res.status, raw), res.status);
    }

    const data = (await res.json()) as GeminiResponse;
    if (data.promptFeedback?.blockReason) {
      throw new GeminiError('その内容にはお答えできませんでした。別の話題でお願いします。');
    }
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!text) throw new GeminiError('うまく回答を作れませんでした。もう一度話しかけてください。');
    return text;
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if (signal?.aborted) throw e; // 利用者が中断した場合はそのまま投げる
    if (timeout.signal.aborted) throw new GeminiError('応答がタイムアウトしました。通信状況を確認してください。');
    throw new GeminiError('通信に失敗しました。ネットワークを確認してください。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function friendlyHttpError(status: number, raw: string): string {
  let detail = '';
  try {
    detail = JSON.parse(raw)?.error?.message ?? '';
  } catch {
    detail = raw.slice(0, 200);
  }
  switch (status) {
    case 400:
      return /API key/i.test(detail)
        ? 'APIキーが正しくありません。設定から確認してください。'
        : `リクエストエラー(400): ${detail}`;
    case 401:
    case 403:
      return 'APIキーが無効、または権限がありません。設定から確認してください。';
    case 404:
      return 'モデルが見つかりません。設定のモデル名を確認してください。';
    case 429:
      return '利用上限に達したか、混み合っています。少し待ってからもう一度お試しください。';
    default:
      return `Gemini APIエラー(${status}): ${detail}`;
  }
}
