// テキストリーダー機能モジュール
(function() {
    'use strict';
    
    // DOM要素
    const fileInput = document.getElementById('fileInput');
    const textInput = document.getElementById('textInput');
    const displayBtn = document.getElementById('displayBtn');
    const statusEl = document.getElementById('status');
    const fileInfoEl = document.getElementById('fileInfo');
    const navigationArea = document.getElementById('navigationArea');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const pageInfoEl = document.getElementById('pageInfo');
    const arDisplayContent = document.getElementById('arDisplayContent');
    
    // 状態管理
    let selectedFile = null;
    let currentPageInfo = null;
    
    // ポーリングは削除（WebSocket経由のdisplay_eventでリアルタイムに更新される）
    // display_eventをリッスンしてARプレビューを更新
    function handleDisplayEvent(event) {
        if (window.currentActivePage !== 'textReader') return
        
        const displayEvent = event.detail
        if (!displayEvent || !displayEvent.layout) return
        
        // テキストコンテンツが含まれている場合、ARプレビューを更新
        if (displayEvent.layout.text) {
            const text = displayEvent.layout.text
            arDisplayContent.textContent = text

            // ページ情報が付いていない場合は、テキスト末尾の X/Y 形式を推測して更新
            if (displayEvent.pageInfo) {
                updatePageInfo(displayEvent.pageInfo)
            } else {
                const lines = (text || '').trim().split('\n')
                const last = lines[lines.length - 1] || ''
                const m = last.match(/^(\d+)\/(\d+)$/)
                if (m) {
                    updatePageInfo({
                        currentPage: parseInt(m[1], 10),
                        totalPages: parseInt(m[2], 10),
                        pageInfo: `${m[1]}/${m[2]}`
                    })
                }
                // サーバーへ /api/text/current は呼ばない（ログ削減 & 即時反映のため）
            }
        }
    }
    
    // ARプレビューを即座に更新する関数（Bluetoothイベント対応）
    // サーバー側でページが変更されたときに呼び出される想定
    function forceUpdateARDisplay() {
        if (window.currentActivePage === 'textReader' && currentPageInfo) {
            updateARDisplay(arDisplayContent);
        }
    }
    
    // グローバルに公開（サーバー側からのコールバック用、またはポーリング用）
    window.forceUpdateARDisplay = forceUpdateARDisplay;
    
    // ポーリングは削除済み（不要）
    
    // ページ情報を更新する関数
    function updatePageInfo(pageInfo) {
        if (pageInfo) {
            currentPageInfo = pageInfo;
        }
        
        if (currentPageInfo) {
            pageInfoEl.textContent = `ページ ${currentPageInfo.pageInfo}`;
        }
        // ここで /api/text/current を呼びにいかない（display_eventベースで即時反映する）
    }
    
    // WebSocket経由のdisplay_eventをリッスン（サーバー側から送られてくる）
    window.addEventListener('mentraDisplayEvent', handleDisplayEvent)
    
    // ページ変更イベントをリッスン
    window.addEventListener('pageChanged', (event) => {
        if (event.detail.page === 'textReader') {
            // テキストリーダー画面に入ったら、最新のページ情報を取得
            if (currentPageInfo) {
                updateARDisplay(arDisplayContent);
            }
        }
    });
    
    // ARプレビューのページ情報が更新されたときに、ローカルのページ情報も更新
    // これはBluetoothイベントでサーバー側からページが変更された場合に発火される
    window.addEventListener('arDisplayPageInfoUpdated', (event) => {
        if (event.detail.pageInfo) {
            // ページ情報を更新（Bluetoothイベントでサーバー側から更新された場合）
            updatePageInfo(event.detail.pageInfo);
        }
    });
    
    // ファイル選択イベント
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        selectedFile = file;
        fileInfoEl.textContent = `選択されたファイル: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
        fileInfoEl.style.display = 'block';

        if (file.type === 'text/plain' || 
            file.type === 'text/markdown' || 
            file.type === 'text/csv' ||
            file.name.endsWith('.txt') || 
            file.name.endsWith('.md') || 
            file.name.endsWith('.markdown') ||
            file.name.endsWith('.csv')) {
            
            statusEl.textContent = 'ファイルを読み込み中...';
            statusEl.className = 'status';
            statusEl.style.display = 'block';
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                const textContent = e.target.result;
                textInput.value = textContent;
                
                try {
                    statusEl.textContent = 'サーバーに送信中...';
                    statusEl.className = 'status';
                    
                    const formData = new FormData();
                    formData.append('file', file);
                    
                    const data = await apiCall('/api/upload-text', {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (data.success) {
                        updatePageInfo({
                            currentPage: data.currentPage,
                            totalPages: data.totalPages,
                            pageInfo: `${data.currentPage}/${data.totalPages}`
                        });
                        navigationArea.classList.add('show');
                        
                        showSuccess(statusEl, `ファイルを読み込みました。ページ ${currentPageInfo.pageInfo} を表示しました。`);
                        setTimeout(() => updateARDisplay(arDisplayContent), 500);
                        // ポーリングは削除済み（display_eventでリアルタイムに更新される）
                    } else {
                        showError(statusEl, data.error);
                    }
                } catch (error) {
                    showError(statusEl, `通信エラー: ${error.message || error}`);
                }
            };
            reader.readAsText(file);
        } else {
            showError(statusEl, 'テキストファイル(.txt, .md, .csv)を選択してください');
        }
    });
    
    // 表示ボタンイベント
    displayBtn.addEventListener('click', async () => {
        const text = textInput.value.trim();
        
        if (!text) {
            showError(statusEl, 'テキストが入力されていません');
            return;
        }

        displayBtn.disabled = true;
        statusEl.textContent = '送信中...';
        statusEl.className = 'status';

        try {
            const data = await apiCall('/api/upload-text', {
                method: 'POST',
                body: JSON.stringify({ text: text })
            });
            
            if (!data.success) {
                showError(statusEl, data.error);
                displayBtn.disabled = false;
                return;
            }
            
            updatePageInfo({
                currentPage: data.currentPage,
                totalPages: data.totalPages,
                pageInfo: `${data.currentPage}/${data.totalPages}`
            });
            navigationArea.classList.add('show');
            
            showSuccess(statusEl, `ARグラスに表示しました！ページ ${currentPageInfo.pageInfo}`);
            setTimeout(() => updateARDisplay(arDisplayContent), 500);
            // ポーリングは削除済み（display_eventでリアルタイムに更新される）
        } catch (error) {
            showError(statusEl, `通信エラー: ${error.message}`);
        } finally {
            displayBtn.disabled = false;
        }
    });
    
    // ページナビゲーション
    prevBtn.addEventListener('click', async () => {
        if (!currentPageInfo) return;
        if (prevBtn.disabled) return;
        prevBtn.disabled = true;
        await navigatePage('prevpage', statusEl, updatePageInfo);
        prevBtn.disabled = false;
    });
    
    nextBtn.addEventListener('click', async () => {
        if (!currentPageInfo) return;
        if (nextBtn.disabled) return;
        nextBtn.disabled = true;
        await navigatePage('nextpage', statusEl, updatePageInfo);
        nextBtn.disabled = false;
    });
})();
