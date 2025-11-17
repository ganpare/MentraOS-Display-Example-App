// 設定APIエンドポイント
import { Express } from 'express';
import { getUserSettings, saveUserSettings, updateUserSettings, UserMediaSettings, ButtonMapping } from '../services/settings/UserSettings';
import { debugLog, debugError } from '../utils/debug';

export interface SettingsAPIDependencies {
  getAppSessionForUser: (userId: string) => any;
}

export function setupSettingsAPI(
  app: Express,
  deps: SettingsAPIDependencies,
  createAuthMiddlewareForPath: (path: string) => any
): void {
  app.use('/api/settings', createAuthMiddlewareForPath('/api/settings'));

  // ユーザー設定を取得
  app.get('/api/settings/media', (req: any, res: any) => {
    try {
      const userId = (req as any).authUserId;
      debugLog(`[設定API] ユーザーID: ${userId || '未認証'}`);
      
      if (!userId) {
        debugError('[設定API] 認証が必要です');
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      const settings = getUserSettings(userId);
      debugLog(`[設定API] ユーザー設定を取得: ${userId}, actionMappings: ${settings.actionMappings ? Object.keys(settings.actionMappings).length + '件' : 'なし'}`);
      
      res.json({
        success: true,
        settings
      });
    } catch (error: any) {
      debugError('[設定API] ユーザー設定取得エラー:', error);
      res.status(500).json({ success: false, error: error.message || '設定の取得に失敗しました' });
    }
  });

  // ユーザー設定を保存（新形式：actionMappings）
  app.put('/api/settings/media', (req: any, res: any) => {
    try {
      const userId = (req as any).authUserId;
      if (!userId) {
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      const { actionMappings } = req.body || {};
      
      if (!actionMappings || typeof actionMappings !== 'object') {
        return res.status(400).json({ success: false, error: 'actionMappingsが必要です' });
      }

      // 検証：許可されたアクションIDのみ
      const allowedActions = [
        'text_prevBtn', 'text_nextBtn',
        'audio_playBtn', 'audio_pauseBtn', 'audio_skipForwardBtn', 'audio_skipBackwardBtn',
        'audio_nextSubtitleBtn', 'audio_prevSubtitleBtn', 'audio_repeatSubtitleBtn', 'audio_speedBtn'
      ];
      const actionKeys = Object.keys(actionMappings);
      for (const key of actionKeys) {
        if (!allowedActions.includes(key)) {
          return res.status(400).json({ success: false, error: `不正なアクションID: ${key}` });
        }
      }

      const updated = updateUserSettings(userId, actionMappings);
      debugLog(`ユーザー設定を更新: ${userId}`);
      
      res.json({
        success: true,
        settings: updated
      });
    } catch (error: any) {
      debugError('ユーザー設定保存エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 利用可能なアクション一覧を取得（GUIボタン）
  app.get('/api/settings/actions', (req: any, res: any) => {
    const actions = {
      'text_prevBtn': {
        name: '📄 前のページ（テキストリーダー）',
        description: 'テキストリーダーで前のページに移動します',
        category: 'text',
        buttonId: 'prevBtn',
        functionName: 'navigatePage("prevpage", ...)',
        apiEndpoint: '/api/media/event',
        serverActionType: 'text_prevpage',
        implementation: 'textReader.js: prevBtn.addEventListener("click", ...)'
      },
      'text_nextBtn': {
        name: '📄 次のページ（テキストリーダー）',
        description: 'テキストリーダーで次のページに移動します',
        category: 'text',
        buttonId: 'nextBtn',
        functionName: 'navigatePage("nextpage", ...)',
        apiEndpoint: '/api/media/event',
        serverActionType: 'text_nextpage',
        implementation: 'textReader.js: nextBtn.addEventListener("click", ...)'
      },
      'audio_playBtn': {
        name: '▶️ 再生（音声プレーヤー）',
        description: '音声プレーヤーを再生します',
        category: 'audio',
        buttonId: 'playBtn',
        functionName: 'audioElement.play()',
        apiEndpoint: '/api/audio/commands (コマンドキュー)',
        serverActionType: 'audio_play',
        implementation: 'audioPlayer.js: playBtn.addEventListener("click", ...)'
      },
      'audio_pauseBtn': {
        name: '⏸️ 一時停止（音声プレーヤー）',
        description: '音声プレーヤーを一時停止します',
        category: 'audio',
        buttonId: 'pauseBtn',
        functionName: 'audioElement.pause()',
        apiEndpoint: '/api/audio/commands (コマンドキュー)',
        serverActionType: 'audio_pause',
        implementation: 'audioPlayer.js: pauseBtn.addEventListener("click", ...)'
      },
      'audio_skipForwardBtn': {
        name: '⏩ 早送り +10秒（音声プレーヤー）',
        description: '10秒早送りします',
        category: 'audio',
        buttonId: 'skipForwardBtn',
        functionName: 'audioElement.currentTime += 10',
        apiEndpoint: '/api/audio/commands (コマンドキュー: seek)',
        serverActionType: 'audio_skip_forward',
        implementation: 'audioPlayer.js: skipForwardBtn.addEventListener("click", ...)'
      },
      'audio_skipBackwardBtn': {
        name: '⏪ 巻き戻し -10秒（音声プレーヤー）',
        description: '10秒巻き戻しします',
        category: 'audio',
        buttonId: 'skipBackwardBtn',
        functionName: 'audioElement.currentTime -= 10',
        apiEndpoint: '/api/audio/commands (コマンドキュー: seek)',
        serverActionType: 'audio_skip_backward',
        implementation: 'audioPlayer.js: skipBackwardBtn.addEventListener("click", ...)'
      },
      'audio_nextSubtitleBtn': {
        name: '⏭️ 次字幕（音声プレーヤー）',
        description: '次の字幕に移動します',
        category: 'audio',
        buttonId: 'nextSubtitleBtn',
        functionName: 'nextSubtitle()',
        apiEndpoint: '/api/audio/commands (コマンドキュー: next_subtitle)',
        serverActionType: 'audio_next_subtitle',
        implementation: 'audioPlayer.js: nextSubtitleBtn.addEventListener("click", ...)'
      },
      'audio_prevSubtitleBtn': {
        name: '⏮️ 前字幕（音声プレーヤー）',
        description: '前の字幕に移動します',
        category: 'audio',
        buttonId: 'prevSubtitleBtn',
        functionName: 'prevSubtitle()',
        apiEndpoint: '/api/audio/commands (コマンドキュー: prev_subtitle)',
        serverActionType: 'audio_prev_subtitle',
        implementation: 'audioPlayer.js: prevSubtitleBtn.addEventListener("click", ...)'
      },
      'audio_repeatSubtitleBtn': {
        name: '🔁 リピート（音声プレーヤー）',
        description: 'リピートモードを切り替えます',
        category: 'audio',
        buttonId: 'repeatSubtitleBtn',
        functionName: 'toggleRepeat() → /api/audio/repeat',
        apiEndpoint: '/api/audio/repeat',
        serverActionType: 'audio_repeat',
        implementation: 'audioPlayer.js: repeatSubtitleBtn.addEventListener("click", ...)'
      },
      'audio_speedBtn': {
        name: '⚡ 速度変更（音声プレーヤー）',
        description: '再生速度を変更します',
        category: 'audio',
        buttonId: 'speedBtn',
        functionName: 'changeSpeed() → /api/audio/speed',
        apiEndpoint: '/api/audio/speed',
        serverActionType: 'audio_speed',
        implementation: 'audioPlayer.js: speedBtn.addEventListener("click", ...)'
      }
    };

    res.json({
      success: true,
      actions
    });
  });

  // 利用可能なトリガー一覧を取得（Bluetoothボタン）
  app.get('/api/settings/triggers', (req: any, res: any) => {
    const triggers = {
      'playpause': {
        name: '⏯️ 再生/一時停止ボタン',
        description: '再生/一時停止ボタン（シングル/ダブルクリック）'
      },
      'nexttrack': {
        name: '⏭️ 次の曲ボタン',
        description: '次の曲ボタン（シングル/ダブルクリック）'
      },
      'prevtrack': {
        name: '⏮️ 前の曲ボタン',
        description: '前の曲ボタン（シングル/ダブルクリック）'
      },
      'none': {
        name: 'なし',
        description: 'トリガーを割り当てない'
      }
    };

    res.json({
      success: true,
      triggers
    });
  });
}

