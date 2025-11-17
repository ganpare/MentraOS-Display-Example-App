// メイン初期化スクリプト
(function() {
    'use strict';
    
    // ページ管理
    const pages = {
        top: document.getElementById('topPage'),
        textReader: document.getElementById('textReaderPage'),
        audioPlayer: document.getElementById('audioPlayerPage'),
        btController: document.getElementById('btControllerPage'),
        settings: document.getElementById('settingsPage')
    };
    
    // 現在のアクティブページを追跡（グローバルに公開）
    window.currentActivePage = 'top';
    
    // ページ状態をサーバーに通知する関数
    async function notifyPageChange(pageName) {
        try {
            await apiCall('/api/media/page', {
                method: 'POST',
                body: JSON.stringify({ currentPage: pageName })
            });
        } catch (error) {
            console.error('ページ状態通知エラー:', error);
        }
    }
    
    function showPage(pageName) {
        Object.values(pages).forEach(page => page.classList.remove('active'));
        pages[pageName].classList.add('active');
        window.currentActivePage = pageName;
        // ページ変更イベントを発火（他のモジュールで使用可能）
        window.dispatchEvent(new CustomEvent('pageChanged', { detail: { page: pageName } }));
        // サーバーにページ状態を通知
        notifyPageChange(pageName);
    }
    
    // トップページナビゲーション
    document.getElementById('textReaderBtn').addEventListener('click', () => showPage('textReader'));
    document.getElementById('audioPlayerBtn').addEventListener('click', () => {
        showPage('audioPlayer');
        if (window.showAudioDirectoryScreen) {
            window.showAudioDirectoryScreen();
        }
    });
    document.getElementById('backToTopBtn').addEventListener('click', () => showPage('top'));
    document.getElementById('backToTopBtn2').addEventListener('click', () => showPage('top'));
    document.getElementById('btControllerBtn').addEventListener('click', () => {
        showPage('btController');
        // initBtControllerは即座に呼び出す（確実に初期化するため）
        setTimeout(() => {
            if (window.initBtController) {
                window.initBtController();
            } else {
                console.error('[ERROR] initBtControllerが見つかりません');
            }
        }, 100); // DOM更新を待つ
    });
    
    // ページ変更イベントでも初期化を確認（フォールバック）
    window.addEventListener('pageChanged', (event) => {
        if (event.detail.page === 'btController') {
            setTimeout(() => {
                if (window.initBtController) {
                    window.initBtController();
                }
            }, 100);
        }
    });
    document.getElementById('backToTopBtn3').addEventListener('click', () => showPage('top'));
    document.getElementById('settingsBtn').addEventListener('click', () => {
        showPage('settings');
        if (window.initSettings) {
            window.initSettings();
        }
    });
    document.getElementById('backToTopBtn4').addEventListener('click', () => showPage('top'));
})();

