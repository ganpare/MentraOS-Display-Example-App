// ボタン設定機能モジュール（新形式：アクション→トリガー）
(function() {
    'use strict';
    
    // DOM要素
    const settingsContainer = document.getElementById('settingsContainer');
    const settingsStatus = document.getElementById('settingsStatus');
    
    // トリガー名マッピング
    const triggerNames = {
        'playpause': '⏯️ 再生/一時停止',
        'nexttrack': '⏭️ 次の曲',
        'prevtrack': '⏮️ 前の曲',
        'none': 'なし'
    };
    
    let availableActions = {};
    let availableTriggers = {};
    let currentSettings = null;
    
    // 利用可能なアクション一覧を取得
    async function loadAvailableActions() {
        try {
            const data = await apiCall('/api/settings/actions');
            if (data.success && data.actions) {
                availableActions = data.actions;
            }
        } catch (error) {
            console.error('アクション一覧の取得エラー:', error);
            showError(settingsStatus, `アクション一覧の取得に失敗しました: ${error.message || error}`);
        }
    }
    
    // 利用可能なトリガー一覧を取得
    async function loadAvailableTriggers() {
        try {
            const data = await apiCall('/api/settings/triggers');
            if (data.success && data.triggers) {
                availableTriggers = data.triggers;
            }
        } catch (error) {
            console.error('トリガー一覧の取得エラー:', error);
            showError(settingsStatus, `トリガー一覧の取得に失敗しました: ${error.message || error}`);
        }
    }
    
    // 現在の設定を取得
    async function loadSettings() {
        try {
            console.log('[Settings] 設定を読み込み中...');
            const data = await apiCall('/api/settings/media');
            console.log('[Settings] 設定取得レスポンス:', data);
            
            if (data.success && data.settings) {
                currentSettings = data.settings;
                console.log('[Settings] 設定を読み込みました:', currentSettings);
                renderSettings();
            } else {
                console.error('[Settings] 設定取得失敗:', data);
                showError(settingsStatus, data.error || '設定の取得に失敗しました');
            }
        } catch (error) {
            console.error('[Settings] 設定の取得エラー:', error);
            showError(settingsStatus, `設定の取得に失敗しました: ${error.message || error}`);
        }
    }
    
    // 設定を保存
    async function saveSettings() {
        try {
            const actionMappings = {};
            
            // 各アクションの設定を取得
            for (const actionId of Object.keys(availableActions)) {
                const singleTrigger = document.getElementById(`${actionId}-single-trigger`).value;
                const doubleTrigger = document.getElementById(`${actionId}-double-trigger`).value;
                
                actionMappings[actionId] = {
                    single: {
                        trigger: singleTrigger
                    },
                    double: {
                        trigger: doubleTrigger
                    }
                };
            }
            
            const data = await apiCall('/api/settings/media', {
                method: 'PUT',
                body: JSON.stringify({ actionMappings })
            });
            
            if (data.success) {
                currentSettings = data.settings;
                showSuccess(settingsStatus, '設定を保存しました');
                setTimeout(() => {
                    settingsStatus.textContent = '';
                    settingsStatus.className = 'status';
                }, 3000);
            } else {
                showError(settingsStatus, data.error || '設定の保存に失敗しました');
            }
        } catch (error) {
            console.error('設定の保存エラー:', error);
            showError(settingsStatus, `設定の保存に失敗しました: ${error.message || error}`);
        }
    }
    
    // 設定画面をレンダリング
    function renderSettings() {
        if (!currentSettings || !availableActions || !availableTriggers) {
            settingsContainer.innerHTML = '<div class="settings-loading">設定を読み込み中...</div>';
            return;
        }
        
        // カテゴリ別にアクションをグループ化
        const actionsByCategory = {
            text: [],
            audio: []
        };
        
        for (const [actionId, action] of Object.entries(availableActions)) {
            const category = action.category || 'other';
            if (actionsByCategory[category]) {
                actionsByCategory[category].push({ id: actionId, ...action });
            }
        }
        
        const actionMappings = currentSettings.actionMappings || {};
        
        let html = '';
        
        // アクションカードのHTMLを生成する関数
        function renderActionCard(action, mapping) {
            return `
                <div class="action-setting-card">
                    <div class="action-header">
                        <h3>${action.name}</h3>
                        <p class="action-description">${action.description}</p>
                        <div class="action-details">
                            <div class="detail-item">
                                <span class="detail-label">アクションID:</span>
                                <code class="detail-value">${action.id}</code>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">ボタンID:</span>
                                <code class="detail-value">${action.buttonId || 'N/A'}</code>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">関数:</span>
                                <code class="detail-value">${action.functionName || 'N/A'}</code>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">サーバー側アクション:</span>
                                <code class="detail-value">${action.serverActionType || 'N/A'}</code>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">API:</span>
                                <code class="detail-value">${action.apiEndpoint || 'N/A'}</code>
                            </div>
                            <div class="detail-item">
                                <span class="detail-label">実装:</span>
                                <code class="detail-value">${action.implementation || 'N/A'}</code>
                            </div>
                        </div>
                    </div>
                    
                    <div class="trigger-settings">
                        <div class="trigger-setting">
                            <label class="trigger-label">シングルクリック</label>
                            <select id="${action.id}-single-trigger" class="trigger-select">
                                ${Object.keys(availableTriggers).map(triggerId => {
                                    const selected = mapping.single?.trigger === triggerId ? 'selected' : '';
                                    const triggerName = triggerNames[triggerId] || triggerId;
                                    return `<option value="${triggerId}" ${selected}>${triggerName}</option>`;
                                }).join('')}
                            </select>
                        </div>
                        
                        <div class="trigger-setting">
                            <label class="trigger-label">ダブルクリック</label>
                            <select id="${action.id}-double-trigger" class="trigger-select">
                                ${Object.keys(availableTriggers).map(triggerId => {
                                    const selected = mapping.double?.trigger === triggerId ? 'selected' : '';
                                    const triggerName = triggerNames[triggerId] || triggerId;
                                    return `<option value="${triggerId}" ${selected}>${triggerName}</option>`;
                                }).join('')}
                            </select>
                        </div>
                    </div>
                </div>
            `;
        }
        
        // テキストリーダーセクション
        if (actionsByCategory.text.length > 0) {
            html += `
                <div class="settings-section">
                    <h2 class="settings-section-title">📄 テキストリーダー</h2>
                    ${actionsByCategory.text.map(action => {
                        const mapping = actionMappings[action.id] || {
                            single: { trigger: 'none' },
                            double: { trigger: 'none' }
                        };
                        return renderActionCard(action, mapping);
                    }).join('')}
                </div>
            `;
        }
        
        // 音声プレーヤーセクション
        if (actionsByCategory.audio.length > 0) {
            html += `
                <div class="settings-section">
                    <h2 class="settings-section-title">🎵 音声プレーヤー</h2>
                    ${actionsByCategory.audio.map(action => {
                        const mapping = actionMappings[action.id] || {
                            single: { trigger: 'none' },
                            double: { trigger: 'none' }
                        };
                        return renderActionCard(action, mapping);
                    }).join('')}
                </div>
            `;
        }
        
        settingsContainer.innerHTML = `
            ${html}
            <div class="settings-actions">
                <button id="saveSettingsBtn" class="save-btn">💾 設定を保存</button>
                <button id="resetSettingsBtn" class="reset-btn">🔄 デフォルトに戻す</button>
            </div>
        `;
        
        // イベントリスナーを設定
        setupEventListeners();
    }
    
    // イベントリスナーを設定
    function setupEventListeners() {
        // 保存ボタン
        const saveBtn = document.getElementById('saveSettingsBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveSettings);
        }
        
        // リセットボタン
        const resetBtn = document.getElementById('resetSettingsBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                if (confirm('設定をデフォルト（すべて「なし」）に戻しますか？')) {
                    const actionMappings = {};
                    for (const actionId of Object.keys(availableActions)) {
                        actionMappings[actionId] = {
                            single: { trigger: 'none' },
                            double: { trigger: 'none' }
                        };
                    }
                    
                    try {
                        const data = await apiCall('/api/settings/media', {
                            method: 'PUT',
                            body: JSON.stringify({ actionMappings })
                        });
                        
                        if (data.success) {
                            currentSettings = data.settings;
                            renderSettings();
                            showSuccess(settingsStatus, '設定をデフォルトに戻しました');
                        }
                    } catch (error) {
                        showError(settingsStatus, `リセットに失敗しました: ${error.message || error}`);
                    }
                }
            });
        }
    }
    
    // 初期化
    async function initSettings() {
        settingsStatus.textContent = '';
        settingsStatus.className = 'status';
        settingsContainer.innerHTML = '<div class="settings-loading">設定を読み込み中...</div>';
        
        await Promise.all([
            loadAvailableActions(),
            loadAvailableTriggers()
        ]);
        await loadSettings();
    }
    
    // グローバルに公開
    window.initSettings = initSettings;
})();
