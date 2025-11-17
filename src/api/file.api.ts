// ファイルアップロードAPIエンドポイント
import { AppSession, ViewType } from '@mentra/sdk';
import { Express } from 'express';
import { TextPager } from '../services/text/TextPager';
import { MarkdownFormatter } from '../services/text/MarkdownFormatter';
import { debugLog, debugError } from '../utils/debug';
import { DEBUG } from '../utils/config';

export interface FileAPIDependencies {
  sessions: Map<string, AppSession>;
  userIdToSessionId: Map<string, string>;
  sessionTexts: Map<string, string>;
  sessionPagers: Map<string, TextPager>;
  sessionFileTypes: Map<string, string>;
  getAppSessionForUser: (userId: string) => AppSession | null;
}

// 現在のページをARグラスに表示（サーバー側でページング管理）
export async function displayCurrentPage(
  session: AppSession,
  sessionId: string,
  sessionPagers: Map<string, TextPager>,
  lastMediaEvent?: { userId: string; eventType: string; timestamp: number; source?: string; isDoubleClick?: boolean; interval?: number; seekType?: number } | null
): Promise<void> {
  const pager = sessionPagers.get(sessionId);
  if (!pager) {
    debugError(`TextPagerが見つかりません: sessionId=${sessionId}`);
    return;
  }

  const pageText = pager.getCurrentPage();
  const pageInfo = pager.getPageInfo();

  if (!pageText) {
    debugError('ページテキストが空です');
    return;
  }

  const cleanText = pageText
    .replace(/[^\x20-\x7E\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\n]/g, '')
    .trim();

  if (!cleanText) {
    debugError('クリーンアップ後のテキストが空です');
    return;
  }

  const displayText = `${cleanText}\n\n${pageInfo}`;
  debugLog(`ページ表示: ${pageInfo}, テキスト長=${cleanText.length}`);

  session.layouts.showTextWall(displayText, {
    view: ViewType.MAIN
  });

  session.layouts.showTextWall(displayText, {
    view: ViewType.DASHBOARD
  });
}

export function setupFileAPI(
  app: Express,
  deps: FileAPIDependencies
): void {
  const multer = require('multer');
  const upload = multer({ storage: multer.memoryStorage() });

  // デバッグログ（共通）
  if (DEBUG) {
    app.use('/api', (req: any, res: any, next: any) => {
      // ノイズ低減: 高頻度エンドポイントはログ抑制
      const noisyPaths = new Set<string>(['/api/text/current', '/api/audio/commands', '/text/current', '/audio/commands']);
      if (!noisyPaths.has(req.path)) {
        debugLog(`リクエスト受信: ${req.method} ${req.path}`);
      }
      next();
    });
  }

  // テキストファイルをアップロードして表示
  app.post('/api/upload-text', upload.single('file'), async (req: any, res: any) => {
    try {
      debugLog('/api/upload-text リクエスト受信');
      const userId = (req as any).authUserId;
      
      if (!userId) {
        debugError('認証エラー: userIdが見つかりません');
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      const sessionId = deps.userIdToSessionId.get(userId);
      if (!sessionId) {
        debugError('セッションが見つかりません');
        return res.status(404).json({ 
          success: false, 
          error: 'セッションが見つかりません。アプリを再起動してください。'
        });
      }

      const session = deps.sessions.get(sessionId);
      if (!session) {
        debugError('セッションオブジェクトが見つかりません');
        return res.status(404).json({ 
          success: false, 
          error: 'セッションが見つかりません。アプリを再起動してください。'
        });
      }

      let textContent = '';
      let fileType = 'text';

      if (req.file) {
        textContent = req.file.buffer.toString('utf-8');
        const fileName = req.file.originalname.toLowerCase();
        if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
          fileType = 'markdown';
        } else if (fileName.endsWith('.csv')) {
          fileType = 'csv';
        }
      } else if (req.body.text) {
        textContent = req.body.text;
        fileType = req.body.fileType || 'text';
      } else {
        return res.status(400).json({ success: false, error: 'ファイルまたはテキストが必要です' });
      }

      if (fileType === 'markdown') {
        textContent = MarkdownFormatter.format(textContent);
      }

      deps.sessionTexts.set(sessionId, textContent);
      deps.sessionFileTypes.set(sessionId, fileType);
      debugLog(`テキストを受信: 長さ=${textContent.length}文字, タイプ=${fileType}`);

      const pager = new TextPager(textContent);
      deps.sessionPagers.set(sessionId, pager);
      debugLog(`TextPager初期化完了: ページ数=${pager.getTotalPages()}`);

      await displayCurrentPage(session, sessionId, deps.sessionPagers);

      res.json({ 
        success: true, 
        message: 'テキストを受信しました',
        textLength: textContent.length,
        totalPages: pager.getTotalPages(),
        currentPage: pager.getCurrentPageNumber()
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 保存されたテキストを取得
  app.get('/api/text', (req: any, res: any) => {
    const userId = (req as any).authUserId;
    
    if (!userId) {
      return res.status(401).json({ success: false, error: '認証が必要です' });
    }

    const sessionId = deps.userIdToSessionId.get(userId);
    if (!sessionId) {
      return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
    }

    const text = deps.sessionTexts.get(sessionId);
    if (!text) {
      return res.status(404).json({ success: false, error: 'テキストが見つかりません' });
    }

    res.json({ success: true, text });
  });

  // 現在表示中のページテキストを取得（ARデバイス表示用）
  app.get('/api/text/current', (req: any, res: any) => {
    const userId = (req as any).authUserId;
    
    if (!userId) {
      return res.status(401).json({ success: false, error: '認証が必要です' });
    }

    const sessionId = deps.userIdToSessionId.get(userId);
    if (!sessionId) {
      return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
    }

    const pager = deps.sessionPagers.get(sessionId);
    if (!pager) {
      return res.status(404).json({ success: false, error: 'ページデータが見つかりません' });
    }

    const pageText = pager.getCurrentPage();
    const pageInfo = pager.getPageInfo();
    const cleanText = pageText
      .replace(/[^\x20-\x7E\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\n]/g, '')
      .trim();
    
    const displayText = `${cleanText}\n\n${pageInfo}`;

    res.json({ 
      success: true, 
      text: displayText,
      pageInfo: {
        currentPage: pager.getCurrentPageNumber(),
        totalPages: pager.getTotalPages(),
        pageInfo: pageInfo
      }
    });
  });
}
