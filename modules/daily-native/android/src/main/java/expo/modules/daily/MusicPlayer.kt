package expo.modules.daily

import android.app.SearchManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore

/**
 * 指定した音楽アプリで、指定した曲・アーティストをハンズフリーで再生する。
 * 再生できたかどうかは、そのアプリの再生状態（MediaSession）で確認する。
 * アプリによって対応が違うので、次の方法を順に試す:
 *   1. 「検索して再生」の標準の依頼（MEDIA_PLAY_FROM_SEARCH）
 *   2. そのアプリの検索画面を開いて、アプリの再生機能に「検索して再生」を依頼
 *   3. アプリを開いて、同じく「検索して再生」を依頼
 */
object MusicPlayer {

  class Result(val ok: Boolean, val message: String)

  fun play(ctx: Context, appName: String, query: String): Result {
    if (query.isBlank()) return Result(false, "何を再生するか分かりませんでした。")
    if (!DailyNotificationListener.isEnabled(ctx)) {
      return Result(false, "音楽をハンズフリーで再生するには、アプリの設定で「通知へのアクセス」を許可してください。")
    }
    val name = appName.ifBlank {
      ctx.getSharedPreferences(DailyListenerService.PREFS, Context.MODE_PRIVATE).getString("music_app", "").orEmpty()
    }
    if (name.isBlank()) return Result(false, "音楽アプリが決まっていません。アプリの設定で、使う音楽アプリを入力してください。")
    val app = AppFinder.find(ctx, name) ?: return Result(false, "「$name」というアプリが見つかりませんでした。")
    val pkg = app.packageName
    val pm = ctx.packageManager

    // 1) 標準の「検索して再生」
    val playIntent = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH)
      .setPackage(pkg)
      .putExtra(SearchManager.QUERY, query)
      .putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*") // 曲名・アーティスト名などを区別しない検索
    if (playIntent.resolveActivity(pm) != null) {
      Launcher.start(ctx, playIntent, pkg)
      if (waitPlaying(ctx, pkg, 6_000)) return Result(true, "")
    }

    // 2) 検索画面を開いて、アプリの再生機能に依頼
    searchLink(pkg, query)?.let { link ->
      Launcher.start(ctx, link, pkg)
      if (tryControllerPlay(ctx, pkg, query)) return Result(true, "")
    }

    // 3) アプリを開いて、アプリの再生機能に依頼
    pm.getLaunchIntentForPackage(pkg)?.let { Launcher.start(ctx, it, pkg) }
    if (tryControllerPlay(ctx, pkg, query)) return Result(true, "")

    return Result(false, "${app.label}は開きましたが、自動では再生できませんでした。")
  }

  // ---- 再生状態の確認・操作 -------------------------------------------------------------

  private fun controllers(ctx: Context): List<MediaController> = try {
    val msm = ctx.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    msm.getActiveSessions(ComponentName(ctx, DailyNotificationListener::class.java))
  } catch (e: SecurityException) {
    emptyList()
  }

  private fun waitPlaying(ctx: Context, pkg: String, timeoutMs: Long): Boolean {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      if (controllers(ctx).any { it.packageName == pkg && it.playbackState?.state == PlaybackState.STATE_PLAYING }) {
        return true
      }
      Thread.sleep(500)
    }
    return false
  }

  /** アプリの再生機能（MediaSession）が現れるのを待って、「検索して再生」を依頼する */
  private fun tryControllerPlay(ctx: Context, pkg: String, query: String): Boolean {
    val deadline = System.currentTimeMillis() + 4_000
    var controller: MediaController? = null
    while (System.currentTimeMillis() < deadline) {
      controller = controllers(ctx).firstOrNull { it.packageName == pkg }
      if (controller != null) break
      Thread.sleep(400)
    }
    val c = controller ?: return false
    c.transportControls.playFromSearch(query, Bundle())
    return waitPlaying(ctx, pkg, 5_000)
  }

  private fun searchLink(pkg: String, query: String): Intent? {
    val q = Uri.encode(query)
    val uri = when (pkg) {
      "com.spotify.music" -> "spotify:search:$q"
      "com.google.android.apps.youtube.music" -> "https://music.youtube.com/search?q=$q"
      "com.google.android.youtube" -> "https://www.youtube.com/results?search_query=$q"
      else -> return null
    }
    return Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(pkg)
  }
}
