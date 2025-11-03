# メディアコントローラーイベントテスト備忘録

## 📋 概要

Bluetoothコントローラー（メディアコントローラー）のイベントを受信して、ARグラスに表示するテスト実装。

## 🔗 APIエンドポイント

### メディアコントローラーイベント送信

**URL**: `https://mentra-app.sunandgo35.com/api/media/event`

**メソッド**: `POST`

**Content-Type**: `application/json`

**リクエストボディ**:
```json
{
  "eventType": "play",
  "sessionId": "your-session-id"
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "メディアイベント「play」を処理しました",
  "eventType": "play"
}
```

## 🎮 対応イベントタイプ

| eventType | 表示メッセージ |
|-----------|---------------|
| `play` | 再生ボタンが押されました ▶️ |
| `pause` | 一時停止ボタンが押されました ⏸️ |
| `stop` | 停止ボタンが押されました ⏹️ |
| `nexttrack` | 次の曲へボタンが押されました ⏭️ |
| `prevtrack` | 前の曲へボタンが押されました ⏮️ |
| `playpause` | 再生/一時停止ボタンが押されました ⏯️ |
| `skipforward` | 早送りボタンが押されました ⏩ |
| `skipbackward` | 巻き戻しボタンが押されました ⏪ |

## 🧪 テスト方法

### 1. セッションIDの取得

アプリを起動すると、iPhoneアプリのダッシュボードにセッションIDが表示されます。
例: `セッションID: abc123-def456-ghi789`

### 2. curlコマンドでテスト

```bash
# 再生ボタン
curl -X POST https://mentra-app.sunandgo35.com/api/media/event \
  -H "Content-Type: application/json" \
  -d '{"eventType": "play", "sessionId": "your-session-id"}'

# 次の曲へ
curl -X POST https://mentra-app.sunandgo35.com/api/media/event \
  -H "Content-Type: application/json" \
  -d '{"eventType": "nexttrack", "sessionId": "your-session-id"}'

# 前の曲へ
curl -X POST https://mentra-app.sunandgo35.com/api/media/event \
  -H "Content-Type: application/json" \
  -d '{"eventType": "prevtrack", "sessionId": "your-session-id"}'
```

### 3. iOSアプリ側からの送信（実装例）

```swift
func handleMediaControlEvent(eventType: String, sessionId: String) {
    let url = URL(string: "https://mentra-app.sunandgo35.com/api/media/event")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    
    let body: [String: Any] = [
        "eventType": eventType,
        "sessionId": sessionId
    ]
    
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    
    URLSession.shared.dataTask(with: request) { data, response, error in
        if let error = error {
            print("Error: \(error)")
            return
        }
        
        if let data = data,
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            print("Response: \(json)")
        }
    }.resume()
}
```

## 📱 動作フロー

1. **セッション開始**
   - ARグラス: 「ボタンを押してください」と表示
   - iPhoneアプリ: 「セッションID: [sessionId] ボタンを押してください」と表示

2. **メディアイベント受信**
   - iOSアプリ側でメディアコントローラーのボタンが押される
   - サーバーの `/api/media/event` にリクエスト送信
   - サーバー側でセッションを取得して、ARグラスに表示

3. **表示**
   - ARグラス: 対応するメッセージを5秒間表示
   - iPhoneアプリ: 対応するメッセージを5秒間表示
   - サーバー側のコンソール: `[メディアイベント] eventType: message` と表示

## 🔧 技術仕様

### サーバー側

- **エンドポイント**: `/api/media/event`
- **認証**: セッションIDを直接受け取る（認証ミドルウェアは適用されているが、セッションIDがあれば動作）
- **表示時間**: 5秒間
- **ログ**: コンソールにイベント情報を出力

### iOSアプリ側

- **メディアコントローラーイベント**: iOSの標準メディアコントローラーAPIを使用
- **バックグラウンド動作**: メディアコントローラーイベントはバックグラウンドでも動作

## 📝 注意事項

- セッションIDは必ず有効なものを使用してください
- セッションが終了している場合は、404エラーが返されます
- イベントタイプは小文字で送信してください（サーバー側で自動的に小文字に変換されます）

## 🔗 関連URL

- **サーバーURL**: `https://mentra-app.sunandgo35.com`
- **Webview URL**: `https://mentra-app.sunandgo35.com/webview/`
- **APIエンドポイント**: `https://mentra-app.sunandgo35.com/api/media/event`
- **MentraOS Developer Console**: `https://console.mentra.glass/`

## 📱 MentraOS Developer Console設定

### Webview URL設定

MentraOS Developer Consoleで、アプリの設定画面で以下を設定：

**Webview URL**: `https://mentra-app.sunandgo35.com/webview/`

**注意**: 
- HTTPSは必須です（自動的に追加されます）
- `/webview/` パスを使用することで、サーバーURLと明確に区別できます
- 現在はファイル選択用のWebviewが表示されますが、メディアコントローラーイベントのテストにはWebviewは必須ではありません
- Webviewは、iPhoneアプリ内で表示されるコンパニオンインターフェースとして使用されます

## 📅 作成日

2024年11月3日


