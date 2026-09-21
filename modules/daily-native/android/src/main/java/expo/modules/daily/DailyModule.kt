package expo.modules.daily

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DailyModule : Module() {

  private val thinking = ThinkingSound()

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("Daily")

    // サービス → JS（アプリが開いている間だけ届く）
    Events("onMessage", "onState")

    OnCreate {
      DailyBus.listener = { name, payload -> sendEvent(name, payload) }
    }
    OnDestroy {
      DailyBus.listener = null
      thinking.stop()
    }

    // ---- 使用状況 (UsageStats) ------------------------------------------------
    Function("hasUsagePermission") {
      UsageCollector.hasPermission(context)
    }

    Function("openUsageSettings") {
      openUsageAccessSettings()
    }

    AsyncFunction("getTodayUsage") {
      UsageCollector.collectToday(context).toMap()
    }

    // ---- 常時待機サービス ------------------------------------------------------
    // サービスはアプリが閉じていても読めるよう、設定を端末内の非公開領域に保存する
    Function("setConfig") { apiKey: String, model: String, speak: Boolean, brain: String ->
      context.getSharedPreferences(DailyListenerService.PREFS, Context.MODE_PRIVATE).edit()
        .putString("api_key", apiKey)
        .putString("model", model)
        .putBoolean("speak", speak)
        .putString("brain", brain)
        .apply()
    }

    Function("startService") {
      val ctx = context
      if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        throw IllegalStateException("マイクの許可が必要です")
      }
      val intent = Intent(ctx, DailyListenerService::class.java)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent) else ctx.startService(intent)
      Unit // ComponentName を JS に返さない
    }

    Function("stopService") {
      context.stopService(Intent(context, DailyListenerService::class.java))
    }

    // 「考え中」のポコポコ音（アプリ画面での会話用。サービス側は自前で鳴らす）
    Function("startThinkingSound") {
      thinking.start()
    }

    Function("stopThinkingSound") {
      thinking.stop()
    }

    // ---- 端末内AI（Gemma 4 E2B） ------------------------------------------------
    Function("getLocalModelStatus") {
      LocalModel.status(context)
    }

    Function("startModelDownload") {
      LocalModel.start(context)
    }

    Function("deleteLocalModel") {
      LocalModel.deleteAll(context)
    }

    AsyncFunction("askLocalModel") { systemPrompt: String, history: List<Map<String, String>> ->
      LocalLlm.ask(
        context,
        systemPrompt,
        history.map { GeminiClient.Turn(it["role"] ?: "user", it["text"] ?: "") }
      )
    }

    Function("isServiceRunning") {
      DailyListenerService.running
    }

    Function("setServicePaused") { paused: Boolean ->
      DailyListenerService.setPaused(paused)
    }

    // 電池の最適化の設定画面（除外しておくとロック中も止まりにくい）
    Function("openBatterySettings") {
      val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }
  }

  private fun openUsageAccessSettings() {
    val ctx = context
    val base = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ctx.startActivity(Intent(base).setData(Uri.parse("package:${ctx.packageName}")))
        return
      }
    } catch (e: Exception) {
      // 機種によっては非対応 → 一覧画面にフォールバック
    }
    ctx.startActivity(base)
  }
}
