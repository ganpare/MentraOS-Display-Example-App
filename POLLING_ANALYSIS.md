# ポーリングの現状分析

## 現在のポーリング実装

### 1. Bluetoothコントローラー画面の接続状態確認（3秒ごと）

**場所**: `public/webview/js/btController/btController.js`

```javascript
// 3秒ごとに接続状態を確認
const connectionCheckInterval = setInterval(async () => {
    if (window.currentActivePage !== 'btController') return;
    
    const historyResponse = await apiCall('/api/media/events/history');
    // 最新のイベントが30秒以内なら接続中とみなす
    // ...
}, 3000); // 3秒ごとにチェック
```

**目的**: 接続状態を表示するため（「接続中」/「接続待機中...」）

**頻度**: 3秒ごと

**問題点**: 
- 3秒ごとにリクエストが送信される
- 画面にいる間、ずっと実行され続ける

---

### 2. display_event受信時のメタデータ取得

**場所**: `MentraOS-Source/mobile/src/app/applet/webview.tsx`

```typescript
useEffect(() => {
  // display_eventが来るたびに実行
  const fetchLatestMediaEvent = async () => {
    const historyResponse = await fetch(`${baseUrl}/api/media/events/history`);
    // ...
  }
  fetchLatestMediaEvent()
}, [currentEvent, finalUrl])
```

**目的**: `display_event`と同時に最新のメディアイベント情報を取得して、Bluetoothコントローラー画面のイベントログに表示する

**頻度**: `display_event`が来るたび（イベント駆動）

**問題点**:
- `display_event`が頻繁に来る場合、リクエストが連続して送信される
- 同じイベントに対して複数回実行される可能性がある

---

## リクエストの重複

### シナリオ1: Bluetoothコントローラー画面にいる場合

```
[3秒ごと] btController.js → GET /api/media/events/history
[display_eventが来るたび] webview.tsx → GET /api/media/events/history
```

**結果**: リクエストが重複して送信される

### シナリオ2: display_eventが頻繁に来る場合

```
[display_event 1] → GET /api/media/events/history
[display_event 2] → GET /api/media/events/history
[display_event 3] → GET /api/media/events/history
...
```

**結果**: 短時間に複数のリクエストが送信される

---

## 最適化案

### オプション1: ポーリング頻度を下げる

```javascript
// 3秒 → 10秒に変更
}, 10000); // 10秒ごとにチェック
```

### オプション2: 接続状態確認を削除（display_eventに依存）

`display_event`が来れば接続中とみなす。ポーリングは不要。

### オプション3: リクエストの重複を防ぐ

`webview.tsx`で、最後のリクエストから一定時間（例：1秒）経過していない場合はスキップ。

### オプション4: 接続状態確認をdisplay_eventベースに変更

`display_event`が来たときに接続状態を更新。ポーリングは削除。

---

## 推奨: オプション4（display_eventベース）

`display_event`が来れば接続中とみなし、一定時間（例：10秒）経過したら「接続待機中...」に戻す。

メリット:
- ポーリングが不要
- リクエスト数が減る
- リアルタイム性が保たれる

デメリット:
- `display_event`が来ない場合、接続状態が更新されない（ただし、これは問題ない可能性が高い）
