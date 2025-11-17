# Bluetoothコントローラー統合アーキテクチャ

このドキュメントでは、Bluetoothメディアコントローラーとアプリケーションの統合アーキテクチャ、および設定画面での管理方法について説明します。

## 📋 目次

- [概要](#概要)
- [アーキテクチャ](#アーキテクチャ)
- [処理フロー](#処理フロー)
- [設定画面での管理](#設定画面での管理)
- [機能追加方法](#機能追加方法)
- [重要なポイント](#重要なポイント)

---

## 概要

Bluetoothメディアコントローラー（`togglePlayPauseCommand`, `nextTrackCommand`, `previousTrackCommand`）からのボタン入力を、設定画面で紐付けられたGUIボタンのアクションにマッピングする仕組みです。

### 基本方針

- **すべて設定画面で紐付けられたもののみ動作**
- **サーバーへの直接POSTはしない**
- **すべてGUIボタンのクリックイベント経由で処理**

---

## アーキテクチャ

### コンポーネント構成

```
┌─────────────────────────────────────────────────────────┐
│ iOS Native (MentraOS)                                    │
│ ・Bluetoothメディアコントローラーイベント受信             │
│ ・WebViewへのJavaScriptイベント発火                      │
└──────────────────┬──────────────────────────────────────┘
                   │ CustomEvent ('mentraMediaControl')
                   ▼
┌─────────────────────────────────────────────────────────┐
│ WebView JavaScript                                       │
│                                                           │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ mediaControlHandler.js                               │ │
│ │ ・Bluetoothイベント受信                              │ │
│ │ ・ユーザー設定を読み込み                             │ │
│ │ ・対応するGUIボタンをクリック                        │ │
│ └──────────────────┬──────────────────────────────────┘ │
│                    │ button.click()                      │
│                    ▼                                     │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 各画面のJavaScript (textReader.js, audioPlayer.js)   │ │
│ │ ・ボタンクリックイベントハンドラー                    │ │
│ │ ・サーバーへのAPIリクエスト                           │ │
│ └──────────────────┬──────────────────────────────────┘ │
└────────────────────┼────────────────────────────────────┘
                     │ POST /api/media/event
                     ▼
┌─────────────────────────────────────────────────────────┐
│ App Server                                              │
│ ・メディアイベント処理                                   │
│ ・テキストページング / 音声プレーヤー制御                │
└─────────────────────────────────────────────────────────┘
```

### ファイル構成

| ファイル | 役割 |
|---------|------|
| `public/webview/js/mediaControlHandler.js` | Bluetoothイベントを受信し、設定に基づいてGUIボタンをクリック |
| `public/webview/js/textReader/textReader.js` | テキストリーダーのGUIボタンクリックイベントハンドラー |
| `public/webview/js/audioPlayer/audioPlayer.js` | 音声プレーヤーのGUIボタンクリックイベントハンドラー |
| `public/webview/js/settings/settings.js` | 設定画面UI（アクションとトリガーの紐付け） |
| `src/api/settings.api.ts` | 設定API（設定の保存・読み込み） |
| `src/api/media.api.ts` | メディアイベントAPI（ページング、音声制御） |
| `src/services/settings/UserSettings.ts` | ユーザー設定管理（JSONファイル） |

---

## 処理フロー

### 1. Bluetoothボタンが押される

```
iOS Native
  ↓
MPRemoteCommandCenter
  ↓
WebViewへのJavaScriptイベント発火
  ↓
CustomEvent ('mentraMediaControl' or 'mentraMediaControlDoubleClick')
```

### 2. WebView側でイベントを受信

```javascript
// mediaControlHandler.js
window.addEventListener('mentraMediaControl', (event) => {
    handleMediaControlEvent(event);
});
```

### 3. 設定を読み込み、対応するアクションを検索

```javascript
// ユーザー設定を読み込み
const userSettings = await loadSettings();

// 現在のページとBluetoothトリガーから対応するアクションを検索
const actionId = findActionForTrigger(eventType, isDoubleClick, currentPage);
```

**検索条件:**
- 現在のページ（`textReader` または `audioPlayer`）
- Bluetoothボタンタイプ（`playpause`, `nexttrack`, `prevtrack`）
- クリックタイプ（`single` または `double`）

### 4. GUIボタンをクリック（対応するアクションが見つかった場合のみ）

```javascript
if (actionId) {
    // 対応するGUIボタンをクリック
    clickGUButton(actionId);
    // 例: text_nextBtn → nextBtn要素をクリック
} else {
    // 対応するアクションが見つからない場合、何もしない
    console.log('対応するアクションが見つかりません。無視します');
}
```

### 5. GUIボタンのクリックイベントでサーバーにPOST

```javascript
// textReader.js または audioPlayer.js
nextBtn.addEventListener('click', async () => {
    await navigatePage('nextpage', statusEl, updatePageInfo);
});

// utils.js
async function navigatePage(eventType, statusEl, updatePageInfoCallback) {
    const data = await apiCall('/api/media/event', {
        method: 'POST',
        body: JSON.stringify({ eventType })
    });
    // ...
}
```

### 6. サーバー側で処理

```typescript
// media.api.ts
app.post('/api/media/event', async (req, res) => {
    // ページング処理または音声プレーヤー制御
    await handleMediaEvent(session, eventType, ...);
});
```

---

## 設定画面での管理

### アクション（GUIボタン）

| アクションID | 表示名 | 画面 |
|-------------|--------|------|
| `text_prevBtn` | 📄 前のページ（テキストリーダー） | テキストリーダー |
| `text_nextBtn` | 📄 次のページ（テキストリーダー） | テキストリーダー |
| `audio_playBtn` | ▶️ 再生（音声プレーヤー） | 音声プレーヤー |
| `audio_pauseBtn` | ⏸️ 一時停止（音声プレーヤー） | 音声プレーヤー |
| `audio_skipForwardBtn` | ⏩ 早送り +10秒（音声プレーヤー） | 音声プレーヤー |
| `audio_skipBackwardBtn` | ⏪ 巻き戻し -10秒（音声プレーヤー） | 音声プレーヤー |
| `audio_nextSubtitleBtn` | ⏭️ 次字幕（音声プレーヤー） | 音声プレーヤー |
| `audio_prevSubtitleBtn` | ⏮️ 前字幕（音声プレーヤー） | 音声プレーヤー |
| `audio_repeatSubtitleBtn` | 🔁 リピート（音声プレーヤー） | 音声プレーヤー |
| `audio_speedBtn` | ⚡ 速度変更（音声プレーヤー） | 音声プレーヤー |

### トリガー（Bluetoothボタン）

| トリガーID | 表示名 | 対応ボタン |
|-----------|--------|-----------|
| `playpause` | ⏯️ 再生/一時停止 | togglePlayPauseCommand |
| `nexttrack` | ⏭️ 次の曲 | nextTrackCommand |
| `prevtrack` | ⏮️ 前の曲 | previousTrackCommand |
| `none` | なし | - |

### 設定方法

1. WebViewの「⚙️ ボタン設定」画面にアクセス
2. 各アクション（GUIボタン）に対して、シングルクリック/ダブルクリックでどのトリガー（Bluetoothボタン）を割り当てるかを選択
3. 「保存」ボタンをクリック

### 設定データ構造

```typescript
interface UserMediaSettings {
    userId: string;
    actionMappings?: {
        'text_prevBtn'?: {
            single?: { trigger: 'playpause' | 'nexttrack' | 'prevtrack' | 'none' };
            double?: { trigger: 'playpause' | 'nexttrack' | 'prevtrack' | 'none' };
        };
        'text_nextBtn'?: { /* ... */ };
        'audio_playBtn'?: { /* ... */ };
        // ...
    };
    updatedAt: number;
}
```

---

## 機能追加方法

新しいGUIボタンやBluetoothボタンを追加する場合の手順です。

### 新しいGUIボタンを追加する場合

#### 1. HTMLにボタンを追加

```html
<!-- public/webview/index.html -->
<button id="newActionBtn">新しいアクション</button>
```

#### 2. JavaScriptにクリックイベントハンドラーを追加

```javascript
// public/webview/js/textReader/textReader.js (例)
const newActionBtn = document.getElementById('newActionBtn');
newActionBtn.addEventListener('click', async () => {
    // 処理を実装
    await apiCall('/api/media/event', {
        method: 'POST',
        body: JSON.stringify({ eventType: 'newaction' })
    });
});
```

#### 3. mediaControlHandler.jsにマッピングを追加

```javascript
// public/webview/js/mediaControlHandler.js
const actionIdToButtonId = {
    // ... 既存のマッピング ...
    'text_newActionBtn': 'newActionBtn'  // 追加
};
```

#### 4. 設定APIにアクションを追加

```typescript
// src/api/settings.api.ts
app.get('/api/settings/actions', (req, res) => {
    const actions = {
        // ... 既存のアクション ...
        'text_newActionBtn': {
            name: '🆕 新しいアクション',
            description: '新しいアクションの説明',
            category: 'text'
        }
    };
    res.json({ success: true, actions });
});
```

#### 5. media.api.tsでアクションを処理（必要に応じて）

```typescript
// src/api/media.api.ts
async function executeAction(actionType: string, ...) {
    switch (actionType) {
        case 'text_newaction': {
            // 新しいアクションの処理を実装
            break;
        }
        // ...
    }
}
```

#### 6. 設定画面UI（自動反映）

設定APIでアクションを追加すれば、設定画面UIに自動的に表示されます。

### 新しいBluetoothボタンを追加する場合

#### 1. iOS側でイベントを追加（MentraOS側）

```swift
// iOS側のコード（MentraOS-Source）
commandCenter.newButtonCommand.addTarget { ... }
```

#### 2. WebViewへのイベント発火を追加

```swift
// iOS側でCustomEventを発火
webView.evaluateJavaScript("""
    window.dispatchEvent(new CustomEvent('mentraMediaControl', {
        detail: { eventType: 'newbutton' }
    }));
""")
```

#### 3. 設定APIにトリガーを追加

```typescript
// src/api/settings.api.ts
app.get('/api/settings/triggers', (req, res) => {
    const triggers = {
        // ... 既存のトリガー ...
        'newbutton': {
            name: '🆕 新しいボタン',
            description: '新しいBluetoothボタン'
        }
    };
    res.json({ success: true, triggers });
});
```

#### 4. mediaControlHandler.jsでトリガーを検索可能にする

```javascript
// mediaControlHandler.jsでは特に変更不要
// findActionForTrigger関数が設定データを参照するため、
// 設定APIでトリガーを追加すれば自動的に検索可能になります
```

---

## 重要なポイント

### ✅ 原則

1. **すべて設定画面で紐付けられたもののみ動作**
   - 設定されていないアクションは無視されます
   - サーバーへの直接POSTはしません

2. **サーバーへの直接POSTはしない**
   - Bluetoothイベントから直接サーバーにPOSTすることはありません
   - すべてGUIボタンのクリックイベント経由で処理されます

3. **設定画面での管理のみ**
   - すべての機能追加は設定画面でのメンテナンスで対応可能です
   - コードの変更は最小限で済みます

### 🔍 処理の流れ

```
Bluetoothボタン押下
  ↓
mediaControlHandler.js で設定を検索
  ↓
対応するGUIボタンをクリック
  ↓
GUIボタンのクリックイベントでサーバーにPOST
  ↓
サーバー側で処理実行
```

### ⚠️ 注意事項

1. **設定されていないアクションは無視される**
   - 設定画面で紐付けられていないBluetoothボタンは何も起こりません
   - ログには記録されますが、処理は実行されません

2. **画面ごとのフィルタリング**
   - テキストリーダー画面では `text_*` のアクションのみ有効
   - 音声プレーヤー画面では `audio_*` のアクションのみ有効

3. **シングルクリック / ダブルクリックの区別**
   - 同じBluetoothボタンでも、シングルクリックとダブルクリックで異なるアクションを割り当て可能
   - 例: `nexttrack` シングル → 次のページ、`nexttrack` ダブル → 10ページ飛ぶ

### 📝 データフロー

```
設定データ（JSONファイル）
  ↓
設定API（/api/settings/media）
  ↓
WebView JavaScript（settings.js）
  ↓
mediaControlHandler.js（設定を読み込み）
  ↓
GUIボタンクリック
  ↓
各画面のJavaScript（処理実行）
  ↓
サーバーAPI（/api/media/event）
  ↓
サーバー側処理（ページング、音声制御など）
```

---

## まとめ

- **すべて設定画面で紐付けられたもののみ動作**
- **サーバーへの直接POSTはしない**
- **機能追加は設定画面でのメンテナンスで対応可能**

このアーキテクチャにより、コードの変更を最小限に抑えながら、柔軟に機能を追加・変更できます。

