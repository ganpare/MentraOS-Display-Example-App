// メディアコントロールイベントハンドラー
// Bluetoothボタンを押すと、設定に基づいて対応するGUIボタンをクリックする
(function() {
    'use strict';
    
    let userSettings = null;
    let isLoadingSettings = false;
    
    // アクションID → DOM要素IDのマッピング
    const actionIdToButtonId = {
        'text_prevBtn': 'prevBtn',
        'text_nextBtn': 'nextBtn',
        'audio_playBtn': 'playBtn',
        'audio_pauseBtn': 'pauseBtn',
        'audio_skipForwardBtn': 'skipForwardBtn',
        'audio_skipBackwardBtn': 'skipBackwardBtn',
        'audio_nextSubtitleBtn': 'nextSubtitleBtn',
        'audio_prevSubtitleBtn': 'prevSubtitleBtn',
        'audio_repeatSubtitleBtn': 'repeatSubtitleBtn',
        'audio_speedBtn': 'speedBtn'
    };
    
    // 設定を読み込む
    async function loadSettings() {
        if (isLoadingSettings) return;
        isLoadingSettings = true;
        
        try {
            const data = await apiCall('/api/settings/media');
            if (data.success && data.settings) {
                userSettings = data.settings;
                console.log('[MediaControl] 設定を読み込みました', userSettings);
            }
        } catch (error) {
            console.error('[MediaControl] 設定の読み込みエラー:', error);
        } finally {
            isLoadingSettings = false;
        }
    }
    
    
    // GUIボタンをクリック
    function clickGUButton(actionId) {
        const buttonId = actionIdToButtonId[actionId];
        if (!buttonId) {
            console.warn(`[MediaControl] ボタンIDが見つかりません: ${actionId}`);
            return false;
        }
        
        const button = document.getElementById(buttonId);
        if (!button) {
            console.warn(`[MediaControl] DOM要素が見つかりません: ${buttonId}`);
            return false;
        }
        
        console.log(`[MediaControl] GUIボタンをクリック: ${buttonId} (${actionId})`);
        
        // ボタンをクリック
        button.click();
        
        // 視覚的フィードバック（オプション）
        button.style.opacity = '0.5';
        setTimeout(() => {
            button.style.opacity = '1';
        }, 200);
        
        return true;
    }
    
    // メディアコントロールイベントを処理
    async function handleMediaControlEvent(event) {
        try {
            const detail = event && event.detail ? event.detail : {};
            const eventType = detail.eventType;
            const isDoubleClick = Boolean(detail.isDoubleClick);
            
            if (!eventType) {
                return;
            }
            
            console.log(`[MediaControl] イベント受信: ${eventType}, doubleClick: ${isDoubleClick}`);
            
            // 現在のアクティブページを取得
            const currentPage = window.currentActivePage || 'top';
            console.log(`[MediaControl] 現在のページ: ${currentPage}`);
            
            // サーバーにメディアイベントを送信（現在のページ情報を含める）
            try {
                await apiCall('/api/media/event', {
                    method: 'POST',
                    body: JSON.stringify({
                        eventType: eventType,
                        isDoubleClick: isDoubleClick,
                        currentPage: currentPage,
                        interval: detail.interval,
                        seekType: detail.seekType,
                        timestamp: detail.timestamp || Date.now(),
                        source: 'bluetooth'
                    })
                });
                console.log(`[MediaControl] サーバーにメディアイベントを送信: ${eventType} (ページ: ${currentPage})`);
            } catch (error) {
                console.error('[MediaControl] サーバーへの送信エラー:', error);
            }
            
            // 設定が読み込まれていない場合は読み込む
            if (!userSettings && !isLoadingSettings) {
                loadSettings();
                return;
            }
            
            // 設定がまだ読み込まれていない場合は待機
            if (!userSettings) {
                console.log('[MediaControl] 設定の読み込み待機中...');
                return;
            }
            
            // トリガーに対応するアクションを検索（画面ごとにフィルタリング）
            const actionId = findActionForTrigger(eventType, isDoubleClick, currentPage);
            
            if (actionId) {
                console.log(`[MediaControl] アクションを実行: ${actionId} (トリガー: ${eventType}, ${isDoubleClick ? 'double' : 'single'}, ページ: ${currentPage})`);
                clickGUButton(actionId);
            } else {
                console.log(`[MediaControl] 対応するアクションが見つかりません (トリガー: ${eventType}, ${isDoubleClick ? 'double' : 'single'}, ページ: ${currentPage})`);
            }
        } catch (error) {
            console.error('[MediaControl] イベント処理エラー:', error);
        }
    }
    
    // トリガーからアクションを逆引き（画面ごとにフィルタリング）
    function findActionForTrigger(eventType, isDoubleClick, currentPage) {
        if (!userSettings || !userSettings.actionMappings) {
            return null;
        }
        
        const clickType = isDoubleClick ? 'double' : 'single';
        
        // 現在のページに応じてアクションをフィルタリング
        const pageActionPrefix = currentPage === 'textReader' ? 'text_' : 
                                 currentPage === 'audioPlayer' ? 'audio_' : null;
        
        if (!pageActionPrefix) {
            // トップページやその他のページでは何もしない
            return null;
        }
        
        // 該当するページのアクションのみを検索
        for (const [actionId, mapping] of Object.entries(userSettings.actionMappings)) {
            if (!mapping) continue;
            
            // 現在のページに属するアクションのみをチェック
            if (!actionId.startsWith(pageActionPrefix)) continue;
            
            const triggerMapping = mapping[clickType];
            if (triggerMapping && triggerMapping.trigger === eventType) {
                return actionId;
            }
        }
        
        return null;
    }
    
    // イベントリスナーを登録
    window.addEventListener('mentraMediaControl', (event) => {
        handleMediaControlEvent(event);
    });
    
    window.addEventListener('mentraMediaControlDoubleClick', (event) => {
        handleMediaControlEvent(event);
    });
    
    // 初期化時に設定を読み込む
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadSettings);
    } else {
        loadSettings();
    }
    
    // グローバルに公開（デバッグ用）
    window.mediaControlHandler = {
        loadSettings,
        clickGUButton,
        getSettings: () => userSettings,
        getCurrentPage: () => window.currentActivePage || 'top'
    };
})();

