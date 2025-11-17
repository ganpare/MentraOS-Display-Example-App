# iOS側からサーバーへの直接POST実装ガイド

このドキュメントでは、WebViewを経由せずに、iOS側でサーバーに直接HTTP POSTを送る実装について説明します。

## 📋 実装概要

### 現在のアーキテクチャ（削除対象）

```
Bluetoothイベント
  ↓
MPRemoteCommandCenter (iOS Native)
  ↓
Bridge.swift
  ↓
BridgeModule.m
  ↓
MantleBridge.tsx
  ↓
GlobalEventEmitter.emit("MEDIA_CONTROL_EVENT")
  ↓
webview.tsx (React Native)
  ↓ (injectJavaScript)
WebView内のJavaScript (mediaControlHandler.js)
  ↓ (GUIボタンクリック or サーバーPOST)
サーバー (/api/media/event)
```

### 新しいアーキテクチャ（実装対象）

```
Bluetoothイベント
  ↓
MPRemoteCommandCenter (iOS Native)
  ↓
Bridge.swift
  ↓
BridgeModule.m
  ↓
MantleBridge.tsx (または直接MediaControlManager.swiftから)
  ↓ (直接HTTP POST)
サーバー (/api/media/event)
  ↓
ARグラスに表示 (session.layouts.showTextWall)
```

## 🔧 実装ステップ

### ステップ1: iOS側でサーバーに直接POSTする機能を追加

#### オプションA: MantleBridge.tsxで実装（推奨）

```typescript
// MentraOS-Source/mobile/src/bridge/MantleBridge.tsx

import { Platform } from 'react-native'

// サーバーに直接POSTする関数を追加
async function sendMediaControlToServer(eventType: string, data: {
  timestamp: number
  interval?: number
  seekType?: number
  isDoubleClick?: boolean
}): Promise<void> {
  try {
    // サーバーURLを取得（設定から）
    const serverUrl = await getServerUrl() // 実装が必要
    const authToken = await getAuthToken() // 実装が必要
    const userId = await getUserId() // 実装が必要
    
    if (!serverUrl || !authToken || !userId) {
      console.error('MediaControl: Missing server URL, auth token, or userId')
      return
    }
    
    const response = await fetch(`${serverUrl}/api/media/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}` // 認証が必要な場合
      },
      body: JSON.stringify({
        eventType,
        source: 'bluetooth-ios', // iOS側から直接送信
        timestamp: data.timestamp,
        interval: data.interval,
        seekType: data.seekType,
        isDoubleClick: data.isDoubleClick || false,
        userId // 認証のために必要
      })
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const result = await response.json()
    if (result.success) {
      console.log(`MediaControl: ✅ Event sent to server: ${eventType}`)
    } else {
      console.error(`MediaControl: ❌ Server error:`, result.error)
    }
  } catch (error) {
    console.error(`MediaControl: ❌ Error sending to server:`, error)
  }
}

// MantleBridge.tsx の handleMessage 内で、media_control_event ケースを修正
case "media_control_event": {
  console.log("🎵 [DEBUG] MantleBridge: MEDIA_CONTROL_EVENT received from native layer")
  
  // サーバーに直接POST（WebView経由しない）
  await sendMediaControlToServer(data.eventType, {
    timestamp: data.timestamp,
    interval: data.interval,
    seekType: data.seekType,
    isDoubleClick: data.isDoubleClick
  })
  
  // 既存のGlobalEventEmitter.emitは削除（WebView経由しないため）
  // GlobalEventEmitter.emit("MEDIA_CONTROL_EVENT", {...}) // 削除
  
  break
}
```

#### オプションB: MediaControlManager.swiftで直接実装

```swift
// MentraOS-Source/mobile/ios/Source/services/MediaControlManager.swift

private func sendToServer(eventType: String, data: [String: Any]) {
    guard let serverURL = getServerURL() else {
        Bridge.log("MediaControl: ❌ Server URL not configured")
        return
    }
    
    guard let authToken = getAuthToken() else {
        Bridge.log("MediaControl: ❌ Auth token not available")
        return
    }
    
    guard let userId = getUserId() else {
        Bridge.log("MediaControl: ❌ User ID not available")
        return
    }
    
    var request = URLRequest(url: URL(string: "\(serverURL)/api/media/event")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
    
    let body: [String: Any] = [
        "eventType": eventType,
        "source": "bluetooth-ios",
        "timestamp": Date().timeIntervalSince1970 * 1000,
        "isDoubleClick": data["isDoubleClick"] ?? false,
        "interval": data["interval"] ?? nil,
        "seekType": data["seekType"] ?? nil,
        "userId": userId
    ]
    
    do {
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
    } catch {
        Bridge.log("MediaControl: ❌ Error serializing JSON: \(error.localizedDescription)")
        return
    }
    
    URLSession.shared.dataTask(with: request) { data, response, error in
        if let error = error {
            Bridge.log("MediaControl: ❌ Error sending to server: \(error.localizedDescription)")
        } else if let httpResponse = response as? HTTPURLResponse {
            if httpResponse.statusCode == 200 {
                Bridge.log("MediaControl: ✅ Event sent to server: \(eventType)")
            } else {
                Bridge.log("MediaControl: ❌ Server error: HTTP \(httpResponse.statusCode)")
            }
        }
    }.resume()
}

// handleRemoteCommand内で、sendMediaControlEventの代わりにsendToServerを呼ぶ
private func handleRemoteCommand(
    eventType: String,
    interval: TimeInterval? = nil,
    seekType: Int? = nil
) -> MPRemoteCommandHandlerStatus {
    
    var eventData: [String: Any] = [
        "eventType": eventType,
        "timestamp": Date().timeIntervalSince1970 * 1000,
    ]
    
    if let interval = interval {
        eventData["interval"] = interval
    } else if let seekType = seekType {
        eventData["seekType"] = seekType
    }
    
    // サーバーに直接POST（Bridge.sendMediaControlEventは削除）
    sendToServer(eventType: eventType, data: eventData)
    
    return .success
}
```

### ステップ2: webview.tsxからWebView経由のコードを削除

```typescript
// MentraOS-Source/mobile/src/app/applet/webview.tsx

// ❌ 削除: injectJavaScript部分（234-337行目）
// ❌ 削除: socketComms.sendMediaControlEvent部分（348行目付近）

// ✅ 修正後: MEDIA_CONTROL_EVENTのリスナーを削除
useEffect(() => {
  // ❌ 削除: WebView経由の処理
  // const onMediaControl = (event: {...}) => {
  //   // injectJavaScript部分を削除
  //   // socketComms.sendMediaControlEvent部分を削除
  // }
  // GlobalEventEmitter.on("MEDIA_CONTROL_EVENT", onMediaControl)
  
  // ✅ 新しい実装: iOS側で直接サーバーにPOSTするため、ここでの処理は不要
  
  return () => {
    // ❌ 削除: GlobalEventEmitter.off("MEDIA_CONTROL_EVENT", onMediaControl)
  }
}, [packageName, finalUrl])
```

### ステップ3: WebView内のJavaScriptを削除または無効化

```javascript
// AugmentOS-Cloud-Example-App/public/webview/js/mediaControlHandler.js

// ❌ 削除: 全体を削除するか、無効化する
// (function() {
//   // すべてのコードを削除
// })();

// または、ファイル自体を削除
```

```html
<!-- AugmentOS-Cloud-Example-App/public/webview/index.html -->

<!-- ❌ 削除: mediaControlHandler.jsの読み込み -->
<!-- <script src="js/mediaControlHandler.js"></script> -->
```

### ステップ4: btController.jsのイベントリスナーを削除

```javascript
// AugmentOS-Cloud-Example-App/public/webview/js/btController/btController.js

// ❌ 削除: コメントアウトされたイベントリスナー部分を完全に削除
// 既にコメントアウトされているので、完全に削除する

// window.addEventListener('mentraMediaControl', ...) // 削除
// window.addEventListener('mentraMediaControlDoubleClick', ...) // 削除
```

### ステップ5: サーバー側で`source: 'bluetooth-ios'`の場合の処理を確認

```typescript
// AugmentOS-Cloud-Example-App/src/api/media.api.ts

app.post('/api/media/event', async (req, res) => {
  const { eventType, source, userId, ... } = req.body
  
  // ✅ 既に実装済み: source === 'bluetooth-ios' の場合の処理
  // Bluetoothイベントの場合、サーバー側で処理してARグラスに表示
  
  if (source === 'bluetooth-ios') {
    const session = getSessionForUser(userId)
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    
    // ユーザー設定を読み込み
    const userSettings = getUserSettings(userId)
    
    // アクションを実行（メッセージ表示なし）
    await handleMediaEvent(session, eventType, {
      source: 'bluetooth-ios',
      userId,
      suppressMessage: true // メッセージ表示を抑制
    })
    
    return res.json({ success: true, handledByServer: true })
  }
  
  // その他の処理（WebView経由など）
  // ...
})
```

## 🔍 必要な追加実装

### 1. サーバーURLの取得

```typescript
// MentraOS-Source/mobile/src/bridge/MantleBridge.tsx

async function getServerUrl(): Promise<string | null> {
  // 設定からサーバーURLを取得
  // 例: useSettingsStore.getState().getSetting('server_url')
  // または: socketComms.getServerUrl()
  return socketComms.getServerUrl() // 実装が必要
}
```

### 2. 認証トークンの取得

```typescript
// MentraOS-Source/mobile/src/bridge/MantleBridge.tsx

async function getAuthToken(): Promise<string | null> {
  // 認証トークンを取得
  // 例: AsyncStorageから取得、またはsocketCommsから取得
  // 実装が必要
}
```

### 3. ユーザーIDの取得

```typescript
// MentraOS-Source/mobile/src/bridge/MantleBridge.tsx

async function getUserId(): Promise<string | null> {
  // ユーザーIDを取得
  // 例: useSettingsStoreから取得
  // 実装が必要
}
```

## 📝 まとめ

1. **iOS側でサーバーに直接POST**（MantleBridge.tsxまたはMediaControlManager.swift）
2. **WebView経由のコードを削除**（webview.tsx、mediaControlHandler.js）
3. **サーバー側で処理**（既に実装済み、`source: 'bluetooth-ios'`の場合）

この実装により、バックグラウンドでも確実に動作し、WebViewに依存しないアーキテクチャが完成します。

