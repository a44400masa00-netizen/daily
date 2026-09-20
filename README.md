# デイリー（Expo / Android）

「デイリー」または「ヘイデイリー」と呼びかけると Gemini が答える音声AIアシスタントです。
アプリを閉じていても、画面ロック中でも、InstagramやLINEを見ながらでも呼び出せます。
Android の UsageStats（使用履歴）から今日のスマホ使用状況を把握し、会話の中でアドバイスします。

## 使い方

1. GitHub に push（`main`）→ Actions「Build Android APK」→ Artifacts の **daily-apk** から APK をダウンロードして端末へ
2. アプリを開き、右上「設定」で次を入力
   - **Gemini API キー**（必須）: https://aistudio.google.com/apikey
   - **Picovoice AccessKey**（推奨）: https://console.picovoice.ai/ で無料発行。呼びかけの検出が専用エンジンになります
3. 上部の「許可する」→ 設定画面で **デイリー** を ON（使用状況へのアクセス）
4. 「「デイリー」で呼び出す」のスイッチを ON（マイクと通知を許可。**初回はネット接続が必要**）
5. 「電池の最適化から除外する」を開き、デイリーを「制限なし」にする
6. 「デイリー」→ 合図音 → 「今日どれくらいスマホ使ってる？」

## 呼びかけ検出の仕組み

| 状態 | 動作 |
| --- | --- |
| Picovoice AccessKey あり | 待機中は **Porcupine（端末内の専用エンジン）** だけがマイクを聞く。音声は端末の外に出ない。検出したら合図音 → Android の音声認識で指示を聞き取る |
| AccessKey なし / 準備失敗 | 簡易モード: Android の音声認識を繰り返して「デイリー」を探す（電池消費・誤反応・通信が増える） |

- 待機語は **日本語モデルで「デイリー」「ヘイ デイリー」**、**英語モデルで "hey daily"** を用意します。
- 待機語ファイル(.ppn)は、AccessKey を使って Picovoice のサーバーで**フレーズから学習し、端末内に保存**します（初回のみ通信）。
  期限切れなどで読み込めなくなった場合は、次の起動時に自動で作り直します。
- 日本語モデル(`porcupine_params_ja.pv`)は `scripts/fetch-porcupine-model.sh` が取得して assets に置きます（CI では自動）。
  ローカルでビルドするときは、`npx expo prebuild` の前に一度実行してください。

## 構成

| パス | 役割 |
| --- | --- |
| `modules/daily-native/.../DailyListenerService.kt` | マイク型フォアグラウンドサービス。待機 → 指示 → Gemini → 読み上げ（アプリが閉じていても動く） |
| `modules/daily-native/.../WakeDetector.kt` | Porcupine の準備（待機語の学習・保存）とマイク監視 |
| `modules/daily-native/.../WakeWord.kt` | 簡易モード用の「デイリー」文字列検出 |
| `modules/daily-native/.../GeminiClient.kt` / `PromptBuilder.kt` | Gemini API 呼び出し / 使用状況入りのシステムプロンプト |
| `modules/daily-native/.../UsageCollector.kt` | UsageStatsManager から今日の使用状況を集計 |
| `src/useVoiceChat.ts` / `src/useDailyService.ts` | アプリ画面内の会話 / 常時待機のON/OFF |
| `.github/workflows/android.yml` | APK 自動ビルド |

## 制約・注意

- 常時待機は**アプリを開いた状態でスイッチをONにした時だけ**開始できます。端末を再起動したら、もう一度アプリを開いてONにしてください（Android 14 以降の制限）。
- 「デイリー」と言ってから**合図音を待って**話してください（呼びかけと同じ息で続けた部分は聞き取れません）。
- 通話中や動画撮影中など、他のアプリがマイクを使っている間は聞き取れません。
- Picovoice のカスタム待機語には、学習回数・期間・利用範囲（商用利用など）の制限があります。個人利用の範囲で使い、プランの条件は Picovoice Console で確認してください。
- 「デイリー」は普通の単語でもあるため、簡易モードでは会話中に偶然反応することがあります。
- APIキーは端末内のアプリ専用領域に保存されます（APKには含まれません）。
