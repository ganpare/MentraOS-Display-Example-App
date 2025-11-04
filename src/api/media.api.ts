// メディアコントローラーAPIエンドポイント
import { AppSession, ViewType } from '@mentra/sdk';
import { Express } from 'express';
import { TextPager } from '../services/text/TextPager';
import { displayCurrentPage } from './file.api';
import { debugLog, debugError } from '../utils/debug';

export interface MediaAPIDependencies {
  sessions: Map<string, AppSession>;
  userIdToSessionId: Map<string, string>;
  sessionPagers: Map<string, TextPager>;
  getAppSessionForUser: (userId: string) => AppSession | null;
}

async function handleMediaEvent(
  session: AppSession,
  eventType: string,
  sessionPagers: Map<string, TextPager>,
  sessions: Map<string, AppSession>
): Promise<void> {
  const eventTypeLower = eventType.toLowerCase().trim();
  debugLog(`メディアイベント受信: ${eventType} (${eventTypeLower})`);

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
    'playpause': '再生/一時停止ボタンが押されました ⏯️',
    'skipforward': '早送りボタンが押されました ⏩',
    'skipbackward': '巻き戻しボタンが押されました ⏪',
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

      const eventType = req.body.eventType || req.body.event;
      
      if (!eventType) {
        debugError('eventTypeが指定されていません');
        return res.status(400).json({ success: false, error: 'eventTypeが必要です' });
      }

      debugLog('メディアイベント処理開始: eventType=', eventType);
      await handleMediaEvent(session, eventType, deps.sessionPagers, deps.sessions);

      let pageInfo: { currentPage: number; totalPages: number; pageInfo: string } | null = null;
      if (eventType.toLowerCase() === 'nextpage' || eventType.toLowerCase() === 'prevpage') {
        const pager = deps.sessionPagers.get(sessionId!);
        if (pager) {
          pageInfo = {
            currentPage: pager.getCurrentPageNumber(),
            totalPages: pager.getTotalPages(),
            pageInfo: pager.getPageInfo()
          };
        }
      }

      res.json({ 
        success: true, 
        message: `メディアイベント「${eventType}」を処理しました`,
        eventType,
        pageInfo
      });
    } catch (error: any) {
      console.error('[エラー] /api/media/event エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

