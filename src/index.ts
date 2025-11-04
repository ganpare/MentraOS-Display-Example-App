import { AppServer, AppSession, ViewType } from '@mentra/sdk';
import * as fs from 'fs';
import * as path from 'path';

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'your-secret-key-change-this-in-production';
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const WEBVIEW_URL = process.env.WEBVIEW_URL || `${SERVER_URL}/webview/`;
const AUDIO_SOURCE_DIR = process.env.AUDIO_SOURCE_DIR || '';
const DEBUG = process.env.DEBUG === 'true';

// テキストページング処理クラス（サーバー側で管理）
class TextPager {
  private pages: string[] = [];
  private currentPage: number = 0;
  private maxCharsPerPage: number = 150;

  constructor(text: string, maxCharsPerPage: number = 150) {
    this.maxCharsPerPage = maxCharsPerPage;
    this.splitIntoPages(text);
  }

  private splitIntoPages(text: string): void {
    this.pages = [];
    if (!text || text.trim().length === 0) {
      this.pages = [''];
      return;
    }

    const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const paragraphs = cleanText.split('\n');
    
    let currentPage = '';
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i].trim();
      if (!paragraph) {
        if (currentPage) currentPage += '\n';
        continue;
      }

      if ((currentPage + paragraph).length <= this.maxCharsPerPage) {
        if (currentPage) currentPage += '\n';
        currentPage += paragraph;
      } else {
        if (currentPage) {
          this.pages.push(currentPage.trim());
          currentPage = '';
        }

        let remaining = paragraph;
        while (remaining.length > 0) {
          if (remaining.length <= this.maxCharsPerPage) {
            currentPage = remaining;
            remaining = '';
          } else {
            let splitIndex = this.maxCharsPerPage;
            const lastSpaceIndex = remaining.lastIndexOf(' ', this.maxCharsPerPage);
            if (lastSpaceIndex > this.maxCharsPerPage * 0.7) {
              splitIndex = lastSpaceIndex;
            }
            this.pages.push(remaining.substring(0, splitIndex).trim());
            remaining = remaining.substring(splitIndex).trim();
          }
        }
      }
    }

    if (currentPage) {
      this.pages.push(currentPage.trim());
    }

    if (this.pages.length === 0) {
      this.pages = [''];
    }
  }

  getCurrentPage(): string {
    return this.pages[this.currentPage] || '';
  }

  nextPage(): boolean {
    if (this.currentPage < this.pages.length - 1) {
      this.currentPage++;
      return true;
    }
    return false;
  }

  prevPage(): boolean {
    if (this.currentPage > 0) {
      this.currentPage--;
      return true;
    }
    return false;
  }

  getCurrentPageNumber(): number {
    return this.currentPage + 1;
  }

  getTotalPages(): number {
    return this.pages.length;
  }

  getPageInfo(): string {
    return `${this.getCurrentPageNumber()}/${this.getTotalPages()}`;
  }
}

// SRT字幕パーサークラス
interface SubtitleEntry {
  index: number;
  startTime: number; // 秒単位
  endTime: number; // 秒単位
  text: string;
}

class SRTParser {
  static parse(content: string): SubtitleEntry[] {
    const entries: SubtitleEntry[] = [];
    const blocks = content.trim().split(/\n\s*\n/);
    
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;
      
      const index = parseInt(lines[0]);
      if (isNaN(index)) continue;
      
      const timecode = lines[1];
      const timeMatch = timecode.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (!timeMatch) continue;
      
      const startTime = 
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]) +
        parseInt(timeMatch[4]) / 1000;
      
      const endTime = 
        parseInt(timeMatch[5]) * 3600 +
        parseInt(timeMatch[6]) * 60 +
        parseInt(timeMatch[7]) +
        parseInt(timeMatch[8]) / 1000;
      
      const text = lines.slice(2).join(' ').trim();
      
      if (text) {
        entries.push({
          index,
          startTime,
          endTime,
          text
        });
      }
    }
    
    return entries.sort((a, b) => a.startTime - b.startTime);
  }
}

// マークダウンテキストを整形するクラス（プレーンテキストに変換）
class MarkdownFormatter {
  static format(text: string): string {
    let formatted = text;
    
    // コードブロックをそのまま保持（```で囲まれた部分）
    const codeBlocks: string[] = [];
    formatted = formatted.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });
    
    // インラインコードをそのまま保持
    const inlineCodes: string[] = [];
    formatted = formatted.replace(/`[^`]+`/g, (match) => {
      inlineCodes.push(match);
      return `__INLINE_CODE_${inlineCodes.length - 1}__`;
    });
    
    // 見出し (# ## ###) → 見出しテキストの前に空行と記号を追加
    formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, (match) => {
      const hashMatch = match.match(/^#+/);
      if (!hashMatch) return match;
      const level = hashMatch[0].length;
      const text = match.replace(/^#+\s+/, '').trim();
      const prefix = level === 1 ? '═══════════════════════\n' : level === 2 ? '───────────────────────\n' : '━━━━━━━━━━━━━━━━━━━━━━\n';
      return `\n${prefix}${text}\n${prefix}\n`;
    });
    
    // 太字 (**text** または __text__) → 構文を削除してテキストのみ
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '$1');
    formatted = formatted.replace(/__(.+?)__/g, '$1');
    
    // 斜体 (*text* または _text_) → 構文を削除してテキストのみ
    formatted = formatted.replace(/\*(.+?)\*/g, '$1');
    formatted = formatted.replace(/_(.+?)_/g, '$1');
    
    // 取り消し線 (~~text~~) → 構文を削除
    formatted = formatted.replace(/~~(.+?)~~/g, '$1');
    
    // リンク [text](url) → text (url)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    
    // 画像 ![alt](url) → [画像: alt]
    formatted = formatted.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[画像: $1]');
    
    // リスト (- または *) → • に統一（インデントを考慮）
    formatted = formatted.replace(/^(\s*)[\-\*]\s+(.+)$/gm, (match, indent, text) => {
      return `${indent}• ${text}`;
    });
    // 番号付きリスト → 番号を削除（インデントを考慮）
    formatted = formatted.replace(/^(\s*)\d+\.\s+(.+)$/gm, '$1$2');
    
    // 水平線 (--- または ***) → 削除
    formatted = formatted.replace(/^[-*]{3,}$/gm, '');
    
    // 引用 (> text) → "text" に変換
    formatted = formatted.replace(/^>\s+(.+)$/gm, '"$1"');
    
    // テーブル形式を簡略化（| で区切られた行）
    formatted = formatted.replace(/^\|(.+)\|$/gm, (match, content) => {
      // ヘッダー行の後の区切り線を削除
      if (content.trim().match(/^:?-+:?$/)) {
        return '';
      }
      // テーブルセルをスペースで区切る
      return content.split('|').map((cell: string) => cell.trim()).filter((cell: string) => cell).join(' | ');
    });
    
    // コードブロックを復元
    codeBlocks.forEach((code, index) => {
      formatted = formatted.replace(`__CODE_BLOCK_${index}__`, code);
    });
    
    // インラインコードを復元
    inlineCodes.forEach((code, index) => {
      formatted = formatted.replace(`__INLINE_CODE_${index}__`, code);
    });
    
    // 連続する空行を2つまでに制限
    formatted = formatted.replace(/\n{4,}/g, '\n\n\n');
    
    return formatted.trim();
  }
}

class ExampleMentraOSApp extends AppServer {
  // セッションごとのセッションオブジェクトを管理
  private sessions: Map<string, AppSession> = new Map();
  // ユーザーIDからセッションIDを取得するマップ
  private userIdToSessionId: Map<string, string> = new Map();
  // セッションごとのテキストコンテンツを管理（/api/textエンドポイント用）
  private sessionTexts: Map<string, string> = new Map();
  // セッションごとのページング状態を管理（サーバー側でページング処理）
  private sessionPagers: Map<string, TextPager> = new Map();
  // 字幕データのキャッシュ（ファイルID -> 字幕エントリ配列）
  private subtitleCache: Map<string, SubtitleEntry[]> = new Map();
  // セッションごとのファイルタイプを管理（マークダウン処理用）
  private sessionFileTypes: Map<string, string> = new Map();

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
      publicDir: './public',
      cookieSecret: COOKIE_SECRET,
    });
    
    // APIエンドポイントをコンストラクタで設定（サーバー起動時に利用可能にする）
    this.setupFileAPI();
    this.setupMediaControllerAPI();
    this.setupAudioAPI();
  }

  // 認証ミドルウェアの設定を共通化
  private createAuthMiddlewareForPath(path: string) {
    const webviewPath = require('path').join(__dirname, '../node_modules/@mentra/sdk/dist/app/webview/index.js');
    const { createAuthMiddleware } = require(webviewPath);
    return createAuthMiddleware({
      apiKey: MENTRAOS_API_KEY,
      packageName: PACKAGE_NAME,
      cookieSecret: COOKIE_SECRET,
      getAppSessionForUser: (userId: string) => {
        const sessionId = this.userIdToSessionId.get(userId);
        return sessionId ? this.sessions.get(sessionId) || null : null;
      }
    });
  }

  // デバッグログ出力ヘルパー
  private debugLog(message: string, ...args: any[]): void {
    if (DEBUG) {
      console.log(`[デバッグ] ${message}`, ...args);
    }
  }

  private debugError(message: string, ...args: any[]): void {
    if (DEBUG) {
      console.error(`[デバッグ] ${message}`, ...args);
    }
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    try {
      this.debugLog(`onSession開始: sessionId=${sessionId}, userId=${userId}`);
      
      // セッションを保存
      this.sessions.set(sessionId, session);
      this.userIdToSessionId.set(userId, sessionId);
      this.debugLog(`セッション保存完了`);
      this.debugLog(`userIdToSessionIdマップの状態:`, Array.from(this.userIdToSessionId.entries()));
      this.debugLog(`sessionsマップの状態:`, Array.from(this.sessions.keys()));

      // セッション開始時に案内を表示
      session.layouts.showTextWall("ボタンを押してください", {
        view: ViewType.MAIN
      });
      
      session.layouts.showTextWall(`セッションID: ${sessionId}\nボタンを押してください`, {
        view: ViewType.DASHBOARD
      });

      // セッション終了時のクリーンアップ
      session.events.onDisconnected(() => {
        this.debugLog(`セッション終了: sessionId=${sessionId}`);
        this.sessions.delete(sessionId);
        this.sessionTexts.delete(sessionId);
        this.sessionPagers.delete(sessionId);
        this.sessionFileTypes.delete(sessionId);
        this.userIdToSessionId.delete(userId);
      });

      this.debugLog(`onSession完了`);
    } catch (error: any) {
      console.error(`[エラー] onSessionエラー:`, error);
      throw error;
    }
  }

  // ファイル受け取りと表示用のAPIエンドポイントを設定
  private setupFileAPI(): void {
    const app = this.getExpressApp();
    
    // 既にルートが登録されているかチェック（簡単な方法）
    const routes = app._router?.stack || [];
    const hasUploadRoute = routes.some((layer: any) => 
      layer.route && layer.route.path === '/api/upload-text'
    );
    
    if (hasUploadRoute) {
      this.debugLog('APIエンドポイントは既に設定済みです');
      return;
    }

    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage() });

    // 全てのリクエストをログに記録（デバッグ用）
    if (DEBUG) {
      app.use('/api', (req: any, res: any, next: any) => {
        this.debugLog(`リクエスト受信: ${req.method} ${req.path}`);
        this.debugLog(`リクエストヘッダー:`, {
          'content-type': req.headers['content-type'],
          'origin': req.headers['origin'],
          'referer': req.headers['referer'],
          'user-agent': req.headers['user-agent']
        });
        next();
      });
    }

    // 注意: AppServerのコンストラクタで既にcookie-parserと認証ミドルウェアが設定されているため、
    // ここでは重複して設定しない

    // テキストファイルをアップロードして表示
    app.post('/api/upload-text', upload.single('file'), async (req: any, res: any) => {
      try {
        this.debugLog('/api/upload-text リクエスト受信');
        const userId = (req as any).authUserId;
        this.debugLog('userId:', userId);
        this.debugLog('userIdToSessionIdマップ:', Array.from(this.userIdToSessionId.entries()));
        this.debugLog('sessionsマップ:', Array.from(this.sessions.keys()));
        
        if (!userId) {
          this.debugError('認証エラー: userIdが見つかりません');
          return res.status(401).json({ success: false, error: '認証が必要です' });
        }

        const sessionId = this.userIdToSessionId.get(userId);
        this.debugLog('取得したsessionId:', sessionId);
        
        if (!sessionId) {
          this.debugError('セッションが見つかりません', {
            userId,
            userIdToSessionIdKeys: Array.from(this.userIdToSessionId.keys()),
            sessionKeys: Array.from(this.sessions.keys())
          });
          return res.status(404).json({ 
            success: false, 
            error: 'セッションが見つかりません。アプリを再起動してください。'
          });
        }

        const session = this.sessions.get(sessionId);
        if (!session) {
          this.debugError('セッションオブジェクトが見つかりません', {
            sessionId,
            sessionKeys: Array.from(this.sessions.keys())
          });
          return res.status(404).json({ 
            success: false, 
            error: 'セッションが見つかりません。アプリを再起動してください。'
          });
        }

        let textContent = '';
        let fileType = 'text'; // 'text', 'markdown', 'csv'

        if (req.file) {
          // ファイルがアップロードされた場合
          textContent = req.file.buffer.toString('utf-8');
          // ファイルタイプを検出
          const fileName = req.file.originalname.toLowerCase();
          if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
            fileType = 'markdown';
          } else if (fileName.endsWith('.csv')) {
            fileType = 'csv';
          }
        } else if (req.body.text) {
          // テキストが直接送信された場合
          textContent = req.body.text;
          // ファイルタイプが指定されていない場合はtextとして扱う
          fileType = req.body.fileType || 'text';
        } else {
          return res.status(400).json({ success: false, error: 'ファイルまたはテキストが必要です' });
        }

        // マークダウンファイルの場合は整形処理を適用
        if (fileType === 'markdown') {
          textContent = MarkdownFormatter.format(textContent);
        }

        // フォント設定関連のコード（現在はコメントアウト）
        // 注意: MentraOS SDKのshowTextWallは現在、fontSize、lineHeight、fontFamilyオプションをサポートしていません
        // 将来のSDK対応に備えてコードは残していますが、現在は動作しません
        // const fontSize = req.body.fontSize ? parseInt(req.body.fontSize) : 16;
        // const lineHeight = req.body.lineHeight ? parseFloat(req.body.lineHeight) : 1.5;
        // const fontFamily = req.body.fontFamily || 'default';
        // this.sessionDisplaySettings.set(sessionId, {
        //   fontSize,
        //   lineHeight,
        //   fontFamily
        // });
        // console.log(`[デバッグ] 表示設定を保存: fontSize=${fontSize}, lineHeight=${lineHeight}, fontFamily=${fontFamily}`);

        // セッションごとにテキストを保存
        this.sessionTexts.set(sessionId, textContent);
        this.sessionFileTypes.set(sessionId, fileType);
        this.debugLog(`テキストを受信: 長さ=${textContent.length}文字, タイプ=${fileType}`);

        // サーバー側でページング処理を初期化
        const pager = new TextPager(textContent);
        this.sessionPagers.set(sessionId, pager);
        this.debugLog(`TextPager初期化完了: ページ数=${pager.getTotalPages()}`);

        // 最初のページをARグラスに表示
        await this.displayCurrentPage(session, sessionId);

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

      const sessionId = this.userIdToSessionId.get(userId);
      if (!sessionId) {
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      const text = this.sessionTexts.get(sessionId);

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

      const sessionId = this.userIdToSessionId.get(userId);
      if (!sessionId) {
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      const pager = this.sessionPagers.get(sessionId);
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

  // 現在のページをARグラスに表示（サーバー側でページング管理）
  private async displayCurrentPage(session: AppSession, sessionId: string): Promise<void> {
    const pager = this.sessionPagers.get(sessionId);
    if (!pager) {
      this.debugError(`TextPagerが見つかりません: sessionId=${sessionId}`);
      return;
    }

    const pageText = pager.getCurrentPage();
    const pageInfo = pager.getPageInfo();

    if (!pageText) {
      this.debugError('ページテキストが空です');
      return;
    }

    // テキストのクリーンアップ（制御文字を除去、改行は保持）
    const cleanText = pageText
      .replace(/[^\x20-\x7E\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\n]/g, '')
      .trim();

    if (!cleanText) {
      this.debugError('クリーンアップ後のテキストが空です');
      return;
    }

    // ARグラスにページテキストとページ情報を表示
    const displayText = `${cleanText}\n\n${pageInfo}`;
    this.debugLog(`ページ表示: ${pageInfo}, テキスト長=${cleanText.length}`);

    // フォント設定関連のコード（現在はコメントアウト）
    // 注意: MentraOS SDKのshowTextWallは現在、fontSize、lineHeight、fontFamilyオプションをサポートしていません
    // 将来のSDK対応に備えてコードは残していますが、現在は動作しません
    // const settings = this.sessionDisplaySettings.get(sessionId) || {
    //   fontSize: 16,
    //   lineHeight: 1.5,
    //   fontFamily: 'default'
    // };
    // const fontFamilyMap: Record<string, string> = {
    //   'default': 'system-ui, -apple-system, sans-serif',
    //   'sans-serif': 'sans-serif',
    //   'serif': 'serif',
    //   'monospace': 'monospace'
    // };
    // const fontFamily = fontFamilyMap[settings.fontFamily] || fontFamilyMap['default'];
    // const displayOptions: any = {
    //   view: ViewType.MAIN
    // };
    // if (settings.fontSize) {
    //   displayOptions.fontSize = settings.fontSize;
    // }
    // if (settings.lineHeight) {
    //   displayOptions.lineHeight = settings.lineHeight;
    // }
    // if (fontFamily) {
    //   displayOptions.fontFamily = fontFamily;
    // }
    // console.log(`[デバッグ] 表示オプション:`, displayOptions);
    // session.layouts.showTextWall(displayText, displayOptions);
    // session.layouts.showTextWall(displayText, {
    //   ...displayOptions,
    //   view: ViewType.DASHBOARD
    // });

    // 現在は基本的な表示のみ（フォント設定なし）
    session.layouts.showTextWall(displayText, {
      view: ViewType.MAIN
    });

    // iPhoneアプリにも表示
    session.layouts.showTextWall(displayText, {
      view: ViewType.DASHBOARD
    });
  }

  // メディアコントローラーイベント用のAPIエンドポイントを設定
  private setupMediaControllerAPI(): void {
    const app = this.getExpressApp();

    // 既にルートが登録されているかチェック
    const routes = app._router?.stack || [];
    const hasMediaRoute = routes.some((layer: any) => 
      layer.route && layer.route.path === '/api/media/event'
    );
    
    if (hasMediaRoute) {
      this.debugLog('メディアコントローラーAPIエンドポイントは既に設定済みです');
      return;
    }

    // Webview認証ミドルウェアを適用
    app.use('/api/media', this.createAuthMiddlewareForPath('/api/media'));

    // 対応しているメディアイベント一覧を取得するエンドポイント
    app.get('/api/media/events', (req: any, res: any) => {
      const supportedEvents = {
        // ページング関連
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
        // その他のメディアコントロール
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

    // メディアコントローラーイベントを受け取るエンドポイント
    app.post('/api/media/event', async (req: any, res: any) => {
      try {
        this.debugLog('/api/media/event リクエスト受信', { body: req.body, authUserId: (req as any).authUserId });
        
        const userId = (req as any).authUserId;
        let sessionId: string | undefined;
        let session: AppSession | undefined;

        if (userId) {
          this.debugLog('Webview認証成功: userId=', userId);
          sessionId = this.userIdToSessionId.get(userId);
          if (sessionId) {
            session = this.sessions.get(sessionId);
          }
        } else {
          this.debugLog('Webview認証なし、セッションIDから検索');
          sessionId = req.body.sessionId || req.query.sessionId;
          if (sessionId) {
            session = this.sessions.get(sessionId);
          }
        }

        if (!session) {
          this.debugError('セッションが見つかりません', { userId, sessionId, availableSessions: Array.from(this.sessions.keys()) });
          return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
        }

        const eventType = req.body.eventType || req.body.event;
        
        if (!eventType) {
          this.debugError('eventTypeが指定されていません');
          return res.status(400).json({ success: false, error: 'eventTypeが必要です' });
        }

        this.debugLog('メディアイベント処理開始: eventType=', eventType);

        // メディアイベントに応じて処理
        await this.handleMediaEvent(session, eventType, req.body);

        // ページ情報を取得（nextpage/prevpageの場合）
        let pageInfo: { currentPage: number; totalPages: number; pageInfo: string } | null = null;
        if (eventType.toLowerCase() === 'nextpage' || eventType.toLowerCase() === 'prevpage') {
          const pager = this.sessionPagers.get(sessionId!);
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

  // メディアイベントを処理（ページング処理はサーバー側で実行）
  private async handleMediaEvent(session: AppSession, eventType: string, data: any): Promise<void> {
    const eventTypeLower = eventType.toLowerCase().trim();
    this.debugLog(`メディアイベント受信: ${eventType} (${eventTypeLower})`);

    // セッションIDを取得
    let sessionId: string | undefined;
    for (const [id, s] of this.sessions.entries()) {
      if (s === session) {
        sessionId = id;
        break;
      }
    }

    if (!sessionId) {
      this.debugError('セッションIDが見つかりません');
      return;
    }

    // nextpage/prevpageの場合はページング処理
    if (eventTypeLower === 'nextpage' || eventTypeLower === 'prevpage') {
      this.debugLog(`ページング処理開始: eventType=${eventTypeLower}`);
      const pager = this.sessionPagers.get(sessionId);
      
      if (!pager) {
        this.debugError('TextPagerが見つかりません', { sessionPagersKeys: Array.from(this.sessionPagers.keys()) });
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

      await this.displayCurrentPage(session, sessionId);
      return;
    }

    // その他のイベントメッセージの定義
    const eventMessages: Record<string, string> = {
      'play': '再生ボタンが押されました ▶️',
      'pause': '一時停止ボタンが押されました ⏸️',
      'stop': '停止ボタンが押されました ⏹️',
      'playpause': '再生/一時停止ボタンが押されました ⏯️',
      'skipforward': '早送りボタンが押されました ⏩',
      'skipbackward': '巻き戻しボタンが押されました ⏪',
    };

    const message = eventMessages[eventTypeLower] || `${eventType}ボタンが押されました`;
    this.debugLog(`[メディアイベント] ${eventType}: ${message}`);

    // ARグラスに表示
    session.layouts.showTextWall(message, {
      view: ViewType.MAIN,
      durationMs: 5000
    });

    // iPhoneアプリにも表示
    session.layouts.showTextWall(message, {
      view: ViewType.DASHBOARD,
      durationMs: 5000
    });
  }

  // 音声プレーヤー用のAPIエンドポイントを設定
  private setupAudioAPI(): void {
    const app = this.getExpressApp();
    
    // Webview認証ミドルウェアを適用
    app.use('/api/audio', this.createAuthMiddlewareForPath('/api/audio'));

    // 音声ファイル一覧を取得
    app.get('/api/audio/files', (req: any, res: any) => {
      try {
        if (!AUDIO_SOURCE_DIR || !fs.existsSync(AUDIO_SOURCE_DIR)) {
          this.debugLog('AUDIO_SOURCE_DIRが設定されていません、またはディレクトリが存在しません');
          return res.json({ success: true, files: [] });
        }

        const files = fs.readdirSync(AUDIO_SOURCE_DIR);
        const audioFiles: Array<{ id: string; name: string }> = [];

        for (const file of files) {
          if (file.toLowerCase().endsWith('.wav')) {
            const baseName = path.basename(file, '.wav');
            const srtPath = path.join(AUDIO_SOURCE_DIR, `${baseName}.srt`);
            
            // 対応するSRTファイルが存在する場合のみ追加
            if (fs.existsSync(srtPath)) {
              audioFiles.push({
                id: baseName,
                name: file
              });
            }
          }
        }

        this.debugLog(`音声ファイル一覧取得: ${audioFiles.length}件`);
        res.json({ success: true, files: audioFiles });
      } catch (error: any) {
        console.error('[エラー] 音声ファイル一覧取得エラー:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // HTTP Range対応の音声ストリーミング
    app.get('/api/audio/stream/:id', (req: any, res: any) => {
      try {
        if (!AUDIO_SOURCE_DIR) {
          return res.status(404).json({ success: false, error: 'AUDIO_SOURCE_DIRが設定されていません' });
        }

        const audioId = req.params.id;
        const audioPath = path.join(AUDIO_SOURCE_DIR, `${audioId}.wav`);

        if (!fs.existsSync(audioPath)) {
          return res.status(404).json({ success: false, error: '音声ファイルが見つかりません' });
        }

        const stat = fs.statSync(audioPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
          // HTTP Rangeリクエストの処理
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(audioPath, { start, end });
          const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'audio/wav',
          };

          res.writeHead(206, head);
          file.pipe(res);
        } else {
          // 通常のリクエスト（全ファイルを返す）
          const head = {
            'Content-Length': fileSize,
            'Content-Type': 'audio/wav',
          };
          res.writeHead(200, head);
          fs.createReadStream(audioPath).pipe(res);
        }
      } catch (error: any) {
        console.error('[エラー] 音声ストリーミングエラー:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 字幕データを取得
    app.get('/api/audio/subtitles/:id', (req: any, res: any) => {
      try {
        if (!AUDIO_SOURCE_DIR) {
          return res.status(404).json({ success: false, error: 'AUDIO_SOURCE_DIRが設定されていません' });
        }

        const audioId = req.params.id;
        const srtPath = path.join(AUDIO_SOURCE_DIR, `${audioId}.srt`);

        if (!fs.existsSync(srtPath)) {
          return res.status(404).json({ success: false, error: '字幕ファイルが見つかりません' });
        }

        // キャッシュを確認
        if (this.subtitleCache.has(audioId)) {
          const subtitles = this.subtitleCache.get(audioId)!;
          this.debugLog(`字幕データ取得（キャッシュ）: ${audioId}, ${subtitles.length}件`);
          return res.json({ success: true, subtitles });
        }

        // SRTファイルを読み込んでパース
        const srtContent = fs.readFileSync(srtPath, 'utf-8');
        const subtitles = SRTParser.parse(srtContent);
        
        // キャッシュに保存
        this.subtitleCache.set(audioId, subtitles);
        
        this.debugLog(`字幕データ取得: ${audioId}, ${subtitles.length}件`);
        res.json({ success: true, subtitles });
      } catch (error: any) {
        console.error('[エラー] 字幕データ取得エラー:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // 音声再生状態を更新（ARグラスに字幕を表示）
    app.post('/api/audio/state', async (req: any, res: any) => {
      try {
        const userId = (req as any).authUserId;
        
        if (!userId) {
          return res.status(401).json({ success: false, error: '認証が必要です' });
        }

        const sessionId = this.userIdToSessionId.get(userId);
        if (!sessionId) {
          return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
        }

        const session = this.sessions.get(sessionId);
        if (!session) {
          return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
        }

        const { subtitleText } = req.body;

        if (subtitleText && subtitleText.trim()) {
          const cleanText = subtitleText.trim();
          session.layouts.showTextWall(cleanText, {
            view: ViewType.MAIN
          });
          this.debugLog(`字幕をARグラスに表示: ${cleanText.substring(0, 50)}...`);
        }

        res.json({ success: true });
      } catch (error: any) {
        console.error('[エラー] 音声状態更新エラー:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }
}

// Start the server
// DEV CONSOLE URL: https://console.mentra.glass/
// Get your webhook URL from ngrok (or whatever public URL you have)
const app = new ExampleMentraOSApp();

app.start().catch(console.error);