# デイリー（Expo / Android）

「ヘイ、デイリー」と呼びかけると Gemini が答える音声AIアシスタントです。
アプリを閉じていても、画面ロック中でも、InstagramやLINEを見ながらでも使えます。
Android の UsageStats（使用履歴）から今日のスマホ使用状況を把握し、会話の中でアドバイスします。

## 使い方

1. GitHub に push（`main`）→ Actions「Build Android APK」→ Artifacts の **daily-apk** から APK をダウンロードして端末へ
2. アプリを開き、右上「設定」で **Gemini API キー**（https://aistudio.google.com/apikey ）を入力
3. 上部の「許可する」→ 設定画面で **デイリー** を ON（使用状況へのアクセス）
4. 「「ヘイ、デイリー」で呼び出す」のスイッチを ON（マイクと通知を許可）
5. 「電池の最適化から除外する」を開き、デイリーを「制限なし」にする

## 会話のしかた

| すること | 動作 |
| --- | --- |
| 「ヘイ、デイリー」と言う | 合図音 → **会話モード**開始 |
| 会話モード中に話す | 毎回呼ばなくても答える。考え中は「ポコポコ」音が鳴り続け、答えるときに止まる |
| 「デイリー戻って」「デイリー戻っていいよ」「デイリー終了」 | 会話モードを終えて呼びかけ待ちに戻る |
| 15分間だれも話さない | 自動で呼びかけ待ちに戻る（`DailyListenerService.kt` の `SESSION_IDLE_TIMEOUT_MS`。0 で無効） |

会話モード中は、動画・テレビ・周囲の声もマイクが拾います。デイリー宛てでないと Gemini が判断した発話には
何も答えません（完全ではありません）。**イヤホンの使用をおすすめします。**

## 呼びかけ検出（openWakeWord）

- 待機中は、端末内で動く **openWakeWord**（ONNX Runtime）だけがマイクを聞きます。音声は端末の外に出ません。
- 使うモデルは `assets/wakeword/` の3つです。
  - `hey_daily.onnx` … 自分で学習した「hey daily」のモデル（リポジトリに含める）
  - `melspectrogram.onnx` / `embedding_model.onnx` … openWakeWord 公式の共通モデル（CI が自動取得）
- 反応のしやすさは `WakeDetector.kt` の `THRESHOLD`（既定 0.5）。誤反応が多ければ 0.7、反応しなければ 0.35 くらいに。
- モデルを読み込めない場合は、Android の音声認識で「デイリー」を探す簡易検出に自動で切り替わります。

## 端末内AI（Gemma 4 E2B）

Gemini の回数制限や通信なしのときのために、端末内で動く AI（Google AI Edge Gallery と同じ LiteRT-LM）を使えます。

- 「設定」→「端末内AI」→「ダウンロード（Wi-Fi）」で、約2.5GBのモデルを取得します（アプリ専用の領域に保存）。
- 「AIの頭脳」を選びます。
  - **自動**: まず Gemini。使えないときは端末内AIが代わりに答える（おすすめ）
  - **Geminiのみ** / **端末内のみ**（通信なしで動く）
- 端末内AIは、使っていない状態が5分続くとメモリから解放します。初回の読み込みに数秒かかります。
- GPUで動かない端末では、自動でCPUに切り替えます。

## 構成

| パス | 役割 |
| --- | --- |
| `modules/daily-native/.../DailyListenerService.kt` | マイク型フォアグラウンドサービス。呼びかけ → 会話モード → Gemini → 読み上げ（アプリが閉じていても動く） |
| `modules/daily-native/.../WakeDetector.kt` | openWakeWord の推論とマイク監視 |
| `modules/daily-native/.../WakeWord.kt` | 会話中の「デイリー戻って」検出（音声認識結果に対して） |
| `modules/daily-native/.../ThinkingSound.kt` | 考え中の「ポコポコ」音を実行時に合成して鳴らす |
| `modules/daily-native/.../LocalLlm.kt` / `LocalModel.kt` / `Brain.kt` | 端末内AI（LiteRT-LM）の実行 / モデルのダウンロード / 頭脳の選択 |
| `modules/daily-native/.../GeminiClient.kt` / `PromptBuilder.kt` | Gemini API 呼び出し（混雑時は自動再試行）/ 使用状況入りのシステムプロンプト |
| `modules/daily-native/.../UsageCollector.kt` | UsageStatsManager から今日の使用状況を集計 |
| `src/useVoiceChat.ts` / `src/useDailyService.ts` | アプリ画面内の会話 / 常時待機のON/OFF |
| `.github/workflows/android.yml` | APK 自動ビルド |

## 制約・注意

- 常時待機は**アプリを開いた状態でスイッチをONにした時だけ**開始できます。再起動後はもう一度ONにしてください（Android 14 以降の制限）。
- 会話モード中は、Android の音声認識を繰り返し使います。端末によっては認識の開始時に小さな音が鳴ります。Android 13 以降で「日本語のオフライン音声認識」をダウンロードしておくと、音声を端末内で処理できます。
- 考え中・読み上げ中は聞き取りません（割り込みはできません）。
- 通話中や動画撮影中など、他のアプリがマイクを使っている間は聞き取れません。
- APIキーは端末内のアプリ専用領域に保存されます（APKには含まれません）。
