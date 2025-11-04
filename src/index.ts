import { AppServer, AppSession, ViewType } from '@mentra/sdk';

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'your-secret-key-change-this-in-production';
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const WEBVIEW_URL = process.env.WEBVIEW_URL || `${SERVER_URL}/webview/`;

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

class ExampleMentraOSApp extends AppServer {
  // セッションごとのセッションオブジェクトを管理
  private sessions: Map<string, AppSession> = new Map();
  // ユーザーIDからセッションIDを取得するマップ
  private userIdToSessionId: Map<string, string> = new Map();
  // セッションごとのテキストコンテンツを管理（/api/textエンドポイント用）
  private sessionTexts: Map<string, string> = new Map();
  // セッションごとのページング状態を管理（サーバー側でページング処理）
  private sessionPagers: Map<string, TextPager> = new Map();
  // APIエンドポイントが既に設定されたかどうか
  private apiEndpointsSetup: boolean = false;

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
      publicDir: './public', // Webview用の静的ファイルをホスト
      cookieSecret: COOKIE_SECRET, // Cookie署名用の秘密鍵を設定
    });
    
    // APIエンドポイントをコンストラクタで設定（サーバー起動時に利用可能にする）
    this.setupFileAPI();
    this.setupMediaControllerAPI();
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    try {
      console.log(`[デバッグ] onSession開始: sessionId=${sessionId}, userId=${userId}`);
      
      // セッションを保存
      this.sessions.set(sessionId, session);
      this.userIdToSessionId.set(userId, sessionId);
      console.log(`[デバッグ] セッション保存完了`);

      // セッション開始時に案内を表示
      console.log(`[デバッグ] テキスト表示開始`);
      session.layouts.showTextWall("ボタンを押してください", {
        view: ViewType.MAIN
      });
      console.log(`[デバッグ] ARグラスに表示成功`);
      
      session.layouts.showTextWall(`セッションID: ${sessionId}\nボタンを押してください`, {
        view: ViewType.DASHBOARD
      });
      console.log(`[デバッグ] iPhoneアプリに表示成功`);

      // APIエンドポイントはコンストラクタで設定済み（サーバー起動時に利用可能）

      // セッション終了時のクリーンアップ
      session.events.onDisconnected(() => {
        console.log(`[デバッグ] セッション終了: sessionId=${sessionId}`);
        this.sessions.delete(sessionId);
        this.sessionTexts.delete(sessionId);
        this.sessionPagers.delete(sessionId);
        this.userIdToSessionId.delete(userId);
      });

      console.log(`[デバッグ] onSession完了`);
    } catch (error: any) {
      console.error(`[デバッグ] onSessionエラー:`, error);
      console.error(`[デバッグ] エラーメッセージ:`, error.message);
      console.error(`[デバッグ] エラースタック:`, error.stack);
      throw error; // エラーを再スローして、AppServerに伝える
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
      console.log('[デバッグ] APIエンドポイントは既に設定済みです');
      return;
    }

    const multer = require('multer');
    const upload = multer({ storage: multer.memoryStorage() });

    // 全てのリクエストをログに記録（デバッグ用）
    app.use('/api', (req: any, res: any, next: any) => {
      console.log(`[デバッグ] リクエスト受信: ${req.method} ${req.path}`);
      console.log(`[デバッグ] リクエストヘッダー:`, {
        'content-type': req.headers['content-type'],
        'origin': req.headers['origin'],
        'referer': req.headers['referer'],
        'user-agent': req.headers['user-agent']
      });
      next();
    });

    // 注意: AppServerのコンストラクタで既にcookie-parserと認証ミドルウェアが設定されているため、
    // ここでは重複して設定しない

    // テキストファイルをアップロードして表示
    app.post('/api/upload-text', upload.single('file'), async (req: any, res: any) => {
      try {
        console.log('[デバッグ] /api/upload-text リクエスト受信');
        const userId = (req as any).authUserId;
        console.log('[デバッグ] userId:', userId);
        
        if (!userId) {
          console.error('[デバッグ] 認証エラー: userIdが見つかりません');
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

        // サーバー側でページング処理を初期化
        const pager = new TextPager(textContent);
        this.sessionPagers.set(sessionId, pager);
        console.log(`[デバッグ] TextPager初期化完了: ページ数=${pager.getTotalPages()}`);

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
  }

  // 現在のページをARグラスに表示（サーバー側でページング管理）
  private async displayCurrentPage(session: AppSession, sessionId: string): Promise<void> {
    const pager = this.sessionPagers.get(sessionId);
    if (!pager) {
      console.error(`[デバッグ] TextPagerが見つかりません: sessionId=${sessionId}`);
      return;
    }

    const pageText = pager.getCurrentPage();
    const pageInfo = pager.getPageInfo();

    if (!pageText) {
      console.error('[デバッグ] ページテキストが空です');
      return;
    }

    // テキストのクリーンアップ（制御文字を除去、改行は保持）
    const cleanText = pageText
      .replace(/[^\x20-\x7E\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\n]/g, '')
      .trim();

    if (!cleanText) {
      console.error('[デバッグ] クリーンアップ後のテキストが空です');
      return;
    }

    // ARグラスにページテキストとページ情報を表示
    const displayText = `${cleanText}\n\n${pageInfo}`;
    console.log(`[デバッグ] ページ表示: ${pageInfo}, テキスト長=${cleanText.length}`);

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
      console.log('[デバッグ] メディアコントローラーAPIエンドポイントは既に設定済みです');
      return;
    }

    // Webview認証ミドルウェアを適用
    // package.jsonのexportsに定義されていないため、絶対パスで直接読み込む
    const path = require('path');
    const webviewPath = path.join(__dirname, '../node_modules/@mentra/sdk/dist/app/webview/index.js');
    const { createAuthMiddleware } = require(webviewPath);
    app.use('/api/media', createAuthMiddleware({
      apiKey: MENTRAOS_API_KEY,
      packageName: PACKAGE_NAME,
      cookieSecret: COOKIE_SECRET,
      getAppSessionForUser: (userId: string) => {
        const sessionId = this.userIdToSessionId.get(userId);
        return sessionId ? this.sessions.get(sessionId) || null : null;
      }
    }));

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
    // iOSアプリ側から、Bluetoothコントローラーのイベントを送信する
    app.post('/api/media/event', async (req: any, res: any) => {
      try {
        console.log('[デバッグ] /api/media/event リクエスト受信');
        console.log('[デバッグ] req.body:', JSON.stringify(req.body));
        console.log('[デバッグ] req.authUserId:', (req as any).authUserId);
        
        // 認証されたユーザーIDを取得
        const userId = (req as any).authUserId;
        
        // 認証されていない場合は、セッションIDを直接受け取ることも可能
        let sessionId: string | undefined;
        let session: AppSession | undefined;

        if (userId) {
          // Webview認証が成功した場合
          console.log('[デバッグ] Webview認証成功: userId=', userId);
          sessionId = this.userIdToSessionId.get(userId);
          if (sessionId) {
            session = this.sessions.get(sessionId);
          }
        } else {
          // iOSアプリ側から直接送信する場合（セッションIDを直接受け取る）
          console.log('[デバッグ] Webview認証なし、セッションIDから検索');
          sessionId = req.body.sessionId || req.query.sessionId;
          if (sessionId) {
            session = this.sessions.get(sessionId);
          }
        }

        if (!session) {
          console.error('[デバッグ] セッションが見つかりません。userId:', userId, 'sessionId:', sessionId);
          console.error('[デバッグ] 利用可能なセッション:', Array.from(this.sessions.keys()));
          return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
        }

        // メディアイベントタイプを取得
        const eventType = req.body.eventType || req.body.event;
        
        if (!eventType) {
          console.error('[デバッグ] eventTypeが指定されていません');
          return res.status(400).json({ success: false, error: 'eventTypeが必要です' });
        }

        console.log('[デバッグ] メディアイベント処理開始: eventType=', eventType);

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
        console.error('[デバッグ] /api/media/event エラー:', error);
        console.error('[デバッグ] エラーメッセージ:', error.message);
        console.error('[デバッグ] エラースタック:', error.stack);
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  // メディアイベントを処理（ページング処理はサーバー側で実行）
  private async handleMediaEvent(session: AppSession, eventType: string, data: any): Promise<void> {
    const eventTypeLower = eventType.toLowerCase().trim();
    console.log(`[デバッグ] メディアイベント受信: ${eventType} (${eventTypeLower})`);

    // セッションIDを取得（dataから直接取得するか、sessionsマップから逆引き）
    let sessionId: string | undefined;
    for (const [id, s] of this.sessions.entries()) {
      if (s === session) {
        sessionId = id;
        break;
      }
    }

    if (!sessionId) {
      console.error('[デバッグ] セッションIDが見つかりません');
      return;
    }

    console.log(`[デバッグ] セッションID取得: ${sessionId}`);
    console.log(`[デバッグ] イベントタイプチェック: eventTypeLower="${eventTypeLower}", nextpage一致=${eventTypeLower === 'nextpage'}, prevpage一致=${eventTypeLower === 'prevpage'}`);

    // nextpage/prevpageの場合はページング処理
    if (eventTypeLower === 'nextpage' || eventTypeLower === 'prevpage') {
      console.log(`[デバッグ] ページング処理開始: eventType=${eventTypeLower}`);
      const pager = this.sessionPagers.get(sessionId);
      console.log(`[デバッグ] TextPager取得: ${pager ? '見つかりました' : '見つかりません'}`);
      
      if (!pager) {
        console.error('[デバッグ] TextPagerが見つかりません。テキストがアップロードされていない可能性があります。');
        console.error(`[デバッグ] 現在のsessionPagersキー: ${Array.from(this.sessionPagers.keys()).join(', ')}`);
        // エラーメッセージを表示
        session.layouts.showTextWall('テキストがアップロードされていません', {
          view: ViewType.MAIN,
          durationMs: 3000
        });
        return;
      }

      let moved = false;
      if (eventTypeLower === 'nextpage') {
        console.log(`[デバッグ] 次へボタン処理: 現在のページ=${pager.getCurrentPageNumber()}/${pager.getTotalPages()}`);
        moved = pager.nextPage();
        console.log(`[デバッグ] 次へボタン結果: moved=${moved}, 新しいページ=${pager.getCurrentPageNumber()}/${pager.getTotalPages()}`);
        if (!moved) {
          console.log('[デバッグ] 最後のページです');
          session.layouts.showTextWall('最後のページです', {
            view: ViewType.MAIN,
            durationMs: 2000
          });
          return;
        }
      } else if (eventTypeLower === 'prevpage') {
        console.log(`[デバッグ] 前へボタン処理: 現在のページ=${pager.getCurrentPageNumber()}/${pager.getTotalPages()}`);
        moved = pager.prevPage();
        console.log(`[デバッグ] 前へボタン結果: moved=${moved}, 新しいページ=${pager.getCurrentPageNumber()}/${pager.getTotalPages()}`);
        if (!moved) {
          console.log('[デバッグ] 最初のページです');
          session.layouts.showTextWall('最初のページです', {
            view: ViewType.MAIN,
            durationMs: 2000
          });
          return;
        }
      }

      // 現在のページを表示
      console.log(`[デバッグ] ページ表示処理開始`);
      await this.displayCurrentPage(session, sessionId);
      console.log(`[デバッグ] ページ表示処理完了`);
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
    console.log(`[メディアイベント] ${eventType}: ${message} (ページング処理以外のイベント)`);

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
}

// Start the server
// DEV CONSOLE URL: https://console.mentra.glass/
// Get your webhook URL from ngrok (or whatever public URL you have)
const app = new ExampleMentraOSApp();

app.start().catch(console.error);