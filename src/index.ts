// メインアプリケーションエントリーポイント
import { AppServer, AppSession, ViewType } from '@mentra/sdk';
import { TextPager } from './services/text/TextPager';
import { SubtitleEntry } from './services/audio/SRTParser';
import { setupFileAPI, FileAPIDependencies } from './api/file.api';
import { setupMediaControllerAPI, MediaAPIDependencies } from './api/media.api';
import { setupAudioAPI, AudioAPIDependencies } from './api/audio.api';
import { createAuthMiddleware } from './utils/auth';
import { debugLog, debugError } from './utils/debug';
import {
  PACKAGE_NAME,
  MENTRAOS_API_KEY,
  PORT,
  COOKIE_SECRET
} from './utils/config';

class ExampleMentraOSApp extends AppServer {
  // セッション管理
  private sessions: Map<string, AppSession> = new Map();
  private userIdToSessionId: Map<string, string> = new Map();
  private sessionTexts: Map<string, string> = new Map();
  private sessionPagers: Map<string, TextPager> = new Map();
  private subtitleCache: Map<string, SubtitleEntry[]> = new Map();
  private sessionFileTypes: Map<string, string> = new Map();

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
      publicDir: './public',
      cookieSecret: COOKIE_SECRET,
    });
    
    // APIエンドポイントを設定
    this.setupAPIs();
  }

  // 認証ミドルウェアの設定を共通化
  private createAuthMiddlewareForPath(path: string) {
    return createAuthMiddleware((userId: string) => {
      const sessionId = this.userIdToSessionId.get(userId);
      return sessionId ? this.sessions.get(sessionId) || null : null;
    });
  }

  // APIエンドポイントを設定
  private setupAPIs(): void {
    const app = this.getExpressApp();

    // ファイルAPI
    const fileDeps: FileAPIDependencies = {
      sessions: this.sessions,
      userIdToSessionId: this.userIdToSessionId,
      sessionTexts: this.sessionTexts,
      sessionPagers: this.sessionPagers,
      sessionFileTypes: this.sessionFileTypes,
      getAppSessionForUser: (userId: string) => {
        const sessionId = this.userIdToSessionId.get(userId);
        return sessionId ? this.sessions.get(sessionId) || null : null;
      }
    };
    setupFileAPI(app, fileDeps);

    // メディアコントローラーAPI
    const mediaDeps: MediaAPIDependencies = {
      sessions: this.sessions,
      userIdToSessionId: this.userIdToSessionId,
      sessionPagers: this.sessionPagers,
      getAppSessionForUser: (userId: string) => {
        const sessionId = this.userIdToSessionId.get(userId);
        return sessionId ? this.sessions.get(sessionId) || null : null;
      }
    };
    setupMediaControllerAPI(app, mediaDeps, (path: string) => this.createAuthMiddlewareForPath(path));

    // 音声プレーヤーAPI
    const audioDeps: AudioAPIDependencies = {
      sessions: this.sessions,
      userIdToSessionId: this.userIdToSessionId,
      subtitleCache: this.subtitleCache,
      getAppSessionForUser: (userId: string) => {
        const sessionId = this.userIdToSessionId.get(userId);
        return sessionId ? this.sessions.get(sessionId) || null : null;
      }
    };
    setupAudioAPI(app, audioDeps, (path: string) => this.createAuthMiddlewareForPath(path));
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    try {
      debugLog(`onSession開始: sessionId=${sessionId}, userId=${userId}`);
      
      // セッションを保存
      this.sessions.set(sessionId, session);
      this.userIdToSessionId.set(userId, sessionId);
      debugLog(`セッション保存完了`);
      debugLog(`userIdToSessionIdマップの状態:`, Array.from(this.userIdToSessionId.entries()));
      debugLog(`sessionsマップの状態:`, Array.from(this.sessions.keys()));

      // セッション開始時に案内を表示
      session.layouts.showTextWall("ボタンを押してください", {
        view: ViewType.MAIN
      });
      
      session.layouts.showTextWall(`セッションID: ${sessionId}\nボタンを押してください`, {
        view: ViewType.DASHBOARD
      });

      // セッション終了時のクリーンアップ
      session.events.onDisconnected(() => {
        debugLog(`セッション終了: sessionId=${sessionId}`);
        this.sessions.delete(sessionId);
        this.sessionTexts.delete(sessionId);
        this.sessionPagers.delete(sessionId);
        this.sessionFileTypes.delete(sessionId);
        this.userIdToSessionId.delete(userId);
      });

      debugLog(`onSession完了`);
    } catch (error: any) {
      console.error(`[エラー] onSessionエラー:`, error);
      throw error;
    }
  }
}

// サーバーを起動
const app = new ExampleMentraOSApp();
app.start().catch(console.error);
