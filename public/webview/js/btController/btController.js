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
    let pollInterval = null;
    let lastEventTime = null;
    let connectionTimeout = null;
    let lastCheckedTimestamp = 0;
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
        if (!isInitialized) {
            // テストボタンのイベントリスナー
            testButtons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const eventType = btn.getAttribute('data-event');
                    if (eventType) {
                        sendTestEvent(eventType);
                    }
                });
            });
            
            // ログクリアボタン
            clearLogBtn.addEventListener('click', () => {
                eventLog = [];
                processedEventIds.clear();
                lastCheckedTimestamp = 0;
                updateEventLogDisplay();
                showSuccess(btControllerStatus, 'イベントログをクリアしました');
            });
            
            // 既存のポーリングを停止
            if (pollInterval) {
                clearInterval(pollInterval);
            }
            
            // 最初にサーバーからイベント履歴を取得
            pollServerEvents();
            
            // 定期的にサーバーから最新イベントを取得（2秒ごと）
            pollInterval = setInterval(() => {
                pollServerEvents();
                
                // 最後のイベントから10秒以上経過していたら待機中に戻す
                if (lastEventTime) {
                    const timeSinceLastEvent = Date.now() - lastEventTime;
                    if (timeSinceLastEvent >= 10000) {
                        updateConnectionStatus(false);
                    }
                }
            }, 2000);

            isInitialized = true;
        }

        updateEventLogDisplay();
        if (!lastEventTime) {
            updateConnectionStatus(false);
        }
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
    
    // サーバー側で受信したイベントを取得（ポーリング）
    async function pollServerEvents() {
        try {
            const data = await apiCall('/api/media/events/history');
            
            if (data.success && data.events && Array.isArray(data.events)) {
                // 新しいイベントをチェック
                for (const event of data.events) {
                    // イベントIDを作成（タイムスタンプ + イベントタイプ）
                    const eventId = `${event.timestamp}_${event.eventType}_${event.isDoubleClick ? 'double' : 'single'}`;
                    
                    // まだ処理していないイベントのみ追加
                    if (!processedEventIds.has(eventId) && event.timestamp > lastCheckedTimestamp) {
                        processedEventIds.add(eventId);
                        
                        const source = event.source || 'bluetooth';
                        addEventLog(event.eventType, source, {
                            timestamp: event.timestamp,
                            isDoubleClick: event.isDoubleClick,
                            interval: event.interval,
                            seekType: event.seekType
                        });
                        
                        // 最新タイムスタンプを更新
                        if (event.timestamp > lastCheckedTimestamp) {
                            lastCheckedTimestamp = event.timestamp;
                        }
                    }
                }
                
                // processedEventIdsのサイズを制限（メモリリーク防止）
                if (processedEventIds.size > 100) {
                    const idsArray = Array.from(processedEventIds);
                    processedEventIds = new Set(idsArray.slice(-50));
                }
            }
        } catch (error) {
            console.log('サーバーイベント取得:', error.message);
        }
    }
    
    function forwardNativeEvent(detail, isDoubleClickEvent) {
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

    window.addEventListener('mentraMediaControl', (event) => {
        try {
            const detail = event && event.detail ? event.detail : {};
            logNativeEvent(detail, false);
        } catch (error) {
            console.warn('mentraMediaControl処理中にエラー:', error);
        }
    });

    window.addEventListener('mentraMediaControlDoubleClick', (event) => {
        try {
            const detail = event && event.detail ? event.detail : {};
            logNativeEvent(detail, true);
        } catch (error) {
            console.warn('mentraMediaControlDoubleClick処理中にエラー:', error);
        }
    });

    // グローバルに公開
    window.initBtController = initBtController;
    window.btControllerLogEvent = logNativeEvent;
})();

