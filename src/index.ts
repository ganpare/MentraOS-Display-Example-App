import { AppServer, AppSession, ViewType } from '@mentra/sdk';

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'your-secret-key-change-this-in-production';

// テキストページ管理クラス
class TextPager {
  private pages: string[] = [];
  private currentPage: number = 0;
  private maxCharsPerPage: number = 150; // 1ページあたりの最大文字数

  constructor(text: string, maxCharsPerPage: number = 150) {
    this.maxCharsPerPage = maxCharsPerPage;
    this.splitIntoPages(text);
  }

  // テキストをページに分割
  private splitIntoPages(text: string): void {
    this.pages = [];
    if (!text || text.trim().length === 0) {
      this.pages = [''];
      console.log('[デバッグ] テキストが空です');
      return;
    }

    // テキストをクリーンアップ
    const cleanText = text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();

    console.log(`[デバッグ] クリーンアップ後のテキスト長: ${cleanText.length}文字`);

    // 改行で分割してから、各段落を処理
    const paragraphs = cleanText.split('\n');
    console.log(`[デバッグ] 段落数: ${paragraphs.length}`);
    
    let currentPage = '';
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      const trimmedParagraph = paragraph.trim();
      if (!trimmedParagraph) {
        // 空行は現在のページに追加
        if (currentPage) {
          currentPage += '\n';
        }
        continue;
      }

      // 段落が1ページに収まる場合
      if ((currentPage + trimmedParagraph).length <= this.maxCharsPerPage) {
        if (currentPage) {
          currentPage += '\n';
        }
        currentPage += trimmedParagraph;
      } else {
        // 現在のページを保存
        if (currentPage) {
          this.pages.push(currentPage.trim());
          console.log(`[デバッグ] ページ${this.pages.length}を作成: ${currentPage.length}文字`);
          currentPage = '';
        }

        // 段落が長い場合は、さらに分割
        let remaining = trimmedParagraph;
        while (remaining.length > 0) {
          if (remaining.length <= this.maxCharsPerPage) {
            currentPage = remaining;
            remaining = '';
          } else {
            // 最大文字数で分割（空白で区切る）
            let splitIndex = this.maxCharsPerPage;
            const lastSpaceIndex = remaining.lastIndexOf(' ', this.maxCharsPerPage);
            if (lastSpaceIndex > this.maxCharsPerPage * 0.7) { // 70%以上なら空白で分割
              splitIndex = lastSpaceIndex;
            }

            const pageText = remaining.substring(0, splitIndex).trim();
            this.pages.push(pageText);
            console.log(`[デバッグ] ページ${this.pages.length}を作成（分割）: ${pageText.length}文字`);
            remaining = remaining.substring(splitIndex).trim();
          }
        }
      }
    }

    // 最後のページを追加
    if (currentPage) {
      this.pages.push(currentPage.trim());
      console.log(`[デバッグ] ページ${this.pages.length}を作成（最後）: ${currentPage.length}文字`);
    }

    // ページが空の場合は空ページを追加
    if (this.pages.length === 0) {
      this.pages = [''];
      console.log('[デバッグ] ページが空のため空ページを追加');
    }

    console.log(`[デバッグ] ページ分割完了: 合計${this.pages.length}ページ`);
  }

  // 現在のページを取得
  getCurrentPage(): string {
    return this.pages[this.currentPage] || '';
  }

  // 次のページへ
  nextPage(): boolean {
    if (this.currentPage < this.pages.length - 1) {
      this.currentPage++;
      return true;
    }
    return false;
  }

  // 前のページへ
  prevPage(): boolean {
    if (this.currentPage > 0) {
      this.currentPage--;
      return true;
    }
    return false;
  }

  // 現在のページ番号を取得（1ベース）
  getCurrentPageNumber(): number {
    return this.currentPage + 1;
  }

  // 総ページ数を取得
  getTotalPages(): number {
    return this.pages.length;
  }

  // ページ情報を取得
  getPageInfo(): string {
    return `${this.getCurrentPageNumber()}/${this.getTotalPages()}`;
  }
}

class ExampleMentraOSApp extends AppServer {
  // セッションごとのセッションオブジェクトを管理
  private sessions: Map<string, AppSession> = new Map();
  // ユーザーIDからセッションIDを取得するマップ
  private userIdToSessionId: Map<string, string> = new Map();
  // セッションごとのテキストコンテンツを管理
  private sessionTexts: Map<string, string> = new Map();
  // セッションごとのテキストページ管理
  private sessionPagers: Map<string, TextPager> = new Map();

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
      publicDir: './public', // Webview用の静的ファイルをホスト
    });
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    // セッションを保存
    this.sessions.set(sessionId, session);
    this.userIdToSessionId.set(userId, sessionId);

    // セッション開始時に案内を表示
    session.layouts.showTextWall("ボタンを押してください", {
      view: ViewType.MAIN
    });
    
    session.layouts.showTextWall(`セッションID: ${sessionId}\nボタンを押してください`, {
      view: ViewType.DASHBOARD
    });

    // APIエンドポイントを設定（一度だけ）
    if (!this.sessions.has('apiSetup')) {
      this.setupFileAPI();
      this.setupMediaControllerAPI();
      this.sessions.set('apiSetup', session);
    }

    // セッション終了時のクリーンアップ
    session.events.onDisconnected(() => {
      this.sessions.delete(sessionId);
      this.sessionTexts.delete(sessionId);
      this.sessionPagers.delete(sessionId);
      this.userIdToSessionId.delete(userId);
    });
  }

  // ファイル受け取りと表示用のAPIエンドポイントを設定
  private setupFileAPI(): void {
    const app = this.getExpressApp();
    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage() });
    const cookieParser = require('cookie-parser');
    
    app.use(cookieParser());

    // Webview認証ミドルウェアを適用
    const { createAuthMiddleware } = require('@mentra/sdk/dist/app/webview');
    app.use('/api', createAuthMiddleware({
      apiKey: MENTRAOS_API_KEY,
      packageName: PACKAGE_NAME,
      cookieSecret: COOKIE_SECRET,
      getAppSessionForUser: (userId: string) => {
        const sessionId = this.userIdToSessionId.get(userId);
        return sessionId ? this.sessions.get(sessionId) || null : null;
      }
    }));

    // テキストファイルをアップロードして表示
    app.post('/api/upload-text', upload.single('file'), async (req: any, res: any) => {
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

        let textContent = '';

        if (req.file) {
          // ファイルがアップロードされた場合
          textContent = req.file.buffer.toString('utf-8');
        } else if (req.body.text) {
          // テキストが直接送信された場合
          textContent = req.body.text;
        } else {
          return res.status(400).json({ success: false, error: 'ファイルまたはテキストが必要です' });
        }

        // セッションごとにテキストを保存
        this.sessionTexts.set(sessionId, textContent);
        console.log(`[デバッグ] テキストを受信: 長さ=${textContent.length}文字`);
        console.log(`[デバッグ] テキストの先頭50文字: ${textContent.substring(0, 50)}`);

        // テキストをページに分割して管理
        const pager = new TextPager(textContent);
        this.sessionPagers.set(sessionId, pager);
        console.log(`[デバッグ] ページ分割完了: ${pager.getTotalPages()}ページ`);

        // 最初のページを表示
        await this.displayCurrentPage(session, pager);

        res.json({ 
          success: true, 
          message: 'テキストをARグラスに表示しました',
          textLength: textContent.length
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // テキストをARグラスに表示するエンドポイント
    app.post('/api/display-text', async (req: any, res: any) => {
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

        const text = req.body.text || this.sessionTexts.get(sessionId);

        if (!text) {
          return res.status(404).json({ success: false, error: 'テキストが見つかりません' });
        }

        // テキストをページに分割して管理
        const pager = new TextPager(text);
        this.sessionPagers.set(sessionId, pager);

        // 最初のページを表示
        await this.displayCurrentPage(session, pager);

        res.json({ success: true, message: 'テキストを表示しました' });
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
  }

  // メディアコントローラーイベント用のAPIエンドポイントを設定
  private setupMediaControllerAPI(): void {
    const app = this.getExpressApp();

    // Webview認証ミドルウェアを適用
    const { createAuthMiddleware } = require('@mentra/sdk/dist/app/webview');
    app.use('/api/media', createAuthMiddleware({
      apiKey: MENTRAOS_API_KEY,
      packageName: PACKAGE_NAME,
      cookieSecret: COOKIE_SECRET,
      getAppSessionForUser: (userId: string) => {
        const sessionId = this.userIdToSessionId.get(userId);
        return sessionId ? this.sessions.get(sessionId) || null : null;
      }
    }));

    // メディアコントローラーイベントを受け取るエンドポイント
    // iOSアプリ側から、Bluetoothコントローラーのイベントを送信する
    app.post('/api/media/event', async (req: any, res: any) => {
      try {
        // 認証されたユーザーIDを取得
        const userId = (req as any).authUserId;
        
        // 認証されていない場合は、セッションIDを直接受け取ることも可能
        let sessionId: string | undefined;
        let session: AppSession | undefined;

        if (userId) {
          // Webview認証が成功した場合
          sessionId = this.userIdToSessionId.get(userId);
          if (sessionId) {
            session = this.sessions.get(sessionId);
          }
        } else {
          // iOSアプリ側から直接送信する場合（セッションIDを直接受け取る）
          sessionId = req.body.sessionId || req.query.sessionId;
          if (sessionId) {
            session = this.sessions.get(sessionId);
          }
        }

        if (!session) {
          return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
        }

        // メディアイベントタイプを取得
        const eventType = req.body.eventType || req.body.event;
        
        if (!eventType) {
          return res.status(400).json({ success: false, error: 'eventTypeが必要です' });
        }

        // メディアイベントに応じて処理
        await this.handleMediaEvent(session, eventType, req.body);

        res.json({ 
          success: true, 
          message: `メディアイベント「${eventType}」を処理しました`,
          eventType
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  // メディアイベントを処理
  private async handleMediaEvent(session: AppSession, eventType: string, data: any): Promise<void> {
    const eventTypeLower = eventType.toLowerCase();
    console.log(`[デバッグ] メディアイベント受信: ${eventType} (${eventTypeLower})`);
    
    // セッションIDを取得（userIdから逆引き）
    let sessionId: string | undefined;
    for (const [sid, s] of this.sessions.entries()) {
      if (s === session) {
        sessionId = sid;
        break;
      }
    }

    if (!sessionId) {
      console.error('[デバッグ] セッションIDが見つかりません');
      return;
    }

    console.log(`[デバッグ] セッションID: ${sessionId}`);

    // ページ操作
    if (eventTypeLower === 'nexttrack') {
      console.log('[デバッグ] 次のページへ移動');
      const pager = this.sessionPagers.get(sessionId);
      if (!pager) {
        console.error('[デバッグ] ページャーが見つかりません');
        session.layouts.showTextWall('テキストが読み込まれていません', {
          view: ViewType.MAIN,
          durationMs: 3000
        });
        return;
      }
      console.log(`[デバッグ] 現在のページ: ${pager.getPageInfo()}`);
      if (pager.nextPage()) {
        console.log(`[デバッグ] ページ移動成功: ${pager.getPageInfo()}`);
        await this.displayCurrentPage(session, pager);
        return;
      } else {
        console.log('[デバッグ] 最後のページです');
        session.layouts.showTextWall('最後のページです', {
          view: ViewType.MAIN,
          durationMs: 2000
        });
        return;
      }
    } else if (eventTypeLower === 'prevtrack') {
      console.log('[デバッグ] 前のページへ移動');
      const pager = this.sessionPagers.get(sessionId);
      if (!pager) {
        console.error('[デバッグ] ページャーが見つかりません');
        session.layouts.showTextWall('テキストが読み込まれていません', {
          view: ViewType.MAIN,
          durationMs: 3000
        });
        return;
      }
      console.log(`[デバッグ] 現在のページ: ${pager.getPageInfo()}`);
      if (pager.prevPage()) {
        console.log(`[デバッグ] ページ移動成功: ${pager.getPageInfo()}`);
        await this.displayCurrentPage(session, pager);
        return;
      } else {
        console.log('[デバッグ] 最初のページです');
        session.layouts.showTextWall('最初のページです', {
          view: ViewType.MAIN,
          durationMs: 2000
        });
        return;
      }
    }

    // その他のイベント
    const eventMessages: Record<string, string> = {
      'play': '再生ボタンが押されました ▶️',
      'pause': '一時停止ボタンが押されました ⏸️',
      'stop': '停止ボタンが押されました ⏹️',
      'playpause': '再生/一時停止ボタンが押されました ⏯️',
      'skipforward': '早送りボタンが押されました ⏩',
      'skipbackward': '巻き戻しボタンが押されました ⏪',
    };

    const message = eventMessages[eventTypeLower] || `${eventType}ボタンが押されました`;

    console.log(`[メディアイベント] ${eventType}: ${message}`);

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

  // 現在のページを表示
  private async displayCurrentPage(session: AppSession, pager: TextPager): Promise<void> {
    const pageText = pager.getCurrentPage();
    const pageInfo = pager.getPageInfo();

    console.log(`[デバッグ] ページ表示開始: ${pageInfo}`);
    console.log(`[デバッグ] ページテキスト長: ${pageText.length}文字`);
    console.log(`[デバッグ] ページテキストの先頭50文字: ${pageText.substring(0, 50)}`);

    if (!pageText) {
      console.error('[デバッグ] ページテキストが空です');
      return;
    }

    // テキストのクリーンアップ（制御文字を除去、改行は保持）
    const cleanText = pageText
      .replace(/[^\x20-\x7E\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\n]/g, '') // ASCII + 日本語文字 + 改行のみ許可
      .trim();

    console.log(`[デバッグ] クリーンアップ後のテキスト長: ${cleanText.length}文字`);

    if (!cleanText) {
      console.error('[デバッグ] クリーンアップ後のテキストが空です');
      return;
    }

    // ARグラスにページテキストとページ情報を表示
    const displayText = `${cleanText}\n\n${pageInfo}`;
    console.log(`[デバッグ] 表示テキスト長: ${displayText.length}文字`);
    console.log(`[デバッグ] 表示テキスト: ${displayText.substring(0, 100)}...`);
    
    try {
      session.layouts.showTextWall(displayText, {
        view: ViewType.MAIN
      });
      console.log('[デバッグ] ARグラスに表示成功');

      // iPhoneアプリにも表示
      session.layouts.showTextWall(displayText, {
        view: ViewType.DASHBOARD
      });
      console.log('[デバッグ] iPhoneアプリに表示成功');
    } catch (error: any) {
      console.error('[デバッグ] 表示エラー:', error);
      console.error('[デバッグ] エラーメッセージ:', error.message);
      console.error('[デバッグ] エラースタック:', error.stack);
    }
  }
}

// Start the server
// DEV CONSOLE URL: https://console.mentra.glass/
// Get your webhook URL from ngrok (or whatever public URL you have)
const app = new ExampleMentraOSApp();

app.start().catch(console.error);