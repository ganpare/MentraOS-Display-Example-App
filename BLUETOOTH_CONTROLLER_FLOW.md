# Bluetoothコントローラー画面の動作フロー

## 1. 画面への遷移と状態通知

### ユーザーがBluetoothコントローラー画面に入る

```
[ユーザー操作]
メインメニューで「Bluetoothコントローラー」ボタンをクリック
```

```
[WebView側: main.js]
showPage('btController') が呼ばれる
  ↓
1. DOMの表示を切り替え（btControllerPageをactiveに）
2. window.currentActivePage = 'btController' に更新
3. 'pageChanged' イベントを発火
4. notifyPageChange('btController') を呼び出し
   ↓
   POST /api/media/page
   Body: { currentPage: 'btController' }
```

```
[サーバー側: media.api.ts]
POST /api/media/page を受信
  ↓
1. 認証ミドルウェアでuserIdを取得
2. userIdからsessionIdを取得
3. sessionCurrentPages.set(sessionId, 'btController') で保存
4. これで、サーバー側が「現在このユーザーはbtController画面にいる」と認識
```

**重要なポイント:**
- テキストリーダーや音声プレーヤーと**全く同じ仕組み**
- 画面に入った瞬間にサーバー側に状態を通知
- サーバー側は`sessionCurrentPages`マップで管理

---

## 2. Bluetoothコントローラー画面の初期化

```
[WebView側: btController.js]
initBtController() が呼ばれる
  ↓
1. テストボタンのイベントリスナーを設定
2. ログクリアボタンのイベントリスナーを設定
3. 'mentraDisplayEvent' イベントリスナーを追加
   （サーバー側から送られてくるdisplay_eventを受け取る）
4. 接続状態を「接続待機中...」に設定
5. 定期的な接続状態確認を開始（3秒ごと）
```

**重要なポイント:**
- 画面に入ったら自動的に`initBtController()`が呼ばれる
- `main.js`の`showPage()` → `pageChanged`イベント → `initBtController()`

---

## 3. Bluetoothボタンを押したときの流れ

### iOS側（MantleBridge.tsx）

```
[Bluetoothコントローラーがボタンを押す]
  ↓
[iOS側: MediaControlManager]
MPRemoteCommandCenterからイベントを受信
  ↓
[iOS側: MantleBridge.tsx]
sendMediaControlEventToAppServer() が呼ばれる
  ↓
POST ${appServerUrl}/api/media/event?aos_temp_token=${token}
Body: {
  eventType: 'nexttrack', // 例：次の曲ボタン
  timestamp: 1234567890,
  source: 'bluetooth-ios',
  isDoubleClick: false
}
```

### サーバー側（media.api.ts）

```
[サーバー側: media.api.ts]
POST /api/media/event を受信
  ↓
1. 認証ミドルウェアでuserIdを取得
2. userIdからsessionIdを取得
3. sessionCurrentPagesから現在のページを取得
   → 'btController' が取得される
4. handleMediaEvent() を呼び出し
  ↓
5. ユーザー設定を読み込み（UserSettings.ts）
6. Bluetoothイベント → アクションマッピングを確認
   （例：nexttrack + シングルクリック → text_nextpage）
7. executeAction() を呼び出し
  ↓
8. アクションを実行（例：text_nextpage）
   → displayCurrentPage() を呼び出し
   → session.layouts.showTextWall() を実行
  ↓
9. WebSocket経由でdisplay_eventがiPhone側に送信される
10. mediaEventHistoryにイベントを記録
11. sessionLastMediaEventsに最新イベントを保存
```

### iPhone側（webview.tsx + btController.js）

```
[iPhone側: SocketComms.ts]
WebSocket経由でdisplay_eventを受信
  ↓
handle_display_event(msg) が呼ばれる
  ↓
useDisplayStore.setDisplayEvent(eventString) を呼び出し
  ↓
useDisplayStore.currentEvent が更新される
  ↓
[iPhone側: webview.tsx]
useEffect(() => {
  // currentEventが更新されたら
  1. /api/media/events/history を呼び出して最新のメディアイベントを取得
  2. display_event + mediaEventMetadata を WebView内に通知
  3. injectJavaScript() で mentraDisplayEvent を発火
}, [currentEvent])
  ↓
[WebView内: btController.js]
handleDisplayEvent(event) が呼ばれる
  ↓
1. displayEvent.mediaEventMetadata を確認
2. Bluetoothイベント（source === 'bluetooth-ios'）の場合
   → addEventLog() でイベントログに追加
3. updateConnectionStatus(true) で接続状態を「接続中」に更新
4. lastEventTime を更新
```

---

## 4. 接続状態の管理

### 接続状態の更新タイミング

1. **Bluetoothボタンを押したとき**
   - `handleDisplayEvent()` が呼ばれる
   - `updateConnectionStatus(true)` が実行される
   - `lastEventTime` が更新される

2. **定期的な確認（3秒ごと）**
   - `/api/media/events/history` を呼び出し
   - 最新のイベントが30秒以内なら「接続中」
   - 30秒以上経過していたら「接続待機中...」

3. **タイムアウト（10秒）**
   - 最後のイベントから10秒以上経過していたら「接続待機中...」に戻す

---

## 5. まとめ：状態通知の流れ

### すべての画面で共通

```
[画面に入る]
  ↓
main.js: showPage(pageName)
  ↓
notifyPageChange(pageName)
  ↓
POST /api/media/page
Body: { currentPage: pageName }
  ↓
サーバー側: sessionCurrentPages.set(sessionId, pageName)
  ↓
サーバー側が「現在このユーザーはどの画面にいるか」を認識
```

### 現在の実装状況

✅ **テキストリーダー画面** (`textReader`)
- 画面に入ったら `/api/media/page` に通知
- ✅ 実装済み

✅ **音声プレーヤー画面** (`audioPlayer`)
- 画面に入ったら `/api/media/page` に通知
- ✅ 実装済み

✅ **Bluetoothコントローラー画面** (`btController`)
- 画面に入ったら `/api/media/page` に通知
- ✅ 実装済み

✅ **設定画面** (`settings`)
- 画面に入ったら `/api/media/page` に通知
- ✅ 実装済み

---

## 6. 確認ポイント

### サーバー側での状態確認

```typescript
// index.ts
private sessionCurrentPages: Map<string, string> = new Map();

// どこからでも確認可能
const currentPage = this.sessionCurrentPages.get(sessionId);
// → 'btController', 'textReader', 'audioPlayer', 'settings', 'top' など
```

### イベント処理時の流れ

```typescript
// media.api.ts: handleMediaEvent()
const currentPage = options.currentPage || 'top';
// または
const currentPage = deps.sessionCurrentPages?.get(sessionId) || 'top';

// 現在のページに応じてアクションを決定
// ユーザー設定: { page: 'btController', trigger: { ... }, action: { ... } }
// → Bluetoothイベントが来たときに、現在のページで対応するアクションを探す
```

---

## 現在の問題点と対処

### 問題: 「接続待機中...」のまま

**考えられる原因:**
1. `display_event`が届いていない
2. `handleDisplayEvent()`が呼ばれていない
3. `/api/media/events/history`の取得に失敗している

**デバッグログで確認すべき点:**
- `[webview.tsx] display_event received:` - display_eventが届いているか
- `[btController] handleDisplayEvent called:` - handleDisplayEventが呼ばれているか
- `[btController] Connection check:` - 接続状態確認の結果

---

## 動作確認のチェックリスト

1. ✅ 画面に入ったらサーバーに状態を通知する
   - `main.js`の`showPage()` → `notifyPageChange()`
   - ✅ 実装済み（すべての画面で共通）

2. ✅ サーバー側で状態を保存する
   - `sessionCurrentPages.set(sessionId, pageName)`
   - ✅ 実装済み

3. ✅ Bluetoothボタンを押したときにイベントを処理する
   - iOS側: `MantleBridge.sendMediaControlEventToAppServer()`
   - サーバー側: `handleMediaEvent()`
   - ✅ 実装済み

4. ✅ display_eventをWebViewに通知する
   - `webview.tsx`の`useEffect()` → `injectJavaScript()`
   - ✅ 実装済み

5. ✅ イベントログに表示する
   - `btController.js`の`handleDisplayEvent()`
   - ✅ 実装済み（ただし、`mediaEventMetadata`が必要）

6. ✅ 接続状態を更新する
   - `updateConnectionStatus(true)`
   - ✅ 実装済み（定期的な確認も追加済み）
