package expo.modules.daily

import android.content.Intent
import android.provider.AlarmClock
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DailyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("Daily")

    // React Native側（App.tsx）から設定を受け取ってPromptBuilderの変数を更新する関数
    Function("updateAiSettings") { name: String, tone: String ->
        PromptBuilder.userNameSetting = name
        PromptBuilder.toneSetting = tone
    }

    // タイマーを設定する関数
    Function("setTimer") { seconds: Int, message: String ->
        val intent = Intent(AlarmClock.ACTION_SET_TIMER).apply {
            putExtra(AlarmClock.EXTRA_MESSAGE, message)
            putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        appContext.reactContext?.startActivity(intent)
    }

    // アラームを設定する関数
    Function("setAlarm") { hour: Int, minute: Int, message: String ->
        val intent = Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, hour)
            putExtra(AlarmClock.EXTRA_MINUTES, minute)
            putExtra(AlarmClock.EXTRA_MESSAGE, message)
            putExtra(AlarmClock.EXTRA_SKIP_UI, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        appContext.reactContext?.startActivity(intent)
    }

    // バッテリー（省電力）設定画面を開く関数
    Function("openBatterySettings") {
        val intent = Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        appContext.reactContext?.startActivity(intent)
    }
  }
}
