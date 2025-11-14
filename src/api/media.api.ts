// メディアコントローラーAPIエンドポイント
import { AppSession, ViewType } from '@mentra/sdk';
import { Express } from 'express';
import { TextPager } from '../services/text/TextPager';
import { displayCurrentPage } from './file.api';
import { getUserSettings, convertActionMappingsToButtonMappings } from '../services/settings/UserSettings';
import { debugLog, debugError } from '../utils/debug';

interface MediaEventHistoryEntry {
  userId: string;
  eventType: string;
  timestamp: number;
  source?: string;
  isDoubleClick?: boolean;
  interval?: number;
  seekType?: number;
}

export interface MediaAPIDependencies {
  sessions: Map<string, AppSession>;
  userIdToSessionId: Map<string, string>;
  sessionPagers: Map<string, TextPager>;
  getAppSessionForUser: (userId: string) => AppSession | null;
  mediaEventHistory?: Array<MediaEventHistoryEntry>;
  // 音声プレーヤー制御用（オプション）
  sessionCommandQueues?: Map<string, Array<{ type: 'seek' | 'speed' | 'play' | 'pause' | 'next' | 'prev'; value?: number; timestamp: number }>>;
  sessionPlaybackStates?: Map<string, { currentSubtitleIndex: number; currentTime: number; lastUpdateTime: number }>;
  getUserIdFromSession?: (session: AppSession) => string | null;
}

// アクションを実行する関数
async function executeAction(
  actionType: string,
  actionValue: number | undefined,
  session: AppSession,
  sessionId: string,
  sessionPagers: Map<string, TextPager>,
  deps?: MediaAPIDependencies
): Promise<void> {
  debugLog(`アクション実行: ${actionType}, value: ${actionValue}`);
  
  switch (actionType) {
    case 'text_nextpage': {
      const pager = sessionPagers.get(sessionId);
      if (!pager) {
        session.layouts.showTextWall('テキストがアップロードされていません', {
          view: ViewType.MAIN,
          durationMs: 3000
        });
        return;
      }
      const moved = pager.nextPage();
      if (!moved) {
        session.layouts.showTextWall('最後のページです', {
          view: ViewType.MAIN,
          durationMs: 2000
        });
        return;
      }
      await displayCurrentPage(session, sessionId, sessionPagers);
      break;
    }
    
    case 'text_prevpage': {
      const pager = sessionPagers.get(sessionId);
      if (!pager) {
        session.layouts.showTextWall('テキストがアップロードされていません', {
          view: ViewType.MAIN,
          durationMs: 3000
        });
        return;
      }
      const moved = pager.prevPage();
      if (!moved) {
        session.layouts.showTextWall('最初のページです', {
          view: ViewType.MAIN,
          durationMs: 2000
        });
        return;
      }
      await displayCurrentPage(session, sessionId, sessionPagers);
      break;
    }
    
    case 'audio_play':
    case 'audio_pause':
    case 'audio_next':
    case 'audio_prev':
    case 'audio_skip_forward':
    case 'audio_skip_backward':
    case 'audio_next_subtitle':
    case 'audio_prev_subtitle':
    case 'audio_repeat':
    case 'audio_speed': {
      // 音声プレーヤー制御はコマンドキューを使用
      if (!deps?.sessionCommandQueues) {
        debugError('音声プレーヤー制御キューが利用できません');
        return;
      }
      
      const commandQueue = deps.sessionCommandQueues.get(sessionId) || [];
      
      if (actionType === 'audio_skip_forward' || actionType === 'audio_skip_backward') {
        // 現在の再生位置を取得
        const playbackState = deps.sessionPlaybackStates?.get(sessionId);
        const currentTime = playbackState?.currentTime || 0;
        const skipSeconds = actionValue || 10;
        const newTime = actionType === 'audio_skip_forward' 
          ? currentTime + skipSeconds 
          : Math.max(0, currentTime - skipSeconds);
        
        commandQueue.push({
          type: 'seek',
          value: newTime,
          timestamp: Date.now()
        });
        debugLog(`音声シーク: ${currentTime}s → ${newTime}s (${actionType === 'audio_skip_forward' ? '+' : '-'}${skipSeconds}s)`);
      } else {
        // 再生/一時停止/次のトラック/前のトラック/字幕制御/リピート/速度変更はコマンドキューに追加
        // クライアント側のaudioPlayer.jsがポーリングで取得して処理
        const commandType = actionType === 'audio_play' ? 'play' :
                          actionType === 'audio_pause' ? 'pause' :
                          actionType === 'audio_next' ? 'next' :
                          actionType === 'audio_prev' ? 'prev' :
                          actionType === 'audio_next_subtitle' ? 'next_subtitle' :
                          actionType === 'audio_prev_subtitle' ? 'prev_subtitle' :
                          actionType === 'audio_repeat' ? 'repeat' :
                          actionType === 'audio_speed' ? 'speed' : null;
        
        if (commandType) {
          // ControlCommand形式に合わせて拡張
          (commandQueue as any[]).push({
            type: commandType,
            timestamp: Date.now()
          });
          debugLog(`音声制御コマンド追加: ${commandType}`);
        } else {
          const messages: Record<string, string> = {
            'audio_play': '再生',
            'audio_pause': '一時停止',
            'audio_next': '次のトラック',
            'audio_prev': '前のトラック',
            'audio_next_subtitle': '次字幕',
            'audio_prev_subtitle': '前字幕',
            'audio_repeat': 'リピート',
            'audio_speed': '速度変更'
          };
          session.layouts.showTextWall(`${messages[actionType] || actionType} ⏯️`, {
            view: ViewType.MAIN,
            durationMs: 2000
          });
        }
      }
      
      deps.sessionCommandQueues.set(sessionId, commandQueue);
      break;
    }
    
    case 'none':
      // 何もしない
      break;
    
    default:
      debugError(`未知のアクションタイプ: ${actionType}`);
  }
}

async function handleMediaEvent(
  session: AppSession,
  eventType: string,
  sessionPagers: Map<string, TextPager>,
  sessions: Map<string, AppSession>,
  options: {
    isDoubleClick?: boolean;
    interval?: number;
    seekType?: number;
    userId?: string;
    currentPage?: string; // 現在のページ情報（'textReader', 'audioPlayer', 'top', etc.）
    deps?: MediaAPIDependencies;
  } = {}
): Promise<void> {
  const eventTypeLower = eventType.toLowerCase().trim();
  const currentPage = options.currentPage || 'top';
  debugLog(`メディアイベント受信: ${eventType} (${eventTypeLower}), 現在のページ: ${currentPage}`);

  let sessionId: string | undefined;
  for (const [id, s] of sessions.entries()) {
    if (s === session) {
      sessionId = id;
      break;
    }
  }

  if (!sessionId) {
    debugError('セッションIDが見つかりません');
    return;
  }

  // ユーザーIDを取得
  let userId: string | null = options.userId || null;
  if (!userId && options.deps?.getUserIdFromSession) {
    userId = options.deps.getUserIdFromSession(session);
  }
  if (!userId) {
    // userIdToSessionIdから逆引き
    if (options.deps?.userIdToSessionId) {
      for (const [uid, sid] of options.deps.userIdToSessionId.entries()) {
        if (sid === sessionId) {
          userId = uid;
          break;
        }
      }
    }
  }

  // ユーザー設定を読み込む
  let userSettings = null;
  if (userId) {
    try {
      userSettings = getUserSettings(userId);
      debugLog(`ユーザー設定を読み込み: ${userId}`);
    } catch (error: any) {
      debugError(`ユーザー設定の読み込みエラー:`, error);
    }
  }

  if (options.isDoubleClick) {
    debugLog(`ダブルクリックイベントとして処理: eventType=${eventTypeLower}`);
  }

  // 現在のページに基づいてアクションを決定
  if (userSettings && userSettings.actionMappings && ['playpause', 'nexttrack', 'prevtrack'].includes(eventTypeLower)) {
    // 現在のページに応じてアクションをフィルタリング
    const pageActionPrefix = currentPage === 'textReader' ? 'text_' : 
                             currentPage === 'audioPlayer' ? 'audio_' : null;
    
    if (pageActionPrefix) {
      const clickType = options.isDoubleClick ? 'double' : 'single';
      
      // 該当するページのアクションのみを検索
      for (const [actionId, mapping] of Object.entries(userSettings.actionMappings)) {
        if (!mapping) continue;
        
        // 現在のページに属するアクションのみをチェック
        if (!actionId.startsWith(pageActionPrefix)) continue;
        
        const triggerMapping = mapping[clickType];
        if (triggerMapping && triggerMapping.trigger === eventTypeLower) {
          // アクションIDをアクションタイプに変換
          const actionTypeMap: Record<string, string> = {
            'text_prevBtn': 'text_prevpage',
            'text_nextBtn': 'text_nextpage',
            'audio_playBtn': 'audio_play',
            'audio_pauseBtn': 'audio_pause',
            'audio_skipForwardBtn': 'audio_skip_forward',
            'audio_skipBackwardBtn': 'audio_skip_backward',
            'audio_nextSubtitleBtn': 'audio_next_subtitle',
            'audio_prevSubtitleBtn': 'audio_prev_subtitle',
            'audio_repeatSubtitleBtn': 'audio_repeat',
            'audio_speedBtn': 'audio_speed'
          };
          
          const actionType = actionTypeMap[actionId];
          if (actionType) {
            debugLog(`設定に基づいて動作を実行: ${actionType} (アクションID: ${actionId}, ページ: ${currentPage}, ${clickType})`);
            
            // アクションを実行
            await executeAction(actionType, undefined, session, sessionId, sessionPagers, options.deps);
            return;
          }
        }
      }
    }
    
    debugLog(`現在のページ（${currentPage}）で対応するアクションが見つかりませんでした`);
  }
  
  // 旧形式の設定フォールバック（後方互換性）
  if (userSettings && ['playpause', 'nexttrack', 'prevtrack'].includes(eventTypeLower)) {
    let buttonMapping = userSettings.mappings?.[eventTypeLower as 'playpause' | 'nexttrack' | 'prevtrack'];
    
    if (buttonMapping) {
      const action = options.isDoubleClick ? buttonMapping.double : buttonMapping.single;
      
      if (action.type !== 'none') {
        debugLog(`設定に基づいて動作を実行（旧形式）: ${action.type} (${options.isDoubleClick ? 'double' : 'single'})`);
        
        // 設定に基づいて動作を実行
        await executeAction(action.type, action.value, session, sessionId, sessionPagers, options.deps);
        return;
      }
    }
  }

  // デフォルト動作（従来の処理）
  if (eventTypeLower === 'nextpage' || eventTypeLower === 'prevpage') {
    debugLog(`ページング処理開始: eventType=${eventTypeLower}`);
    const pager = sessionPagers.get(sessionId);
    
    if (!pager) {
      debugError('TextPagerが見つかりません');
      session.layouts.showTextWall('テキストがアップロードされていません', {
        view: ViewType.MAIN,
        durationMs: 3000
      });
      return;
    }

    let moved = false;
    if (eventTypeLower === 'nextpage') {
      moved = pager.nextPage();
      if (!moved) {
        session.layouts.showTextWall('最後のページです', {
          view: ViewType.MAIN,
          durationMs: 2000
        });
        return;
      }
    } else if (eventTypeLower === 'prevpage') {
      moved = pager.prevPage();
      if (!moved) {
        session.layouts.showTextWall('最初のページです', {
          view: ViewType.MAIN,
          durationMs: 2000
        });
        return;
      }
    }

    await displayCurrentPage(session, sessionId, sessionPagers);
    return;
  }

  const eventMessages: Record<string, string> = {
    'play': '再生ボタンが押されました ▶️',
    'pause': '一時停止ボタンが押されました ⏸️',
    'stop': '停止ボタンが押されました ⏹️',
    'playpause': options.isDoubleClick
      ? '再生/一時停止ボタンがダブルクリックされました ⏯️⏯️'
      : '再生/一時停止ボタンが押されました ⏯️',
    'nexttrack': '次の曲ボタンが押されました ⏭️',
    'prevtrack': '前の曲ボタンが押されました ⏮️',
    'skipforward': options.interval
      ? `早送りボタン（${options.interval}秒）が押されました ⏩`
      : '早送りボタンが押されました ⏩',
    'skipbackward': options.interval
      ? `巻き戻しボタン（${options.interval}秒）が押されました ⏪`
      : '巻き戻しボタンが押されました ⏪',
  };

  const message = eventMessages[eventTypeLower] || `${eventType}ボタンが押されました`;
  debugLog(`[メディアイベント] ${eventType}: ${message}`);

  session.layouts.showTextWall(message, {
    view: ViewType.MAIN,
    durationMs: 5000
  });

  session.layouts.showTextWall(message, {
    view: ViewType.DASHBOARD,
    durationMs: 5000
  });
}

export function setupMediaControllerAPI(
  app: Express,
  deps: MediaAPIDependencies,
  createAuthMiddlewareForPath: (path: string) => any
): void {
  app.use('/api/media', createAuthMiddlewareForPath('/api/media'));

  // 最新のメディアイベント履歴を取得
  app.get('/api/media/events/history', (req: any, res: any) => {
    try {
      const userId = (req as any).authUserId;
      if (!userId) {
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      if (!deps.mediaEventHistory) {
        return res.json({ success: true, events: [] });
      }

      // 該当ユーザーの最新イベントを取得（最新20件）
      const userEvents = deps.mediaEventHistory
        .filter(e => e.userId === userId)
        .slice(-20)
        .reverse();

      res.json({ 
        success: true, 
        events: userEvents 
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/media/events', (req: any, res: any) => {
    const supportedEvents = {
      'nextpage': {
        name: '次へ',
        description: '次のページに移動します',
        action: 'ページング処理（サーバー側でTextPagerを操作）'
      },
      'prevpage': {
        name: '前へ',
        description: '前のページに移動します',
        action: 'ページング処理（サーバー側でTextPagerを操作）'
      },
      'play': {
        name: '再生',
        description: '再生ボタンが押されました',
        action: 'メッセージ表示'
      },
      'pause': {
        name: '一時停止',
        description: '一時停止ボタンが押されました',
        action: 'メッセージ表示'
      },
      'stop': {
        name: '停止',
        description: '停止ボタンが押されました',
        action: 'メッセージ表示'
      },
      'playpause': {
        name: '再生/一時停止',
        description: '再生/一時停止ボタンが押されました',
        action: 'メッセージ表示'
      },
      'nexttrack': {
        name: '次の曲',
        description: '次の曲ボタンが押されました',
        action: 'メッセージ表示'
      },
      'prevtrack': {
        name: '前の曲',
        description: '前の曲ボタンが押されました',
        action: 'メッセージ表示'
      },
      'skipforward': {
        name: '早送り',
        description: '早送りボタンが押されました',
        action: 'メッセージ表示'
      },
      'skipbackward': {
        name: '巻き戻し',
        description: '巻き戻しボタンが押されました',
        action: 'メッセージ表示'
      }
    };

    res.json({
      success: true,
      events: supportedEvents,
      totalEvents: Object.keys(supportedEvents).length,
      note: 'nextpageとprevpageはページング処理を行います。その他のイベントはメッセージを表示します。'
    });
  });

  app.post('/api/media/event', async (req: any, res: any) => {
    try {
      debugLog('/api/media/event リクエスト受信');
      
      const userId = (req as any).authUserId;
      const {
        eventType,
        event,
        isDoubleClick = false,
        interval,
        seekType,
        source,
        timestamp,
        currentPage // 現在のページ情報（'textReader', 'audioPlayer', 'top', etc.）
      } = req.body || {};
      let sessionId: string | undefined;
      let session: AppSession | undefined;

      if (userId) {
        debugLog('Webview認証成功: userId=', userId);
        sessionId = deps.userIdToSessionId.get(userId);
        if (sessionId) {
          session = deps.sessions.get(sessionId);
        }
      } else {
        debugLog('Webview認証なし、セッションIDから検索');
        sessionId = req.body.sessionId || req.query.sessionId;
        if (sessionId) {
          session = deps.sessions.get(sessionId);
        }
      }

      if (!session) {
        debugError('セッションが見つかりません');
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      const resolvedEventType = eventType || event;

      if (!resolvedEventType) {
        debugError('eventTypeが指定されていません');
        return res.status(400).json({ success: false, error: 'eventTypeが必要です' });
      }

      debugLog(`メディアイベント処理開始: eventType=${resolvedEventType}, currentPage=${currentPage || '不明'}`);
      await handleMediaEvent(
        session,
        resolvedEventType,
        deps.sessionPagers,
        deps.sessions,
        {
          isDoubleClick,
          interval: typeof interval === 'number' ? interval : undefined,
          seekType: typeof seekType === 'number' ? seekType : undefined,
          userId: userId || undefined,
          currentPage: currentPage || undefined,
          deps: deps
        }
      );

      let pageInfo: { currentPage: number; totalPages: number; pageInfo: string } | null = null;
      if (resolvedEventType.toLowerCase() === 'nextpage' || resolvedEventType.toLowerCase() === 'prevpage') {
        const pager = deps.sessionPagers.get(sessionId!);
        if (pager) {
          pageInfo = {
            currentPage: pager.getCurrentPageNumber(),
            totalPages: pager.getTotalPages(),
            pageInfo: pager.getPageInfo()
          };
        }
      }

      // イベント履歴に記録（webviewで表示するため）
      if (deps.mediaEventHistory && userId) {
        deps.mediaEventHistory.push({
          userId,
          eventType: resolvedEventType,
          timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
          source: source || 'webview',
          isDoubleClick: Boolean(isDoubleClick),
          interval: typeof interval === 'number' ? interval : undefined,
          seekType: typeof seekType === 'number' ? seekType : undefined
        });
        // 最新100件のみ保持
        if (deps.mediaEventHistory.length > 100) {
          deps.mediaEventHistory.shift();
        }
      }

      res.json({ 
        success: true, 
        message: `メディアイベント「${resolvedEventType}」を処理しました`,
        eventType: resolvedEventType,
        pageInfo,
        isDoubleClick: Boolean(isDoubleClick)
      });
    } catch (error: any) {
      console.error('[エラー] /api/media/event エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

