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
    
    // ページ情報を更新する関数
    function updatePageInfo(pageInfo) {
        if (pageInfo) {
            currentPageInfo = pageInfo;
        }
        
        if (currentPageInfo) {
            pageInfoEl.textContent = `ページ ${currentPageInfo.pageInfo}`;
        }
        updateARDisplay(arDisplayContent);
    }
    
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
        } catch (error) {
            showError(statusEl, `通信エラー: ${error.message}`);
        } finally {
            displayBtn.disabled = false;
        }
    });
    
    // ページナビゲーション
    prevBtn.addEventListener('click', async () => {
        if (!currentPageInfo) return;
        prevBtn.disabled = true;
        await navigatePage('prevpage', statusEl, updatePageInfo);
        prevBtn.disabled = false;
    });
    
    nextBtn.addEventListener('click', async () => {
        if (!currentPageInfo) return;
        nextBtn.disabled = true;
        await navigatePage('nextpage', statusEl, updatePageInfo);
        nextBtn.disabled = false;
    });
})();

