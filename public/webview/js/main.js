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
    
    function showPage(pageName) {
        Object.values(pages).forEach(page => page.classList.remove('active'));
        pages[pageName].classList.add('active');
        window.currentActivePage = pageName;
        // ページ変更イベントを発火（他のモジュールで使用可能）
        window.dispatchEvent(new CustomEvent('pageChanged', { detail: { page: pageName } }));
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
        if (window.initBtController) {
            window.initBtController();
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

