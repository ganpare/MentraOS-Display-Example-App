// メイン初期化スクリプト
(function() {
    'use strict';
    
    // ページ管理
    const pages = {
        top: document.getElementById('topPage'),
        textReader: document.getElementById('textReaderPage'),
        audioPlayer: document.getElementById('audioPlayerPage')
    };
    
    function showPage(pageName) {
        Object.values(pages).forEach(page => page.classList.remove('active'));
        pages[pageName].classList.add('active');
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
})();

