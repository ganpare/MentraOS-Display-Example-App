// Bluetoothコントローラーテスト機能モジュール
(function() {
    'use strict';
    
    // DOM要素
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const eventLogContent = document.getElementById('eventLogContent');
    const clearLogBtn = document.getElementById('clearLogBtn');
    const btControllerStatus = document.getElementById('btControllerStatus');
    const testButtons = document.querySelectorAll('.test-btn');
    
    // 状態管理
    let eventLog = [];
    let lastEventTime = null;
    let connectionTimeout = null;
    let processedEventIds = new Set();
    let lastNativeEventTimestamp = 0;
    let processedNativeEventIds = new Set();
    let isInitialized = false;
    
    // イベント名の日本語マッピング
    const eventNameMap = {
        'playpause': '再生/一時停止',
        'nexttrack': '次の曲',
        'prevtrack': '前の曲',
        'skipforward': '早送り',
        'skipbackward': '巻き戻し',
        'play': '再生',
        'pause': '一時停止',
        'stop': '停止',
        'nextpage': '次のページ',
        'prevpage': '前のページ'
    };
    
    // イベントログに追加
    function addEventLog(eventType, source = 'bluetooth', metadata = {}) {
        const now = new Date();
        const eventTimestamp = metadata.timestamp ? new Date(metadata.timestamp) : now;
        const timestamp = eventTimestamp.toLocaleTimeString('ja-JP');
        const eventName = eventNameMap[eventType] || eventType;
        const logEntry = {
            timestamp,
            eventType,
            eventName,
            source,
            receivedAt: now.getTime(),
            isDoubleClick: Boolean(metadata.isDoubleClick),
            interval: typeof metadata.interval === 'number' ? metadata.interval : null,
            seekType: typeof metadata.seekType === 'number' ? metadata.seekType : null
        };
        
        eventLog.unshift(logEntry); // 最新を先頭に
        if (eventLog.length > 50) {
            eventLog = eventLog.slice(0, 50); // 最大50件
        }
        
        // イベントを受信したら接続状態を更新
        lastEventTime = now.getTime();
        updateConnectionStatus(true);
        
        // 接続タイムアウトをリセット（10秒後に待機中に戻す）
        if (connectionTimeout) {
            clearTimeout(connectionTimeout);
        }
        connectionTimeout = setTimeout(() => {
            const timeSinceLastEvent = Date.now() - lastEventTime;
            if (timeSinceLastEvent >= 10000) {
                updateConnectionStatus(false);
            }
        }, 10000);
        
        updateEventLogDisplay();
    }
    
    // イベントログ表示を更新
    function updateEventLogDisplay() {
        if (eventLog.length === 0) {
            eventLogContent.innerHTML = '<div class="event-log-empty">イベントログがここに表示されます</div>';
            return;
        }
        
        const logHTML = eventLog.map(entry => {
            let sourceBadge = '🧪';
            if (entry.source === 'bluetooth') {
                sourceBadge = '🎮';
            } else if (entry.source === 'ios') {
                sourceBadge = '📱';
            } else if (entry.source === 'ios-double') {
                sourceBadge = '📱✨';
            } else if (entry.source === 'webview-test') {
                sourceBadge = '🧪';
            }

            const details = [];
            if (entry.isDoubleClick) {
                details.push('ダブルクリック');
            }
            if (typeof entry.interval === 'number') {
                details.push(`${entry.interval}秒`);
            }
            if (typeof entry.seekType === 'number') {
                details.push(`seek:${entry.seekType}`);
            }
            const detailText = details.length > 0 ? ` <span class="event-log-meta">[${details.join(', ')}]</span>` : '';

            return `
                <div class="event-log-entry">
                    <span class="event-log-time">${entry.timestamp}</span>
                    <span class="event-log-source">${sourceBadge}</span>
                    <span class="event-log-event">${entry.eventName}</span>
                    <span class="event-log-type">(${entry.eventType})</span>
                    ${detailText}
                </div>
            `;
        }).join('');
        
        eventLogContent.innerHTML = logHTML;
    }
    
    // 接続状態を更新
    function updateConnectionStatus(connected) {
        if (connected) {
            statusDot.className = 'status-dot connected';
            statusText.textContent = '接続中';
        } else {
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = '接続待機中...';
        }
    }
    
    // テストボタンでイベントを送信
    async function sendTestEvent(eventType) {
        try {
            addEventLog(eventType, 'test');
            showSuccess(btControllerStatus, `テストイベント「${eventNameMap[eventType] || eventType}」を送信しました`);
            
            const data = await apiCall('/api/media/event', {
                method: 'POST',
                body: JSON.stringify({ eventType, source: 'webview-test' })
            });
            
            if (data.success) {
                showSuccess(btControllerStatus, `イベント「${eventNameMap[eventType] || eventType}」が処理されました`);
                updateConnectionStatus(true);
            } else {
                showError(btControllerStatus, data.error || 'イベント送信に失敗しました');
            }
        } catch (error) {
            showError(btControllerStatus, `通信エラー: ${error.message || error}`);
            updateConnectionStatus(false);
        }
    }
    
    // 初期化
    function initBtController() {
        console.log('[DEBUG] initBtController called');
        
        // テストボタンのイベントリスナー（毎回設定、重複を避けるために一度だけ）
        if (testButtons.length > 0 && !isInitialized) {
            testButtons.forEach(btn => {
                // 既存のリスナーを削除してから追加（重複を避ける）
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                newBtn.addEventListener('click', () => {
                    const eventType = newBtn.getAttribute('data-event');
                    if (eventType) {
                        sendTestEvent(eventType);
                    }
                });
            });
        }
        
        // ログクリアボタン
        if (clearLogBtn && !isInitialized) {
            clearLogBtn.addEventListener('click', () => {
                eventLog = [];
                processedEventIds.clear();
                lastCheckedTimestamp = 0;
                updateEventLogDisplay();
                showSuccess(btControllerStatus, 'イベントログをクリアしました');
            });
        }
        
        // WebSocket経由のdisplay_eventをリッスン（サーバー側から送られてくる）
        // サーバー側でshowTextWall()が呼ばれると、iPhone側にも同じdisplay_eventが届く
        // それをリッスンしてイベントログに表示する
        console.log('[DEBUG] Bluetoothコントローラーページ: display_eventの監視を開始（サーバー側から送信される）');
        
        // display_eventをリッスンしてイベントログに追加
        function handleDisplayEvent(event) {
            console.log('[btController] handleDisplayEvent called:', {
                currentPage: window.currentActivePage,
                hasDetail: !!event.detail,
                hasLayout: !!event.detail?.layout,
                hasMetadata: !!event.detail?.mediaEventMetadata
            })
            
            if (window.currentActivePage !== 'btController') {
                console.log('[btController] Not on btController page, ignoring')
                return
            }
            
            const displayEvent = event.detail
            if (!displayEvent || !displayEvent.layout) {
                console.log('[btController] Invalid display event, ignoring')
                return
            }
            
            // メタデータ（最新のメディアイベント情報）が含まれている場合、イベントログに追加
            if (displayEvent.mediaEventMetadata) {
                const mediaEvent = displayEvent.mediaEventMetadata
                console.log('[btController] Media event metadata found:', {
                    eventType: mediaEvent.eventType,
                    source: mediaEvent.source,
                    timestamp: mediaEvent.timestamp
                })
                
                // Bluetoothイベントの場合のみイベントログに追加
                if (mediaEvent.source === 'bluetooth-ios' || mediaEvent.source === 'bluetooth') {
                    console.log('[btController] Adding Bluetooth event to log')
                    addEventLog(mediaEvent.eventType, mediaEvent.source || 'bluetooth', {
                        timestamp: mediaEvent.timestamp,
                        isDoubleClick: mediaEvent.isDoubleClick,
                        interval: mediaEvent.interval,
                        seekType: mediaEvent.seekType
                    })
                } else {
                    console.log('[btController] Not a Bluetooth event, skipping log')
                }
            } else {
                console.log('[btController] No media event metadata found')
            }
            
            // 接続状態を更新（サーバー側から表示が来たということは接続中）
            console.log('[btController] Updating connection status to connected')
            updateConnectionStatus(true)
            lastEventTime = Date.now()
        }
        
        window.addEventListener('mentraDisplayEvent', handleDisplayEvent)
        
        // 初期状態は接続待機中
        updateConnectionStatus(false);
        
        // ポーリングは削除済み（display_eventベースで接続状態を管理）
        // display_eventが来たときに接続状態を更新し、
        // 一定時間（10秒）経過したら「接続待機中...」に戻す
        // 最後のイベントから10秒以上経過していたら待機中に戻す（定期的にチェック）
        setInterval(() => {
            if (window.currentActivePage !== 'btController') return;
            if (lastEventTime) {
                const timeSinceLastEvent = Date.now() - lastEventTime;
                if (timeSinceLastEvent >= 10000) {
                    updateConnectionStatus(false);
                    console.log('[btController] Timeout: No events for 10 seconds, setting to disconnected');
                }
            }
        }, 5000); // 5秒ごとにチェック（接続状態のタイムアウトのみ）

        isInitialized = true;
        updateEventLogDisplay();
        if (!lastEventTime) {
            updateConnectionStatus(false);
        }
        
        console.log('[DEBUG] initBtController completed (display_eventベース、ポーリングなし)');
    }
    
    // 最新のイベント履歴を取得
    async function checkRecentEvents() {
        try {
            // サーバーから最新のイベント履歴を取得するAPI（後で実装）
            // 今はポーリングで最新イベントを確認
            // 実際のBluetoothイベントはサーバー側で受信されるので、
            // ここではクライアント側で受信したイベントのみを表示
        } catch (error) {
            console.log('イベント確認:', error.message);
        }
    }
    
    // pollServerEventsは削除（SSEに置き換え）
    
    function forwardNativeEvent(detail, isDoubleClickEvent) {
        // この関数は無効化されました
        // 通常の動作では、mediaControlHandler.jsが処理します
        // テストページでのログ表示のみが有効です
        
        // テストページでない場合は何もしない
        const currentPage = window.currentActivePage || 'top';
        if (currentPage !== 'btController') {
            return;
        }
        
        // テストページでのみ、サーバーへのPOSTを実行（接続テスト用）
        // ただし、通常の動作ではmediaControlHandler.jsが処理するため、
        // ここでのPOSTは重複する可能性があるので、コメントアウト
        /*
        if (!detail || !detail.eventType) {
            return;
        }

        const eventId = detail.timestamp
            ? `${detail.timestamp}_${detail.eventType}_${isDoubleClickEvent ? 'double' : 'single'}`
            : null;

        if (eventId) {
            if (processedNativeEventIds.has(eventId)) {
                return;
            }
            processedNativeEventIds.add(eventId);
            if (processedNativeEventIds.size > 200) {
                const ids = Array.from(processedNativeEventIds);
                processedNativeEventIds = new Set(ids.slice(-200));
            }
        }

        // ダブルクリックイベントはログに残すがAPIには送信しない（シングルイベントでisDoubleClickフラグを送信）
        if (isDoubleClickEvent) {
            return;
        }

        const payload = {
            eventType: detail.eventType,
            isDoubleClick: Boolean(detail.isDoubleClick),
            source: 'ios',
            timestamp: detail.timestamp || Date.now()
        };

        if (typeof detail.interval === 'number') {
            payload.interval = detail.interval;
        }
        if (typeof detail.seekType === 'number') {
            payload.seekType = detail.seekType;
        }

        apiCall('/api/media/event', {
            method: 'POST',
            body: JSON.stringify(payload)
        }).then(() => {
            updateConnectionStatus(true);
        }).catch(error => {
            console.warn('iOSメディアイベント送信エラー:', error);
        });
        */
    }

    function logNativeEvent(detail, isDoubleClickEvent = false) {
        if (!detail || !detail.eventType) {
            return;
        }

        const source = isDoubleClickEvent ? 'ios-double' : 'ios';
        const metadata = {
            timestamp: detail.timestamp,
            isDoubleClick: Boolean(detail.isDoubleClick || isDoubleClickEvent),
            interval: typeof detail.interval === 'number' ? detail.interval : undefined,
            seekType: typeof detail.seekType === 'number' ? detail.seekType : undefined
        };

        addEventLog(detail.eventType, source, metadata);
        if (detail.timestamp) {
            lastNativeEventTimestamp = detail.timestamp;
        }

        forwardNativeEvent(detail, isDoubleClickEvent);
    }

    // Bluetooth media control events are now handled directly by iOS and sent to server
    // No event listeners needed here anymore

    // グローバルに公開
    window.initBtController = initBtController;
    window.btControllerLogEvent = logNativeEvent;
})();

