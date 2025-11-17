# バックグラウンドメディアコントロールアーキテクチャ

このドキュメントでは、バックグラウンドで動作するメディアコントロールの実装方針について説明します。

## 📋 現在の問題

1. **「次の曲ボタンが押されました」などのメッセージが表示される**
   - ユーザーは不要なメッセージ表示を望んでいない

2. **WebViewに依存している**
   - 画面が消えているとWebViewが動作しない可能性がある
   - バックグラウンドでの動作が保証されない

## 🎯 最終的な目標

- **バックグラウンドでメディアコントロールを受け取る**
  - 画面が消えていても動作する
  - WebViewに依存しない

- **サーバーからデバイスへの表示内容を受け取る**
  - サーバー側で処理した結果をARグラスに直接表示

## 🔄 推奨アーキテクチャ

### アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────┐
│ iOS Native (MentraOS)                                    │
│ ・MPRemoteCommandCenter（バックグラウンドでも動作）       │
│ ・Bluetoothメディアコントローラーイベント受信             │
│ ・サーバーに直接HTTP POST                                │
└──────────────────┬──────────────────────────────────────┘
                   │ HTTP POST /api/media/event
                   │ { eventType, source: 'bluetooth-ios', ... }
                   ▼
┌─────────────────────────────────────────────────────────┐
│ App Server                                              │
│ ・Bluetoothイベントを受信                                │
│ ・ユーザー設定を読み込み                                 │
│ ・アクションを実行（ページング、音声制御など）            │
│ ・ARグラスに表示（session.layouts.showTextWall）         │
└──────────────────┬──────────────────────────────────────┘
                   │ WebSocket/Display Event
                   ▼
┌─────────────────────────────────────────────────────────┐
│ ARグラス（デバイス）                                      │
│ ・サーバーからの表示内容を受信                           │
│ ・画面に表示                                             │
└─────────────────────────────────────────────────────────┘
```

### 重要なポイント

1. **iOS側でサーバーに直接POST**
   - WebViewを経由しない
   - `injectJavaScript`を使わない
   - バックグラウンドでも動作する

2. **サーバー側で処理してARグラスに表示**
   - サーバー側で`session.layouts.showTextWall()`を使用
   - WebViewに依存しない
   - バックグラウンドでも動作する

3. **メッセージ表示を完全に抑制**
   - Bluetoothイベントの場合、メッセージを表示しない
   - 処理結果のみARグラスに表示

## 📝 実装方法

### 1. iOS側の実装

#### 方法A: React Native層で直接HTTP POST（推奨）

```typescript
// MantleBridge.tsx または MediaControlManager.tsx

import { fetch } from 'react-native-fetch-api'; // または適切なHTTPクライアント

// MPRemoteCommandCenterのイベントハンドラー内で
async function handleRemoteCommand(eventType: string, data: any) {
    try {
        // サーバーに直接POST
        const response = await fetch(`${SERVER_URL}/api/media/event`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}` // 認証が必要な場合
            },
            body: JSON.stringify({
                eventType: eventType,
                source: 'bluetooth-ios', // iOS側から直接送信
                isDoubleClick: data.isDoubleClick || false,
                interval: data.interval,
                seekType: data.seekType,
                timestamp: Date.now()
            })
        });
        
        const result = await response.json();
        if (result.success) {
            // 成功（サーバー側で処理される）
            Bridge.log(`MediaControl: ✅ Event sent to server: ${eventType}`);
        }
    } catch (error) {
        Bridge.log(`MediaControl: ❌ Error sending to server: ${error}`);
    }
    
    return .success;
}
```

#### 方法B: WebView経由（現在の方法 - バックグラウンドでは動作しない）

```typescript
// webview.tsx
webViewRef.current.injectJavaScript(`
  window.dispatchEvent(new CustomEvent('mentraMediaControl', {
    detail: { eventType: 'playpause', ... }
  }));
`);
```

**問題点**:
- WebViewがバックグラウンドで動作しない可能性がある
- 画面が消えていると動作しない

### 2. サーバー側の実装

#### Bluetoothイベントを受信して処理

```typescript
// src/api/media.api.ts

app.post('/api/media/event', async (req, res) => {
    const { eventType, source, userId, ... } = req.body;
    
    // Bluetoothイベントの場合
    if (source === 'bluetooth-ios') {
        // ユーザー設定を読み込み
        const userSettings = getUserSettings(userId);
        
        // アクションを実行
        if (userSettings && userSettings.actionMappings) {
            // 設定に基づいてアクションを実行
            await executeAction(actionType, session, ...);
            
            // ARグラスに表示（メッセージ表示はスキップ）
            session.layouts.showTextWall(displayText, {
                view: ViewType.MAIN
            });
        }
        
        return res.json({ success: true, handledByServer: true });
    }
    
    // その他の処理...
});
```

#### メッセージ表示を完全に抑制

```typescript
// Bluetoothイベントの場合、メッセージを表示しない
if (source === 'bluetooth-ios') {
    // メッセージ表示をスキップ
    // 処理結果のみARグラスに表示
    return;
}
```

### 3. WebViewとの統合（オプション）

- **WebViewがアクティブな場合**: 既存の方法（`mediaControlHandler.js`）を使用
- **バックグラウンドの場合**: iOS側で直接サーバーにPOST

## 🔍 実装の選択肢

### 選択肢1: iOS側で直接サーバーにPOST（推奨）

**メリット**:
- ✅ バックグラウンドで動作する
- ✅ WebViewに依存しない
- ✅ シンプルな実装

**デメリット**:
- ❌ iOS側の実装が必要
- ❌ 認証トークンの管理が必要

**実装場所**:
- `MentraOS-Source/mobile/ios/Source/services/MediaControlManager.swift`
- または `MentraOS-Source/mobile/src/bridge/MantleBridge.tsx`

### 選択肢2: サーバー側で処理を強化

**メリット**:
- ✅ WebViewの変更が不要
- ✅ サーバー側のみで完結

**デメリット**:
- ❌ WebViewがバックグラウンドで動作しない場合、動作しない
- ❌ 現在の問題（2回POST）が解決しない可能性がある

### 選択肢3: ハイブリッドアプローチ

- **WebViewがアクティブな場合**: 既存の方法を使用
- **バックグラウンドの場合**: iOS側で直接サーバーにPOST

## 🎯 推奨実装

**選択肢1（iOS側で直接サーバーにPOST）を推奨します。**

### 理由

1. **バックグラウンドで確実に動作**
   - MPRemoteCommandCenterはバックグラウンドでも動作する
   - HTTP POSTもバックグラウンドで実行可能

2. **WebViewに依存しない**
   - 画面が消えていても動作する
   - アプリがバックグラウンドでも動作する

3. **シンプルな実装**
   - WebViewのJavaScriptとの統合が不要
   - サーバー側の処理のみで完結

### 実装ステップ

1. **iOS側でサーバーに直接POSTする機能を追加**
   - `MediaControlManager.swift`または`MantleBridge.tsx`で実装
   - 認証トークンの管理

2. **サーバー側でBluetoothイベントを処理**
   - `source: 'bluetooth-ios'`の場合の処理を追加
   - メッセージ表示を抑制

3. **WebViewとの統合（オプション）**
   - WebViewがアクティブな場合は既存の方法を使用
   - バックグラウンドの場合はiOS側で直接POST

## 📚 参考実装

### iOS側でのHTTP POST

```swift
// MediaControlManager.swift

private func sendToServer(eventType: String, data: [String: Any]) {
    guard let serverURL = getServerURL() else { return }
    guard let authToken = getAuthToken() else { return }
    
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
        "seekType": data["seekType"] ?? nil
    ]
    
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    
    URLSession.shared.dataTask(with: request) { data, response, error in
        if let error = error {
            Bridge.log("MediaControl: ❌ Error sending to server: \(error.localizedDescription)")
        } else if let data = data {
            Bridge.log("MediaControl: ✅ Event sent to server: \(eventType)")
        }
    }.resume()
}
```

### サーバー側での処理

```typescript
// src/api/media.api.ts

app.post('/api/media/event', async (req, res) => {
    const { eventType, source, userId, ... } = req.body;
    
    // Bluetoothイベント（iOS側から直接送信）の場合
    if (source === 'bluetooth-ios') {
        const session = getSessionForUser(userId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        
        // ユーザー設定を読み込み
        const userSettings = getUserSettings(userId);
        
        // アクションを実行（メッセージ表示なし）
        await handleMediaEvent(session, eventType, {
            source: 'bluetooth-ios',
            userId,
            suppressMessage: true // メッセージ表示を抑制
        });
        
        return res.json({ success: true, handledByServer: true });
    }
    
    // その他の処理...
});
```

---

## 📝 まとめ

**バックグラウンドで動作させるには**:

1. **iOS側でサーバーに直接POST**（推奨）
   - WebViewに依存しない
   - バックグラウンドでも動作する

2. **サーバー側で処理してARグラスに表示**
   - `session.layouts.showTextWall()`を使用
   - メッセージ表示を抑制

3. **認証トークンの管理**
   - iOS側でサーバーにPOSTする際に認証が必要

この方法により、バックグラウンドでも確実に動作し、WebViewに依存しない実装が可能になります。

