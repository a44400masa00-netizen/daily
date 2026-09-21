package expo.modules.daily

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import org.json.JSONObject
import java.util.Locale

/**
 * AI の返事に含まれる操作 [[ACTION:名前 {...}]] を取り出して、スマホの操作として実行する。
 * 成否は端末で確認し、失敗したときは AI の文章ではなく、失敗の理由を読み上げる。
 */
object PhoneActions {

  private const val SECURE_SETTINGS = "android.permission.WRITE_SECURE_SETTINGS"
  private const val CHANNEL_ID = "daily_actions"

  private val TAG_REGEX = Regex("\\[\\[ACTION:([a-z_]+)\\s*(\\{.*?\\})?\\s*\\]\\]", RegexOption.DOT_MATCHES_ALL)

  private class Outcome(val ok: Boolean, val message: String, val note: String? = null)

  private fun ok(note: String? = null) = Outcome(true, "ok", note)
  private fun fail(message: String) = Outcome(false, message)

  /** 返事から操作を取り除き、実行して、読み上げる文章を返す */
  fun process(ctx: Context, reply: String): String {
    val matches = TAG_REGEX.findAll(reply).toList()
    if (matches.isEmpty()) return reply.trim()

    val text = TAG_REGEX.replace(reply, "").trim()
    val failures = ArrayList<String>()
    val notes = ArrayList<String>()

    for (m in matches) {
      val name = m.groupValues[1]
      val args = try {
        JSONObject(m.groupValues[2].ifBlank { "{}" })
      } catch (e: Exception) {
        JSONObject()
      }
      val outcome = try {
        execute(ctx, name, args)
      } catch (e: SecurityException) {
        fail("この操作の許可がありません。アプリの設定の「スマホの操作」を確認してください。")
      } catch (e: Throwable) {
        fail("操作に失敗しました。")
      }
      if (!outcome.ok) failures.add(outcome.message) else outcome.note?.let { notes.add(it) }
    }

    if (failures.isNotEmpty()) return failures.joinToString(" ")
    val spoken = (listOf(text) + notes).filter { it.isNotBlank() }.joinToString(" ")
    return spoken.ifBlank { "はい、やりました。" }
  }

  private fun execute(ctx: Context, name: String, args: JSONObject): Outcome = when (name) {
    "set_timer" -> setTimer(ctx, args)
    "set_alarm" -> setAlarm(ctx, args)
    "cancel_timers" -> {
      Alarms.cancelAll(ctx, "timer")
      ok()
    }
    "cancel_alarms" -> {
      Alarms.cancelAll(ctx, "alarm")
      ok()
    }
    "stop_ringing" -> {
      AlarmRingService.stop(ctx)
      ok()
    }
    "flashlight" -> flashlight(ctx, args.optBoolean("on", true))
    "volume" -> volume(ctx, args)
    "brightness" -> brightness(ctx, args)
    "battery_saver" -> batterySaver(ctx, args.optBoolean("on", true))
    "do_not_disturb" -> doNotDisturb(ctx, args.optBoolean("on", true))
    "ringer_mode" -> ringerMode(ctx, args.optString("mode", "normal"))
    "open_app" -> openApp(ctx, args.optString("name", ""))
    "open_settings" -> openSettings(ctx, args.optString("screen", "other"))
    else -> fail("その操作にはまだ対応していません。")
  }

  // ---- タイマー・アラーム ---------------------------------------------------------

  private fun setTimer(ctx: Context, args: JSONObject): Outcome {
    val seconds = args.optLong("seconds", 0L)
    if (seconds < 1 || seconds > 24 * 3600L) return fail("タイマーの時間が分かりませんでした。")
    val err = Alarms.schedule(ctx, "timer", System.currentTimeMillis() + seconds * 1000, args.optString("label", ""))
    return if (err != null) fail(err) else ok()
  }

  private fun setAlarm(ctx: Context, args: JSONObject): Outcome {
    val hour = args.optInt("hour", -1)
    val minute = args.optInt("minute", 0)
    if (hour !in 0..23 || minute !in 0..59) return fail("アラームの時刻が分かりませんでした。")
    val err = Alarms.schedule(ctx, "alarm", Alarms.nextTimeMillis(hour, minute), args.optString("label", ""))
    return if (err != null) fail(err) else ok()
  }

  // ---- ライト・音量・明るさ ---------------------------------------------------------

  private fun flashlight(ctx: Context, on: Boolean): Outcome {
    val cm = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    val id = cm.cameraIdList.firstOrNull {
      cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
    } ?: return fail("この端末にはライトが見つかりませんでした。")
    return try {
      cm.setTorchMode(id, on)
      ok()
    } catch (e: Exception) {
      fail("ライトを操作できませんでした。他のアプリがカメラを使っているかもしれません。")
    }
  }

  private fun volume(ctx: Context, args: JSONObject): Outcome {
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val stream = when (args.optString("stream", "media")) {
      "ring" -> AudioManager.STREAM_RING
      "alarm" -> AudioManager.STREAM_ALARM
      else -> AudioManager.STREAM_MUSIC
    }
    val max = am.getStreamMaxVolume(stream)
    val step = maxOf(1, max / 5)
    val target = when {
      args.has("percent") -> Math.round(args.optDouble("percent") / 100.0 * max).toInt()
      args.optString("delta") == "up" -> am.getStreamVolume(stream) + step
      args.optString("delta") == "down" -> am.getStreamVolume(stream) - step
      else -> return fail("音量の指定が分かりませんでした。")
    }
    am.setStreamVolume(stream, target.coerceIn(0, max), 0)
    return ok()
  }

  private fun brightness(ctx: Context, args: JSONObject): Outcome {
    if (!Settings.System.canWrite(ctx)) {
      return fail("画面の明るさを変えるには、アプリの設定の「スマホの操作」で「システム設定の変更」を許可してください。")
    }
    val percent = args.optInt("percent", -1)
    if (percent !in 0..100) return fail("明るさの指定が分かりませんでした。")
    val value = (percent * 255 / 100).coerceIn(1, 255)
    Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
    Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS, value)
    return ok()
  }

  // ---- 電力モード・おやすみモード・マナーモード ------------------------------------------

  private fun batterySaver(ctx: Context, on: Boolean): Outcome {
    if (ctx.checkSelfPermission(SECURE_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
      return fail("電力モードの切り替えには、パソコンからの一度きりの許可設定が必要です。アプリの設定の「スマホの操作」を見てください。")
    }
    Settings.Global.putInt(ctx.contentResolver, "low_power", if (on) 1 else 0)
    Thread.sleep(800) // 反映を待って、本当に切り替わったか確認する（呼び出し元はバックグラウンドスレッド）
    val actual = (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode
    return if (actual == on) ok() else fail("電力モードを切り替えられませんでした。")
  }

  private fun doNotDisturb(ctx: Context, on: Boolean): Outcome {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!nm.isNotificationPolicyAccessGranted) {
      return fail("おやすみモードを切り替えるには、アプリの設定の「スマホの操作」で通知ポリシーへのアクセスを許可してください。")
    }
    nm.setInterruptionFilter(
      if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL
    )
    return ok()
  }

  private fun ringerMode(ctx: Context, mode: String): Outcome {
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val target = when (mode) {
      "vibrate" -> AudioManager.RINGER_MODE_VIBRATE
      "silent" -> AudioManager.RINGER_MODE_SILENT
      else -> AudioManager.RINGER_MODE_NORMAL
    }
    if (target == AudioManager.RINGER_MODE_SILENT && !nm.isNotificationPolicyAccessGranted) {
      return fail("マナーモード（無音）にするには、アプリの設定の「スマホの操作」で通知ポリシーへのアクセスを許可してください。")
    }
    am.ringerMode = target
    return ok()
  }

  // ---- アプリ・設定画面を開く（通知をタップして開く） ---------------------------------------

  private fun normalize(s: String): String = s.lowercase(Locale.ROOT).filter { it.isLetterOrDigit() }

  private fun openApp(ctx: Context, name: String): Outcome {
    val target = normalize(name)
    if (target.isEmpty()) return fail("開くアプリの名前が分かりませんでした。")
    val pm = ctx.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val found = pm.queryIntentActivities(launcher, 0).firstOrNull {
      val label = normalize(it.loadLabel(pm).toString())
      label.isNotEmpty() && (label.contains(target) || target.contains(label))
    } ?: return fail("「$name」というアプリが見つかりませんでした。")

    val label = found.loadLabel(pm).toString()
    val intent = pm.getLaunchIntentForPackage(found.activityInfo.packageName)
      ?: return fail("「$label」を開けませんでした。")
    postOpenNotification(ctx, "$label を開く", "タップすると開きます", intent)
    return ok("画面の通知をタップすると、${label}が開きます。")
  }

  private fun openSettings(ctx: Context, screen: String): Outcome {
    val (action, label) = when (screen) {
      "wifi" -> Settings.ACTION_WIFI_SETTINGS to "Wi-Fi"
      "bluetooth" -> Settings.ACTION_BLUETOOTH_SETTINGS to "Bluetooth"
      "airplane" -> Settings.ACTION_AIRPLANE_MODE_SETTINGS to "機内モード"
      "display" -> Settings.ACTION_DISPLAY_SETTINGS to "画面"
      "sound" -> Settings.ACTION_SOUND_SETTINGS to "音"
      "battery" -> Settings.ACTION_BATTERY_SAVER_SETTINGS to "電力モード"
      "location" -> Settings.ACTION_LOCATION_SOURCE_SETTINGS to "位置情報"
      "mobile" -> Settings.ACTION_NETWORK_OPERATOR_SETTINGS to "モバイル通信"
      else -> Settings.ACTION_SETTINGS to "設定"
    }
    postOpenNotification(ctx, "${label}の設定を開く", "タップすると開きます", Intent(action))
    return ok("画面の通知をタップすると、${label}の設定が開きます。")
  }

  /**
   * バックグラウンドからは画面を直接開けない（Android の制限）ので、タップして開く通知を出す。
   */
  private fun postOpenNotification(ctx: Context, title: String, text: String, intent: Intent) {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "デイリーの操作", NotificationManager.IMPORTANCE_HIGH))
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val pi = PendingIntent.getActivity(
      ctx, (System.currentTimeMillis() % 100_000).toInt(), intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val n = android.app.Notification.Builder(ctx, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_menu_view)
      .setContentIntent(pi)
      .setFullScreenIntent(pi, true)
      .setAutoCancel(true)
      .build()
    nm.notify((System.currentTimeMillis() % 100_000).toInt() + 5000, n)
  }

  // ---- 設定画面に出す、許可の状態 -------------------------------------------------------

  fun controlStatus(ctx: Context): Map<String, Boolean> {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return mapOf(
      "writeSettings" to Settings.System.canWrite(ctx),
      "notificationPolicy" to nm.isNotificationPolicyAccessGranted,
      "secureSettings" to (ctx.checkSelfPermission(SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED),
      "exactAlarm" to am.canScheduleExactAlarms()
    )
  }

  fun openControlSettings(ctx: Context, kind: String) {
    val pkg = Uri.parse("package:${ctx.packageName}")
    val intent = when (kind) {
      "writeSettings" -> Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, pkg)
      "notificationPolicy" -> Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
      "exactAlarm" -> Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg)
      else -> return
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(intent)
  }
}
