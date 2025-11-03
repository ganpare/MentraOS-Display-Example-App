import { AppServer, AppSession, ViewType } from '@mentra/sdk';

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'your-secret-key-change-this-in-production';
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;
const WEBVIEW_URL = process.env.WEBVIEW_URL || `${SERVER_URL}/webview/`;

// テキストページング処理はクライアント側（Webview）で実行するため、サーバー側では不要

class ExampleMentraOSApp extends AppServer {
  // セッションごとのセッションオブジェクトを管理
  private sessions: Map<string, AppSession> = new Map();
  // ユーザーIDからセッションIDを取得するマップ
  private userIdToSessionId: Map<string, string> = new Map();
  // セッションごとのテキストコンテンツを管理（/api/textエンドポイント用）
  private sessionTexts: Map<string, string> = new Map();
  // APIエンドポイントが既に設定されたかどうか
  private apiEndpointsSetup: boolean = false;

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
      publicDir: './public', // Webview用の静的ファイルをホスト
    });
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

      // APIエンドポイントを一度だけ設定（最初のセッション時のみ）
      if (!this.apiEndpointsSetup) {
        console.log(`[デバッグ] APIエンドポイント設定開始`);
        try {
          this.setupFileAPI();
          this.setupMediaControllerAPI();
          this.apiEndpointsSetup = true;
          console.log(`[デバッグ] APIエンドポイント設定完了`);
        } catch (error: any) {
          console.error(`[デバッグ] APIエンドポイント設定エラー:`, error);
          console.error(`[デバッグ] エラーメッセージ:`, error.message);
          console.error(`[デバッグ] エラースタック:`, error.stack);
          // エラーがあってもセッションは続行
        }
      }

      // セッション終了時のクリーンアップ
      session.events.onDisconnected(() => {
        console.log(`[デバッグ] セッション終了: sessionId=${sessionId}`);
        this.sessions.delete(sessionId);
        this.sessionTexts.delete(sessionId);
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
    const cookieParser = require('cookie-parser');
    
    // cookie-parserは一度だけ設定
    app.use(cookieParser());

    // Webview認証ミドルウェアを適用
    // package.jsonのexportsに定義されていないため、絶対パスで直接読み込む
    const path = require('path');
    const webviewPath = path.join(__dirname, '../node_modules/@mentra/sdk/dist/app/webview/index.js');
    const { createAuthMiddleware } = require(webviewPath);
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

        // セッションごとにテキストを保存（クライアント側でページング処理を行うため、サーバー側では保存のみ）
        this.sessionTexts.set(sessionId, textContent);
        console.log(`[デバッグ] テキストを受信: 長さ=${textContent.length}文字`);

        res.json({ 
          success: true, 
          message: 'テキストを受信しました',
          textLength: textContent.length
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // テキストをARグラスに表示するエンドポイント（クライアント側からページング済みテキストを受け取る）
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

        const text = req.body.text;

        if (!text) {
          return res.status(400).json({ success: false, error: 'テキストが必要です' });
        }

        // テキストのクリーンアップ（制御文字を除去、改行は保持）
        const cleanText = text
          .replace(/[^\x20-\x7E\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\n]/g, '')
          .trim();

        if (!cleanText) {
          return res.status(400).json({ success: false, error: '有効なテキストが見つかりません' });
        }

        // ARグラスに表示（クライアント側でページング済み）
        session.layouts.showTextWall(cleanText, {
          view: ViewType.MAIN
        });

        // iPhoneアプリにも表示
        session.layouts.showTextWall(cleanText, {
          view: ViewType.DASHBOARD
        });

        res.json({ success: true, message: 'テキストを表示しました' });
      } catch (error: any) {
        console.error('[デバッグ] /api/display-text エラー:', error);
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

        res.json({ 
          success: true, 
          message: `メディアイベント「${eventType}」を処理しました`,
          eventType
        });
      } catch (error: any) {
        console.error('[デバッグ] /api/media/event エラー:', error);
        console.error('[デバッグ] エラーメッセージ:', error.message);
        console.error('[デバッグ] エラースタック:', error.stack);
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  // メディアイベントを処理（ページング処理はクライアント側で実行するため、ここではその他のイベントのみ処理）
  private async handleMediaEvent(session: AppSession, eventType: string, data: any): Promise<void> {
    const eventTypeLower = eventType.toLowerCase();
    console.log(`[デバッグ] メディアイベント受信: ${eventType} (${eventTypeLower})`);

    // イベントメッセージの定義
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
}

// Start the server
// DEV CONSOLE URL: https://console.mentra.glass/
// Get your webhook URL from ngrok (or whatever public URL you have)
const app = new ExampleMentraOSApp();

app.start().catch(console.error);