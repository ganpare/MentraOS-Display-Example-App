// 共通ユーティリティ関数

// APIのベースURL
const apiBaseUrl = '';

// APIベースURLを取得（外部モジュール用）
function getApiBaseUrl() {
    return apiBaseUrl;
}

// API呼び出しのヘルパー関数
async function apiCall(endpoint, options = {}) {
    const defaultOptions = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    // FormDataの場合はContent-Typeを削除（ブラウザが自動設定）
    if (options.body instanceof FormData) {
        delete defaultOptions.headers['Content-Type'];
    }
    
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.body instanceof FormData ? {} : options.headers || {})
        }
    };
    
    const response = await fetch(`${apiBaseUrl}${endpoint}`, mergedOptions);
    
    if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
            errorData = JSON.parse(errorText);
        } catch (e) {
            errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` };
        }
        throw new Error(errorData.error || `HTTP ${response.status}`);
    }
    
    return await response.json();
}

// ARデバイス表示内容を更新する関数
async function updateARDisplay(displayElement) {
    if (!displayElement) return;
    
    try {
        const data = await apiCall('/api/text/current');
        
        if (data.success && data.text) {
            displayElement.textContent = data.text;
            
            // ページ情報も更新する（Bluetoothイベント対応）
            if (data.pageInfo) {
                // カスタムイベントを発火して、textReader.jsにページ情報の更新を通知
                window.dispatchEvent(new CustomEvent('arDisplayPageInfoUpdated', {
                    detail: {
                        pageInfo: data.pageInfo,
                        text: data.text
                    }
                }));
            }
        }
    } catch (error) {
        console.error('AR表示更新エラー:', error);
    }
}

// エラーメッセージを表示するヘルパー関数
function showError(element, message) {
    element.textContent = `❌ ${message}`;
    element.className = 'status error';
}

// 成功メッセージを表示するヘルパー関数
function showSuccess(element, message) {
    element.textContent = `✅ ${message}`;
    element.className = 'status success';
}

// ページ移動処理の共通関数
async function navigatePage(eventType, statusEl, updatePageInfoCallback) {
    statusEl.textContent = eventType === 'prevpage' ? '前のページに移動中...' : '次のページに移動中...';
    statusEl.className = 'status';
    
    try {
        const data = await apiCall('/api/media/event', {
            method: 'POST',
            body: JSON.stringify({ 
                eventType,
                source: 'webview' // GUIボタンからのクリック
            })
        });
        
        if (data.success && data.pageInfo) {
            if (updatePageInfoCallback) {
                updatePageInfoCallback({
                    currentPage: data.pageInfo.currentPage,
                    totalPages: data.pageInfo.totalPages,
                    pageInfo: data.pageInfo.pageInfo
                });
            }
            showSuccess(statusEl, `ページ ${data.pageInfo.pageInfo}`);
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 2000);
        } else {
            showError(statusEl, data.error || 'ページ移動に失敗しました');
        }
    } catch (error) {
        showError(statusEl, `通信エラー: ${error.message || error}`);
    }
}

