import { AppServer, AppSession, ViewType } from '@mentra/sdk';


const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');

class ExampleMentraOSApp extends AppServer {

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
    });
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    // セッション開始時にHello Worldを表示（グラスとiPhoneアプリの両方に）
    // durationMsを指定しないと、次の表示まで残り続けます
    session.layouts.showTextWall("Hello World! 👋", {
      view: ViewType.MAIN
    });
    session.layouts.showTextWall("Hello World! 👋", {
      view: ViewType.DASHBOARD
    });

    // バッテリー情報を表示
    session.events.onGlassesBattery((data) => {
      console.log('Glasses battery:', data);
      // グラスに表示
      session.layouts.showTextWall(`バッテリー: ${data.level}%`, {
        view: ViewType.MAIN,
        durationMs: 5000
      });
      // iPhoneアプリにも表示
      session.layouts.showTextWall(`バッテリー: ${data.level}%`, {
        view: ViewType.DASHBOARD,
        durationMs: 5000
      });
    })

    // ライブキャプション機能（リアルタイム音声認識）
    // マイクの権限がデベロッパーコンソールで設定されている必要があります
    session.events.onTranscription((data) => {
      if (data.isFinal) {
        // 確定したテキストを表示
        session.layouts.showTextWall("聞こえました: " + data.text, {
          view: ViewType.MAIN,
          durationMs: 5000
        });
        session.layouts.showTextWall("聞こえました: " + data.text, {
          view: ViewType.DASHBOARD,
          durationMs: 5000
        });
      } else {
        // ライブキャプション：リアルタイムで更新される途中のテキスト
        session.layouts.showTextWall("聞いています: " + data.text, {
          view: ViewType.MAIN
        });
        session.layouts.showTextWall("聞いています: " + data.text, {
          view: ViewType.DASHBOARD
        });
      }
    })
  }
}

// Start the server
// DEV CONSOLE URL: https://console.mentra.glass/
// Get your webhook URL from ngrok (or whatever public URL you have)
const app = new ExampleMentraOSApp();

app.start().catch(console.error);