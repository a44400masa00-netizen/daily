package expo.modules.daily

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import java.util.Calendar

data class AppUse(
  val packageName: String,
  val label: String,
  val totalMs: Long,
  val launchCount: Int,
  val lastUsed: Long
)

data class LaunchRec(val packageName: String, val label: String, val timestamp: Long)

data class TodayUsage(
  val startOfDay: Long,
  val now: Long,
  val totalMs: Long,
  val screenOnCount: Int,
  val unlockCount: Int,
  val apps: List<AppUse>,
  val launches: List<LaunchRec>
) {
  fun toMap(): Map<String, Any> = mapOf(
    "startOfDay" to startOfDay,
    "now" to now,
    "totalMs" to totalMs,
    "screenOnCount" to screenOnCount,
    "unlockCount" to unlockCount,
    "apps" to apps.map {
      mapOf<String, Any>(
        "packageName" to it.packageName,
        "label" to it.label,
        "totalMs" to it.totalMs,
        "launchCount" to it.launchCount,
        "lastUsed" to it.lastUsed
      )
    },
    "launches" to launches.map {
      mapOf<String, Any>(
        "packageName" to it.packageName,
        "label" to it.label,
        "timestamp" to it.timestamp
      )
    }
  )
}

/**
 * UsageStatsManager から「今日」の使用状況を作る。
 * queryEvents のイベント列から使用時間と起動回数を自前で計算する（INTERVAL_DAILY より正確）。
 */
object UsageCollector {

  // UsageEvents.Event の定数値（古い API レベルでも参照できるよう数値で保持）
  private const val EVENT_RESUMED = 1                 // ACTIVITY_RESUMED
  private const val EVENT_PAUSED = 2                  // ACTIVITY_PAUSED
  private const val EVENT_SCREEN_INTERACTIVE = 15     // 画面ON
  private const val EVENT_SCREEN_NON_INTERACTIVE = 16 // 画面OFF
  private const val EVENT_KEYGUARD_HIDDEN = 18        // ロック解除

  @Suppress("DEPRECATION")
  fun hasPermission(ctx: Context): Boolean {
    val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    } else {
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  @Suppress("DEPRECATION")
  private fun resolveLabel(pm: PackageManager, pkg: String): String = try {
    pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
  } catch (e: Exception) {
    pkg
  }

  fun collectToday(ctx: Context): TodayUsage {
    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val pm = ctx.packageManager

    val cal = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    val start = cal.timeInMillis
    val end = System.currentTimeMillis()

    // 集計から除外（このアプリ自身・ホーム画面・システムUI）
    val excluded = HashSet<String>().apply {
      add(ctx.packageName)
      add("com.android.systemui")
      val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
      pm.queryIntentActivities(home, 0).forEach { add(it.activityInfo.packageName) }
    }

    val labels = HashMap<String, String>()
    fun labelOf(pkg: String): String = labels.getOrPut(pkg) { resolveLabel(pm, pkg) }

    val openSince = HashMap<String, Long>()
    val totals = HashMap<String, Long>()
    val launches = HashMap<String, Int>()
    val lastUsed = HashMap<String, Long>()
    val timeline = ArrayList<Pair<String, Long>>()
    var lastForeground: String? = null
    var screenOn = 0
    var unlock = 0

    fun close(pkg: String, ts: Long) {
      val since = openSince.remove(pkg) ?: return
      totals[pkg] = (totals[pkg] ?: 0L) + maxOf(0L, ts - since)
      lastUsed[pkg] = ts
    }

    val events = usm.queryEvents(start, end)
    val e = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      val pkg: String = e.packageName ?: continue
      val ts = e.timeStamp

      when (e.eventType) {
        EVENT_RESUMED -> {
          if (pkg !in excluded) {
            if (!openSince.containsKey(pkg)) openSince[pkg] = ts
            if (pkg != lastForeground) {
              launches[pkg] = (launches[pkg] ?: 0) + 1
              timeline.add(pkg to ts)
            }
            lastUsed[pkg] = ts
          }
          lastForeground = pkg
        }
        EVENT_PAUSED -> close(pkg, ts)
        EVENT_SCREEN_INTERACTIVE -> screenOn++
        EVENT_SCREEN_NON_INTERACTIVE -> openSince.keys.toList().forEach { close(it, ts) }
        EVENT_KEYGUARD_HIDDEN -> unlock++
      }
    }
    openSince.keys.toList().forEach { close(it, end) }

    val ranked = totals.entries.filter { it.value >= 1000L }.sortedByDescending { it.value }
    val totalMs = ranked.sumOf { it.value }

    return TodayUsage(
      startOfDay = start,
      now = end,
      totalMs = totalMs,
      screenOnCount = screenOn,
      unlockCount = unlock,
      apps = ranked.take(30).map { (pkg, ms) ->
        AppUse(pkg, labelOf(pkg), ms, launches[pkg] ?: 0, lastUsed[pkg] ?: 0L)
      },
      launches = timeline.takeLast(40).map { (pkg, ts) -> LaunchRec(pkg, labelOf(pkg), ts) }
    )
  }
}
