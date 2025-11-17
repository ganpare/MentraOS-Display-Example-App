// メディアコントローラーAPIエンドポイント
import { AppSession, ViewType } from '@mentra/sdk';
import { Express } from 'express';
import { TextPager } from '../services/text/TextPager';
import { displayCurrentPage } from './file.api';
import { getUserSettings, convertActionMappingsToButtonMappings } from '../services/settings/UserSettings';
import { debugLog, debugError } from '../utils/debug';
import { SubtitleEntry } from '../services/audio/SRTParser';

export interface MediaEventHistoryEntry {
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
  // セッションごとの現在のページ状態（'top', 'textReader', 'audioPlayer', 'btController', 'settings'）
  sessionCurrentPages?: Map<string, string>;
  // 直近のコンテンツページ（textReader/audioPlayer）
  sessionLastContentPages?: Map<string, string>;
  // セッションごとの現在再生中の音声ファイルID
  sessionAudioIds?: Map<string, string>;
  // 字幕キャッシュ（サーバー側で字幕制御するため）
  subtitleCache?: Map<string, SubtitleEntry[]>;
  // セッションごとの最新のメディアイベント情報（display_eventにメタデータを含めるため）
  sessionLastMediaEvents?: Map<string, MediaEventHistoryEntry | null>;
  getUserIdFromSession?: (session: AppSession) => string | null;
}

// アクションを実行する関数
async function executeAction(
  actionType: string,
  actionValue: number | undefined,
  session: AppSession,
  sessionId: string,
  sessionPagers: Map<string, TextPager>,
  deps?: MediaAPIDependencies,
  suppressMessage: boolean = false
): Promise<void> {
  
  switch (actionType) {
    case 'text_nextpage':
    case 'text_prevpage': {
      const pager = sessionPagers.get(sessionId);
      if (!pager) {
        session.layouts.showTextWall('テキストがアップロードされていません', {
          view: ViewType.MAIN,
          durationMs: 3000
        });
        return;
      }
      
      const moved = actionType === 'text_nextpage' ? pager.nextPage() : pager.prevPage();
      if (!moved) {
        const message = actionType === 'text_nextpage' ? '最後のページです' : '最初のページです';
        session.layouts.showTextWall(message, {
          view: ViewType.MAIN,
          durationMs: 2000
        });
        return;
      }
      
      // 最新のメディアイベント情報を取得してdisplayCurrentPageに渡す
      const lastMediaEvent = deps?.sessionLastMediaEvents?.get(sessionId) || null;
      await displayCurrentPage(session, sessionId, sessionPagers, lastMediaEvent);
      break;
    }
    
    case 'audio_next_subtitle':
    case 'audio_prev_subtitle': {
      // サーバー側で字幕インデックスを管理してARグラスに直接表示（テキストリーダーと同じ方式）
      if (!deps?.sessionPlaybackStates || !deps?.sessionAudioIds || !deps?.subtitleCache) {
        debugError('音声プレーヤー制御に必要な依存関係が不足しています');
        return;
      }
      
      const audioId = deps.sessionAudioIds.get(sessionId);
      if (!audioId) {
        debugError('現在再生中の音声ファイルIDが見つかりません');
        return;
      }
      
      const subtitles = deps.subtitleCache.get(audioId);
      if (!subtitles || subtitles.length === 0) {
        debugError('字幕データが見つかりません');
        return;
      }
      
      const playbackState = deps.sessionPlaybackStates.get(sessionId);
      if (!playbackState) {
        debugError('再生状態が見つかりません');
        return;
      }
      
      let newIndex = playbackState.currentSubtitleIndex;
      if (actionType === 'audio_next_subtitle') {
        // 次の字幕に移動（最後の字幕を超えないように）
        newIndex = Math.min(newIndex + 1, subtitles.length - 1);
      } else {
        // 前の字幕に移動（最初の字幕より前には行かない）
        newIndex = Math.max(newIndex - 1, -1); // -1は字幕なし状態
      }
      
      // インデックスが有効な範囲内かチェック
      if (newIndex >= 0 && newIndex < subtitles.length) {
        const subtitle = subtitles[newIndex];
        
        // 字幕をARグラスに表示
        session.layouts.showTextWall(subtitle.text, {
          view: ViewType.MAIN
        });
        
        // 再生状態を更新
        playbackState.currentSubtitleIndex = newIndex;
        playbackState.lastUpdateTime = Date.now();
        
        // WebView側の<audio>要素もシークする必要があるので、コマンドキューに追加
        if (deps.sessionCommandQueues) {
          const commandQueue = deps.sessionCommandQueues.get(sessionId) || [];
          commandQueue.push({
            type: 'seek',
            value: subtitle.startTime,
            timestamp: Date.now()
          });
          deps.sessionCommandQueues.set(sessionId, commandQueue);
        }
        
        debugLog(`字幕変更: インデックス ${playbackState.currentSubtitleIndex} → ${newIndex}, 時間 ${subtitle.startTime}s`);
      } else if (newIndex === -1) {
        // 字幕なし状態に戻る
        playbackState.currentSubtitleIndex = -1;
        playbackState.lastUpdateTime = Date.now();
        debugLog(`字幕をクリア: インデックス → -1`);
      }
      break;
    }
    
    case 'audio_play':
    case 'audio_pause':
    case 'audio_next':
    case 'audio_prev':
    case 'audio_skip_forward':
    case 'audio_skip_backward':
    case 'audio_repeat':
    case 'audio_speed': {
      // これらのアクションはWebView側の<audio>要素を制御する必要があるため、コマンドキューを使用
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
        // 再生/一時停止/次のトラック/前のトラック/リピート/速度変更はコマンドキューに追加
        const commandType = actionType === 'audio_play' ? 'play' :
                          actionType === 'audio_pause' ? 'pause' :
                          actionType === 'audio_next' ? 'next' :
                          actionType === 'audio_prev' ? 'prev' :
                          actionType === 'audio_repeat' ? 'repeat' :
                          actionType === 'audio_speed' ? 'speed' : null;
        
        if (commandType) {
          (commandQueue as any[]).push({
            type: commandType,
            timestamp: Date.now()
          });
          debugLog(`音声制御コマンド追加: ${commandType}`);
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
    source?: string; // イベントの発生元（'bluetooth', 'webview', etc.）
    deps?: MediaAPIDependencies;
  } = {}
): Promise<void> {
  const eventTypeLower = eventType.toLowerCase().trim();
  const currentPage = options.currentPage || 'top';
  
  debugLog(`handleMediaEvent開始: eventType=${eventTypeLower}, currentPage=${currentPage}, source=${options.source || 'webview'}, isDoubleClick=${options.isDoubleClick || false}`);
  
  // Bluetoothコントローラーからのメディアコントロールイベントの場合、
  // いかなる状況でもメッセージを表示しない（ただし、bluetooth-iosは除く）
  // bluetooth-iosはiOS側から直接送信されるため、通常の処理を行う
  const isBluetoothEvent = options.source === 'bluetooth' || options.source === 'bluetooth-webview';
  const isMediaControlEvent = ['playpause', 'nexttrack', 'prevtrack', 'play', 'pause', 'stop', 'skipforward', 'skipbackward'].includes(eventTypeLower);
  
  // メッセージ表示を抑制するかどうか
  // Bluetoothイベント、またはメディアコントロールイベントでcurrentPageがtopの場合は抑制
  const shouldSuppressMessage = (isBluetoothEvent && isMediaControlEvent) || 
                                 (isMediaControlEvent && currentPage === 'top');

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
    // currentPageが'top'または未指定の場合（iOS側からの直接送信など）、
    // text_とaudio_の両方を検索する
    let actionPrefixes: string[] = [];
    if (currentPage === 'textReader') {
      actionPrefixes = ['text_'];
    } else if (currentPage === 'audioPlayer') {
      actionPrefixes = ['audio_'];
    } else {
      // 'top'または未指定の場合、両方を検索
      actionPrefixes = ['text_', 'audio_'];
    }
    
    const clickType = options.isDoubleClick ? 'double' : 'single';
    
    // 該当するページのアクションを検索
    for (const [actionId, mapping] of Object.entries(userSettings.actionMappings)) {
      if (!mapping) continue;
      
      // 現在のページに属するアクションのみをチェック
      const matchesPage = actionPrefixes.some(prefix => actionId.startsWith(prefix));
      if (!matchesPage) continue;
      
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
          // アクションを実行（メッセージ抑制フラグを渡す）
          await executeAction(actionType, undefined, session, sessionId, sessionPagers, options.deps, shouldSuppressMessage);
          debugLog(`アクション実行: ${actionType} (トリガー: ${eventTypeLower}, ページ: ${currentPage}, クリック: ${clickType})`);
          return;
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
        
        // 設定に基づいて動作を実行（メッセージ抑制フラグを渡す）
        await executeAction(action.type, action.value, session, sessionId, sessionPagers, options.deps, shouldSuppressMessage);
        return;
      }
    }
  }

  // 追加のデフォルト動作（設定が無い場合の安全網）
  // currentPage の文脈でメディアコントロールを素直に解釈
  if (['nexttrack', 'prevtrack', 'skipforward', 'skipbackward'].includes(eventTypeLower)) {
    if (currentPage === 'audioPlayer') {
      let actionType: string = ''
      let actionValue: number | undefined = undefined
      if (eventTypeLower === 'nexttrack') actionType = 'audio_next_subtitle'
      else if (eventTypeLower === 'prevtrack') actionType = 'audio_prev_subtitle'
      else if (eventTypeLower === 'skipforward') { actionType = 'audio_skip_forward'; actionValue = options.interval || 10 }
      else if (eventTypeLower === 'skipbackward') { actionType = 'audio_skip_backward'; actionValue = options.interval || 10 }
      await executeAction(actionType, actionValue, session, sessionId, sessionPagers, options.deps, true);
      debugLog(`デフォルト動作: ${actionType} (ページ: ${currentPage}, 設定未定義)`);
      return;
    }
    if (currentPage === 'textReader') {
      const actionType = eventTypeLower === 'nexttrack' ? 'text_nextpage' : 'text_prevpage';
      await executeAction(actionType, undefined, session, sessionId, sessionPagers, options.deps, true);
      debugLog(`デフォルト動作: ${actionType} (ページ: ${currentPage}, 設定未定義)`);
      return;
    }
  }

  // デフォルト動作（従来の処理）
  if (eventTypeLower === 'nextpage' || eventTypeLower === 'prevpage') {
    debugLog(`ページング処理開始: eventType=${eventTypeLower}`);
    // executeActionを呼び出すことで重複コードを削減
    const actionType = eventTypeLower === 'nextpage' ? 'text_nextpage' : 'text_prevpage';
    await executeAction(actionType, undefined, session, sessionId, sessionPagers, options.deps, shouldSuppressMessage);
    return;
  }

  // Bluetoothコントローラーからのメディアコントロールイベントの場合、
  // いかなる状況でもメッセージを表示しない（設定に基づいてアクションが実行されたか、
  // 対応するアクションが見つからなかった場合でも）
      if (shouldSuppressMessage) {
        // サイレントdisplay_eventは bluetooth-ios 由来のときのみ送る（実表示を上書きしないため）
        if (source === 'bluetooth-ios') {
          try {
            session.layouts.showTextWall(' ', {
              view: ViewType.DASHBOARD,
              durationMs: 1,
            });
          } catch (e) {
            debugError('サイレントdisplay_event送信に失敗:', e);
          }
        }
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

  // メインとダッシュボード両方にメッセージを表示
  [ViewType.MAIN, ViewType.DASHBOARD].forEach(view => {
    session.layouts.showTextWall(message, {
      view,
      durationMs: 5000
    });
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
      debugLog('リクエスト受信: GET /api/media/events/history');
      
      const userId = (req as any).authUserId;
      if (!userId) {
        debugError('メディアイベント履歴取得: 認証が必要です');
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      if (!deps.mediaEventHistory) {
        debugLog('メディアイベント履歴取得: 履歴が空です');
        return res.json({ success: true, events: [] });
      }

      // 該当ユーザーの最新イベントを取得（最新20件）
      const userEvents = deps.mediaEventHistory
        .filter(e => e.userId === userId)
        .slice(-20)
        .reverse();

      debugLog(`メディアイベント履歴取得: userId=${userId}, イベント数=${userEvents.length}`);
      
      if (userEvents.length > 0) {
        const latestEvent = userEvents[0];
        debugLog(`メディアイベント履歴: 最新イベント eventType=${latestEvent.eventType}, source=${latestEvent.source}, timestamp=${latestEvent.timestamp}`);
      }

      res.json({ 
        success: true, 
        events: userEvents 
      });
    } catch (error: any) {
      debugError('メディアイベント履歴取得エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 認証/セッション状態の簡易確認用（開発支援）
  app.get('/api/media/debug/session', (req: any, res: any) => {
    try {
      debugLog('リクエスト受信: GET /api/media/debug/session');

      const userId = (req as any).authUserId;
      const info: any = { success: true };

      if (!userId) {
        info.authenticated = false;
        return res.json(info);
      }

      info.authenticated = true;
      info.userId = userId;

      const sessionId = deps.userIdToSessionId.get(userId);
      info.sessionId = sessionId || null;
      info.hasSession = Boolean(sessionId && deps.sessions.get(sessionId));
      if (sessionId && deps.sessionCurrentPages) {
        info.currentPage = deps.sessionCurrentPages.get(sessionId) || 'top';
      }

      if (deps.mediaEventHistory) {
        const last = deps.mediaEventHistory.filter(e => e.userId === userId).slice(-1)[0] || null;
        info.lastEvent = last || null;
      }

      return res.json(info);
    } catch (error: any) {
      debugError('セッションデバッグ取得エラー:', error);
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

  // 最新1件を簡易取得（開発支援）
  app.get('/api/media/events/last', (req: any, res: any) => {
    try {
      debugLog('リクエスト受信: GET /api/media/events/last');
      const userId = (req as any).authUserId;
      if (!userId) {
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }
      if (!deps.mediaEventHistory) {
        return res.json({ success: true, event: null });
      }
      const last = deps.mediaEventHistory.filter(e => e.userId === userId).slice(-1)[0] || null;
      return res.json({ success: true, event: last });
    } catch (error: any) {
      debugError('最新メディアイベント取得エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 現在のページ状態を更新するエンドポイント
  app.post('/api/media/page', async (req: any, res: any) => {
    try {
      debugLog('リクエスト受信: POST /api/media/page', { body: req.body });
      
      const userId = (req as any).authUserId;
      const { currentPage } = req.body || {};
      
      debugLog(`ページ状態更新リクエスト: userId=${userId || '未認証'}, currentPage=${currentPage || '未指定'}`);
      
      if (!userId) {
        debugError('ページ状態更新: 認証が必要です');
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }
      
      const sessionId = deps.userIdToSessionId.get(userId);
      if (!sessionId) {
        debugError(`ページ状態更新: セッションが見つかりません (userId=${userId})`);
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }
      
      debugLog(`ページ状態更新: セッションID取得成功 sessionId=${sessionId}`);
      
      // ページ状態を更新（'top', 'textReader', 'audioPlayer', 'btController', 'settings'）
      if (currentPage && deps.sessionCurrentPages) {
        const validPages = ['top', 'textReader', 'audioPlayer', 'btController', 'settings'];
        if (validPages.includes(currentPage)) {
          const previousPage = deps.sessionCurrentPages.get(sessionId) || 'none';
          deps.sessionCurrentPages.set(sessionId, currentPage);
          debugLog(`ページ状態更新: sessionId=${sessionId}, previousPage=${previousPage}, currentPage=${currentPage}`);

          // 直近コンテンツページを更新（btController/settings/top の場合は上書きしない）
          if (deps.sessionLastContentPages && (currentPage === 'textReader' || currentPage === 'audioPlayer')) {
            deps.sessionLastContentPages.set(sessionId, currentPage);
            debugLog(`直近コンテンツページ更新: sessionId=${sessionId}, lastContentPage=${currentPage}`);
          }
        } else {
          debugError(`ページ状態更新: 無効なページ名 (currentPage=${currentPage})`);
        }
      }
      
      res.json({ success: true });
    } catch (error: any) {
      debugError('ページ状態更新エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/media/event', async (req: any, res: any) => {
    try {
      debugLog('リクエスト受信: POST /api/media/event', { 
        body: req.body,
        query: req.query,
        headers: { 
          'content-type': req.headers['content-type'],
          'user-agent': req.headers['user-agent']
        }
      });
      
      const userId = (req as any).authUserId;
      const {
        eventType,
        event,
        isDoubleClick = false,
        interval,
        seekType,
        source,
        timestamp,
        currentPage // リクエストから来る場合（WebViewからの送信時）
      } = req.body || {};
      
      debugLog(`メディアイベント受信: eventType=${eventType || event}, source=${source || '未指定'}, userId=${userId || '未認証'}, isDoubleClick=${isDoubleClick}`);
      
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

      if (!session || !sessionId) {
        debugError(`セッションが見つかりません (authUserId=${userId || '未認証'}, providedSessionId=${req.body?.sessionId || req.query?.sessionId || 'なし'})`);
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      // currentPageがリクエストに含まれていない場合、サーバー側の状態から取得
      let resolvedCurrentPage = currentPage;
      if (!resolvedCurrentPage && deps.sessionCurrentPages) {
        resolvedCurrentPage = deps.sessionCurrentPages.get(sessionId) || 'top';
        debugLog(`ページ状態をサーバー側から取得: sessionId=${sessionId}, currentPage=${resolvedCurrentPage}`);
      }

      // btController や top の場合は、直近のコンテンツページ（textReader/audioPlayer）を優先利用
      let effectivePage = resolvedCurrentPage;
      if ((resolvedCurrentPage === 'btController' || resolvedCurrentPage === 'top' || resolvedCurrentPage === 'settings') 
          && deps.sessionLastContentPages) {
        const lastContent = deps.sessionLastContentPages.get(sessionId);
        if (lastContent === 'textReader' || lastContent === 'audioPlayer') {
          effectivePage = lastContent;
          debugLog(`ページ状態フォールバック適用: resolved=${resolvedCurrentPage} → effective=${effectivePage}`);
        }
      }

      const resolvedEventType = eventType || event;

      if (!resolvedEventType) {
        debugError('eventTypeが指定されていません');
        return res.status(400).json({ success: false, error: 'eventTypeが必要です' });
      }

      const resolvedEventTypeLower = resolvedEventType.toLowerCase();
      
      // Bluetoothイベントの場合、サーバー側で処理しない（ただし、bluetooth-iosは除く）
      // すべてmediaControlHandler.jsでGUIボタンをクリックして処理する
      // bluetooth-iosはiOS側から直接送信されるため、サーバー側で処理する
      if ((source === 'bluetooth' || source === 'bluetooth-webview') && source !== 'bluetooth-ios' && ['playpause', 'nexttrack', 'prevtrack'].includes(resolvedEventTypeLower)) {
        debugLog(`Bluetoothイベント '${resolvedEventType}' はクライアント側で処理されるため、サーバー側では処理しません`);
        return res.json({ 
          success: true, 
          message: `Bluetoothイベント「${resolvedEventType}」はクライアント側で処理されます`,
          handledByClient: true
        });
      }
      
      // bluetooth-iosイベントはサーバー側で処理する（iOS側から直接送信されるため）
      debugLog(`メディアイベント処理開始: eventType=${resolvedEventType}, source=${source || 'webview'}, currentPage=${effectivePage || 'top'}, sessionId=${sessionId}`);

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
          currentPage: effectivePage || 'top',
          source: source || 'webview',
          deps: deps
        }
      );

      debugLog(`メディアイベント処理完了: eventType=${resolvedEventType}`);

      // Note: サイレントdisplay_eventは常時は送らない（実表示を上書きする恐れがあるため）
      // Bluetooth-iOS 由来でメッセージ抑制中に限り、別箇所の分岐で最小display_eventを送る。

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
      const eventEntry: MediaEventHistoryEntry = {
        userId: userId!,
        eventType: resolvedEventType,
        timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
        source: source || 'webview',
        isDoubleClick: Boolean(isDoubleClick),
        interval: typeof interval === 'number' ? interval : undefined,
        seekType: typeof seekType === 'number' ? seekType : undefined
      };

      if (deps.mediaEventHistory && userId) {
        deps.mediaEventHistory.push(eventEntry);
        // 最新100件のみ保持
        if (deps.mediaEventHistory.length > 100) {
          deps.mediaEventHistory.shift();
        }
        debugLog(`メディアイベント履歴に記録: userId=${userId}, eventType=${eventEntry.eventType}, source=${eventEntry.source}, timestamp=${eventEntry.timestamp}`)
      }

      // イベント履歴への記録のみ（表示はWebSocket経由のdisplay_eventで行われる）

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
