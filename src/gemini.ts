export type ChatTurn = { role: 'user' | 'model'; text: string };

type GeminiPart = { text?: string; thought?: boolean };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// 混雑(503など)は一時的なことが多いので、間を置いて自動でやり直す
const RETRYABLE = new Set([408, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 2500];

export class GeminiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

class HttpFailure extends Error {
  status: number;
  raw: string;
  constructor(status: number, raw: string) {
    super(`HTTP ${status}`);
    this.status = status;
    this.raw = raw;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const { model, signal } = params;
  // Gemini 3.x は thinkingLevel で思考量を調整（音声会話は速さ重視で low）
  let useThinking = /^gemini-3/.test(model);
  let attempt = 0;

  for (;;) {
    try {
      return await request(params, useThinking);
    } catch (e) {
      if (e instanceof HttpFailure) {
        // 思考設定が原因で拒否された場合は、設定を外して1回やり直す
        if (e.status === 400 && useThinking && /thinking/i.test(e.raw)) {
          useThinking = false;
          continue;
        }
        if (RETRYABLE.has(e.status) && attempt < RETRY_DELAYS_MS.length && !signal?.aborted) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          attempt += 1;
          continue;
        }
        throw toGeminiError(e);
      }
      throw e;
    }
  }
}

async function request(
  params: { apiKey: string; model: string; systemPrompt: string; history: ChatTurn[]; signal?: AbortSignal },
  useThinking: boolean
): Promise<string> {
  const { apiKey, model, systemPrompt, history, signal } = params;

  const generationConfig: Record<string, unknown> = {};
  if (useThinking) generationConfig.thinkingConfig = { thinkingLevel: 'low' };

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

    if (!res.ok) throw new HttpFailure(res.status, await res.text());

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
    if (e instanceof HttpFailure || e instanceof GeminiError) throw e;
    if (signal?.aborted) throw e; // 利用者が中断した場合はそのまま投げる
    if (timeout.signal.aborted) throw new GeminiError('応答がタイムアウトしました。通信状況を確認してください。');
    throw new GeminiError('通信に失敗しました。ネットワークを確認してください。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function toGeminiError(e: HttpFailure): GeminiError {
  let apiMessage = '';
  try {
    apiMessage = JSON.parse(e.raw)?.error?.message ?? '';
  } catch {
    apiMessage = e.raw.slice(0, 120);
  }
  const detail = `HTTP ${e.status}${apiMessage ? `: ${apiMessage.slice(0, 160)}` : ''}`;
  switch (e.status) {
    case 400:
      return new GeminiError(
        /API key/i.test(apiMessage)
          ? 'APIキーが正しくありません。設定から確認してください。'
          : `リクエストエラーです。（${detail}）`,
        e.status
      );
    case 401:
    case 403:
      return new GeminiError('APIキーが無効、または権限がありません。設定から確認してください。', e.status);
    case 404:
      return new GeminiError('モデルが見つかりません。設定のモデル名を確認してください。', e.status);
    case 429:
      return new GeminiError('利用上限に達したか、混み合っています。少し待ってからもう一度お試しください。', e.status);
    default:
      return new GeminiError(`Gemini側でエラーが起きました。少し待ってからもう一度お試しください。（${detail}）`, e.status);
  }
}
