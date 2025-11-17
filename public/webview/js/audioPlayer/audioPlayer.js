// 音声プレーヤー機能モジュール
(function() {
    'use strict';
    
    // DOM要素
    const audioFileList = document.getElementById('audioFileList');
    const audioElement = document.getElementById('audioElement');
    const audioPlayer = document.getElementById('audioPlayer');
    const currentTimeEl = document.getElementById('currentTime');
    const subtitleDisplay = document.getElementById('subtitleDisplay');
    const audioStatusEl = document.getElementById('audioStatus');
    const directoryBtn = document.getElementById('directoryBtn');
    const monthFilter = document.getElementById('monthFilter');
    const speakerFilter = document.getElementById('speakerFilter');
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const skipForwardBtn = document.getElementById('skipForwardBtn');
    const skipBackwardBtn = document.getElementById('skipBackwardBtn');
    const nextSubtitleBtn = document.getElementById('nextSubtitleBtn');
    const prevSubtitleBtn = document.getElementById('prevSubtitleBtn');
    const repeatSubtitleBtn = document.getElementById('repeatSubtitleBtn');
    const speedBtn = document.getElementById('speedBtn');
    const audioDirectoryScreen = document.getElementById('audioDirectoryScreen');
    const audioFileListScreen = document.getElementById('audioFileListScreen');
    const backToDirectoryBtn = document.getElementById('backToDirectoryBtn');
    
    // デバッグ: ボタンの存在確認
    console.log('[DEBUG] speedBtn exists:', !!speedBtn);
    console.log('[DEBUG] repeatSubtitleBtn exists:', !!repeatSubtitleBtn);
    
    // HTML5 Audio の設定
    if (audioElement) {
        // ピッチ変更を無効にして速度変更のみ
        audioElement.preservesPitch = true;
        audioElement.mozPreservesPitch = true; // Firefox用
        audioElement.webkitPreservesPitch = true; // Safari/Chrome用
        console.log('[DEBUG] Audio element preservesPitch:', audioElement.preservesPitch);
    }
    
    // 状態管理
    let selectedAudioFile = null;
    let subtitles = [];
    let currentSubtitleIndex = -1;
    let subtitleUpdateInterval = null;
    let audioEventListenersAttached = false;
    let currentDirectory = 'kamiwaza';
    let allAudioFiles = [];
    let availableMonths = [];
    let availableSpeakers = [];
    let isRepeatMode = false;
    let currentSpeed = 1.0;
    let commandPollingInterval = null;
    let currentAudioId = null;
    
    // 音声プレーヤーの画面遷移
    function showAudioDirectoryScreen() {
        audioDirectoryScreen.classList.remove('hidden');
        audioFileListScreen.classList.remove('active');
    }
    
    function showAudioFileListScreen() {
        audioDirectoryScreen.classList.add('hidden');
        audioFileListScreen.classList.add('active');
    }
    
    // ディレクトリ選択ボタン
    directoryBtn.addEventListener('click', async () => {
        showAudioFileListScreen();
        loadAudioFiles();
    });
    
    // ディレクトリに戻るボタン
    backToDirectoryBtn.addEventListener('click', () => {
        showAudioDirectoryScreen();
        audioPlayer.classList.remove('active');
        stopCommandPolling();
    });
    
    // ページ変更イベントをリッスン（Bluetoothイベント対応）
    window.addEventListener('pageChanged', (event) => {
        if (event.detail.page === 'audioPlayer') {
            // 音声プレーヤー画面に入ったら、音声ファイルが選択されている場合はポーリングを開始
            if (currentAudioId && audioPlayer.classList.contains('active')) {
                startCommandPolling();
            }
        } else {
            // 他の画面に移動したら、ポーリングを停止
            stopCommandPolling();
        }
    });
    
    // フィルタ変更時の処理
    monthFilter.addEventListener('change', () => {
        filterAndDisplayFiles();
    });
    
    speakerFilter.addEventListener('change', () => {
        filterAndDisplayFiles();
    });
    
    // ファイルをフィルタリングして表示
    function filterAndDisplayFiles() {
        const selectedMonth = monthFilter.value;
        const selectedSpeaker = speakerFilter.value;
        
        let filtered = allAudioFiles;
        
        if (selectedMonth) {
            filtered = filtered.filter(f => f.month === selectedMonth);
        }
        
        if (selectedSpeaker) {
            filtered = filtered.filter(f => f.speaker === selectedSpeaker);
        }
        
        displayAudioFiles(filtered);
    }
    
    // ファイルをグループ化して表示
    function displayAudioFiles(files) {
        audioFileList.innerHTML = '';
        
        if (files.length === 0) {
            audioFileList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">該当するファイルが見つかりません</div>';
            return;
        }
        
        // 日付ごとにグループ化
        const groupedByDate = {};
        
        files.forEach(file => {
            if (!groupedByDate[file.date]) {
                groupedByDate[file.date] = [];
            }
            groupedByDate[file.date].push(file);
        });
        
        // 日付でソート（降順）
        const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a));
        
        sortedDates.forEach(date => {
            const dateGroup = document.createElement('div');
            dateGroup.className = 'audio-file-group';
            
            const header = document.createElement('div');
            header.className = 'audio-file-group-header';
            header.textContent = `${date} (${groupedByDate[date].length}件)`;
            dateGroup.appendChild(header);
            
            // 同じ日付内で時刻順にソート（昼→夜）
            const timeOrder = { '昼': 0, '夜': 1 };
            groupedByDate[date].sort((a, b) => {
                const aOrder = timeOrder[a.timeOfDay] !== undefined ? timeOrder[a.timeOfDay] : 2;
                const bOrder = timeOrder[b.timeOfDay] !== undefined ? timeOrder[b.timeOfDay] : 2;
                return aOrder - bOrder;
            });
            
            groupedByDate[date].forEach(file => {
                const item = document.createElement('div');
                item.className = 'audio-file-item';
                
                const title = document.createElement('div');
                title.className = 'audio-file-item-title';
                title.textContent = file.title || file.name;
                item.appendChild(title);
                
                const meta = document.createElement('div');
                meta.className = 'audio-file-item-meta';
                
                if (file.timeOfDay) {
                    const timeBadge = document.createElement('span');
                    timeBadge.textContent = `🕐 ${file.timeOfDay}`;
                    meta.appendChild(timeBadge);
                }
                
                if (file.level) {
                    const levelBadge = document.createElement('span');
                    levelBadge.className = 'audio-file-item-badge badge-level';
                    levelBadge.textContent = file.level;
                    meta.appendChild(levelBadge);
                }
                
                const speakerBadge = document.createElement('span');
                speakerBadge.className = `audio-file-item-badge badge-${file.speaker}`;
                speakerBadge.textContent = file.speaker === 'luna' ? 'Luna' : 'Professor';
                meta.appendChild(speakerBadge);
                
                item.appendChild(meta);
                
                item.addEventListener('click', () => selectAudioFile(file, item));
                
                dateGroup.appendChild(item);
            });
            
            audioFileList.appendChild(dateGroup);
        });
    }
    
    async function loadAudioFiles() {
        try {
            audioFileList.innerHTML = '<div style="text-align: center; color: #666; padding: 20px;">ファイルを読み込み中...</div>';
            
            const params = new URLSearchParams({
                directory: currentDirectory
            });
            
            const data = await apiCall(`/api/audio/files?${params}`);
            
            allAudioFiles = data.files || [];
            availableMonths = data.months || [];
            availableSpeakers = data.speakers || [];
            
            // 月フィルタのオプションを更新
            monthFilter.innerHTML = '<option value="">全ての月</option>';
            availableMonths.forEach(month => {
                const option = document.createElement('option');
                option.value = month;
                option.textContent = `${month.substring(0, 4)}年${parseInt(month.substring(5))}月`;
                monthFilter.appendChild(option);
            });
            
            // ファイルを表示
            filterAndDisplayFiles();
        } catch (error) {
            audioFileList.innerHTML = `<div style="text-align: center; color: #f00; padding: 20px;">エラー: ${error.message}</div>`;
            console.error('Audio files load error:', error);
        }
    }
    
    async function loadAudioSettings() {
        try {
            const data = await apiCall('/api/audio/settings');
            console.log('[DEBUG] Settings loaded:', data);
            if (data.success) {
                isRepeatMode = data.repeat;
                currentSpeed = data.speed;
                
                // UI更新
                if (repeatSubtitleBtn) {
                    if (isRepeatMode) {
                        repeatSubtitleBtn.classList.add('active');
                        repeatSubtitleBtn.textContent = '🔁 リピートON';
                    } else {
                        repeatSubtitleBtn.classList.remove('active');
                        repeatSubtitleBtn.textContent = '🔁 リピート';
                    }
                }
                
                console.log('[DEBUG] loadAudioSettings: setting playbackRate to', currentSpeed);
                console.log('[DEBUG] loadAudioSettings: audio readyState', audioElement.readyState);
                audioElement.playbackRate = currentSpeed;
                console.log('[DEBUG] loadAudioSettings: actual playbackRate', audioElement.playbackRate);
                
                if (speedBtn) {
                    speedBtn.textContent = `⚡ ${currentSpeed}x`;
                }
            }
        } catch (error) {
            console.error('Settings load error:', error);
        }
    }
    
    async function selectAudioFile(file, itemElement) {
        // 選択状態を更新
        document.querySelectorAll('.audio-file-item').forEach(item => {
            item.classList.remove('selected');
        });
        itemElement.classList.add('selected');
        
        selectedAudioFile = file;
        currentAudioId = file.id;
        
        // 音声ファイルを読み込み
        audioElement.src = `${getApiBaseUrl()}/api/audio/stream/${file.id}`;
        
        // 字幕を読み込み
        try {
            const data = await apiCall(`/api/audio/subtitles/${file.id}`);
            
            if (data.success && data.subtitles) {
                subtitles = data.subtitles;
                currentSubtitleIndex = -1;
                subtitleDisplay.textContent = '字幕が読み込まれました';
                audioPlayer.classList.add('active');
                
                // 設定を読み込み
                loadAudioSettings();
                
                // コマンドポーリングを開始（Bluetoothイベント対応）
                startCommandPolling();
            } else {
                throw new Error('字幕データの取得に失敗しました');
            }
        } catch (error) {
            showError(audioStatusEl, `字幕読み込みエラー: ${error.message}`);
            console.error('Subtitle load error:', error);
        }
        
        // 再生位置更新と字幕同期（イベントリスナーは一度だけ登録）
        if (!audioEventListenersAttached) {
            audioElement.addEventListener('loadedmetadata', () => {
                updateCurrentTime();
                // メタデータ読み込み後に再生速度を再適用
                console.log('[DEBUG] loadedmetadata: applying playbackRate', currentSpeed);
                audioElement.playbackRate = currentSpeed;
                console.log('[DEBUG] loadedmetadata: actual playbackRate', audioElement.playbackRate);
            });
            
            audioElement.addEventListener('loadeddata', () => {
                // データ読み込み後も再度適用
                console.log('[DEBUG] loadeddata: applying playbackRate', currentSpeed);
                audioElement.playbackRate = currentSpeed;
                console.log('[DEBUG] loadeddata: actual playbackRate', audioElement.playbackRate);
            });
            
            audioElement.addEventListener('canplay', () => {
                // 再生可能になったタイミングでも適用
                console.log('[DEBUG] canplay: applying playbackRate', currentSpeed);
                audioElement.playbackRate = currentSpeed;
                console.log('[DEBUG] canplay: actual playbackRate', audioElement.playbackRate);
            });
            
            audioElement.addEventListener('timeupdate', () => {
                updateCurrentTime();
                updateSubtitleDisplay();
            });
            
            audioElement.addEventListener('play', () => {
                startSubtitleSync();
                // 再生開始時にも適用
                console.log('[DEBUG] play: applying playbackRate', currentSpeed);
                audioElement.playbackRate = currentSpeed;
            });
            
            audioElement.addEventListener('pause', () => {
                stopSubtitleSync();
            });
            
            audioElement.addEventListener('ended', () => {
                stopSubtitleSync();
            });
            
            audioEventListenersAttached = true;
        }
    }
    
    function updateCurrentTime() {
        const current = audioElement.currentTime;
        const duration = audioElement.duration;
        
        if (isNaN(duration)) return;
        
        const formatTime = (seconds) => {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        };
        
        currentTimeEl.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    }
    
    function updateSubtitleDisplay() {
        if (subtitles.length === 0) return;
        
        const currentTime = audioElement.currentTime;
        
        // 現在時刻に該当する字幕を検索
        let foundIndex = -1;
        for (let i = 0; i < subtitles.length; i++) {
            const subtitle = subtitles[i];
            if (currentTime >= subtitle.startTime && currentTime <= subtitle.endTime) {
                foundIndex = i;
                break;
            }
        }
        
        if (foundIndex !== currentSubtitleIndex) {
            // 字幕が変わった
            const previousIndex = currentSubtitleIndex;
            currentSubtitleIndex = foundIndex;
            
            if (foundIndex >= 0) {
                subtitleDisplay.textContent = subtitles[foundIndex].text;
                updateSubtitleOnServer(subtitles[foundIndex].text);
            } else {
                subtitleDisplay.textContent = '';
                
                // 字幕が終了した場合、リピートモードなら字幕の頭に戻る（クライアント側で直接制御）
                if (isRepeatMode && previousIndex >= 0 && previousIndex < subtitles.length) {
                    const prevSubtitle = subtitles[previousIndex];
                    if (currentTime > prevSubtitle.endTime) {
                        console.log('[DEBUG] ========================================');
                        console.log('[DEBUG] Subtitle ended in REPEAT mode');
                        console.log('[DEBUG] Seeking back to subtitle', previousIndex, 'at', prevSubtitle.startTime, 's');
                        console.log('[DEBUG] ========================================');
                        
                        // 直接字幕の頭に戻る
                        audioElement.currentTime = prevSubtitle.startTime;
                        currentSubtitleIndex = previousIndex;
                        subtitleDisplay.textContent = prevSubtitle.text;
                        updateSubtitleOnServer(prevSubtitle.text);
                    }
                }
            }
        }
    }
    
    function startSubtitleSync() {
        if (subtitleUpdateInterval) return;
        subtitleUpdateInterval = setInterval(() => {
            updateSubtitleDisplay();
        }, 100);
    }
    
    function stopSubtitleSync() {
        if (subtitleUpdateInterval) {
            clearInterval(subtitleUpdateInterval);
            subtitleUpdateInterval = null;
        }
    }
    
    async function updateSubtitleOnServer(text) {
        try {
            await apiCall('/api/audio/state', {
                method: 'POST',
                body: JSON.stringify({
                    currentTime: audioElement.currentTime,
                    subtitleText: text,
                    subtitleIndex: currentSubtitleIndex
                })
            });
        } catch (error) {
            console.error('Subtitle update error:', error);
        }
    }
    
    // サーバーからの命令をポーリング
    function startCommandPolling() {
        console.log('[DEBUG] ========================================');
        console.log('[DEBUG] Starting command polling');
        console.log('[DEBUG] ========================================');
        
        // 既存のポーリングを停止
        if (commandPollingInterval) {
            clearInterval(commandPollingInterval);
        }
        
        commandPollingInterval = setInterval(async () => {
            try {
                // 音声プレーヤー画面にいる場合のみポーリング
                if (window.currentActivePage !== 'audioPlayer') {
                    return;
                }
                
                const data = await apiCall('/api/audio/commands');
                
                if (data.success && data.commands && data.commands.length > 0) {
                    console.log('[DEBUG] ****************************************');
                    console.log('[DEBUG] Received commands:', data.commands);
                    console.log('[DEBUG] ****************************************');
                    
                    data.commands.forEach(cmd => {
                        if (cmd.type === 'seek') {
                            console.log('[DEBUG] Executing seek to:', cmd.value);
                            audioElement.currentTime = cmd.value;
                        } else if (cmd.type === 'speed') {
                            console.log('[DEBUG] ****************************************');
                            console.log('[DEBUG] Executing speed change to:', cmd.value);
                            console.log('[DEBUG] Before: audioElement.playbackRate =', audioElement.playbackRate);
                            currentSpeed = cmd.value;
                            audioElement.playbackRate = cmd.value;
                            console.log('[DEBUG] After: audioElement.playbackRate =', audioElement.playbackRate);
                            console.log('[DEBUG] ****************************************');
                            if (speedBtn) {
                                speedBtn.textContent = `⚡ ${cmd.value}x`;
                            }
                        } else if (cmd.type === 'play') {
                            console.log('[DEBUG] Executing play');
                            audioElement.play().catch(error => {
                                console.error('[ERROR] Play error:', error);
                            });
                        } else if (cmd.type === 'pause') {
                            console.log('[DEBUG] Executing pause');
                            audioElement.pause();
                        } else if (cmd.type === 'next') {
                            console.log('[DEBUG] Executing next track');
                            // 次のトラックを再生（実装が必要）
                            // TODO: 現在のファイルリストから次のファイルを取得して再生
                        } else if (cmd.type === 'prev') {
                            console.log('[DEBUG] Executing previous track');
                            // 前のトラックを再生（実装が必要）
                            // TODO: 現在のファイルリストから前のファイルを取得して再生
                           } else if (cmd.type === 'next_subtitle' || cmd.type === 'prev_subtitle') {
                               // next_subtitleとprev_subtitleはサーバー側で処理されるため、
                               // WebView側では何もしない（サーバー側で字幕がARグラスに表示される）
                               console.log(`[DEBUG] ${cmd.type}はサーバー側で処理されます（スキップ）`);
                           } else if (cmd.type === 'repeat') {
                            console.log('[DEBUG] Executing repeat toggle');
                            if (repeatSubtitleBtn) {
                                repeatSubtitleBtn.click();
                            }
                        } else if (cmd.type === 'speed' && cmd.value) {
                            console.log('[DEBUG] Executing speed change to:', cmd.value);
                            // speedコマンドは既に処理されているが、念のため
                            currentSpeed = cmd.value;
                            audioElement.playbackRate = cmd.value;
                            if (speedBtn) {
                                speedBtn.textContent = `⚡ ${cmd.value}x`;
                            }
                        }
                    });
                }
            } catch (error) {
                console.error('[ERROR] Command polling error:', error);
                console.error('[ERROR] Error details:', error.message, error.stack);
            }
        }, 500); // 500msごとにポーリング
    }
    
    function stopCommandPolling() {
        if (commandPollingInterval) {
            clearInterval(commandPollingInterval);
            commandPollingInterval = null;
        }
    }
    
    // 字幕終了を検知してサーバーに通知
    async function notifySubtitleEnd(subtitleIndex) {
        try {
            await apiCall('/api/audio/subtitle-end', {
                method: 'POST',
                body: JSON.stringify({
                    audioId: currentAudioId,
                    subtitleIndex: subtitleIndex
                })
            });
        } catch (error) {
            console.error('Subtitle end notification error:', error);
        }
    }
    
    // 字幕に移動する共通関数
    function gotoSubtitle(index) {
        if (index < 0 || index >= subtitles.length) return;
        
        const subtitle = subtitles[index];
        audioElement.currentTime = subtitle.startTime;
        currentSubtitleIndex = index;
        subtitleDisplay.textContent = subtitle.text;
        updateSubtitleOnServer(subtitle.text);
    }
    
    // コントロールボタンイベント
    playBtn.addEventListener('click', () => {
        audioElement.play();
    });
    
    pauseBtn.addEventListener('click', () => {
        audioElement.pause();
    });
    
    skipForwardBtn.addEventListener('click', () => {
        audioElement.currentTime = Math.min(audioElement.currentTime + 10, audioElement.duration);
    });
    
    skipBackwardBtn.addEventListener('click', () => {
        audioElement.currentTime = Math.max(audioElement.currentTime - 10, 0);
    });
    
    nextSubtitleBtn.addEventListener('click', () => {
        if (subtitles.length === 0) return;
        const nextIndex = Math.min(currentSubtitleIndex + 1, subtitles.length - 1);
        gotoSubtitle(nextIndex);
    });
    
    prevSubtitleBtn.addEventListener('click', () => {
        if (subtitles.length === 0) return;
        const prevIndex = Math.max(currentSubtitleIndex - 1, 0);
        gotoSubtitle(prevIndex);
    });
    
    if (repeatSubtitleBtn) {
        repeatSubtitleBtn.addEventListener('click', async () => {
            console.log('[DEBUG] ========================================');
            console.log('[DEBUG] Repeat button clicked');
            console.log('[DEBUG] Current repeat mode:', isRepeatMode);
            console.log('[DEBUG] Current subtitle index:', currentSubtitleIndex);
            
            try {
                const data = await apiCall('/api/audio/repeat', {
                    method: 'POST',
                    body: JSON.stringify({
                        audioId: currentAudioId
                    })
                });
                console.log('[DEBUG] Repeat response:', data);
                
                if (data.success) {
                    isRepeatMode = data.repeat;
                    console.log('[DEBUG] New repeat mode:', isRepeatMode);
                    
                    if (isRepeatMode) {
                        repeatSubtitleBtn.classList.add('active');
                        repeatSubtitleBtn.textContent = '🔁 リピートON';
                        console.log('[SUCCESS] Repeat mode ENABLED - Current subtitle will loop');
                    } else {
                        repeatSubtitleBtn.classList.remove('active');
                        repeatSubtitleBtn.textContent = '🔁 リピート';
                        console.log('[SUCCESS] Repeat mode DISABLED - Normal playback');
                    }
                }
                console.log('[DEBUG] ========================================');
            } catch (error) {
                console.error('[ERROR] Repeat toggle error:', error);
            }
        });
    } else {
        console.error('[ERROR] repeatSubtitleBtn not found!');
    }
    
    if (speedBtn) {
        speedBtn.addEventListener('click', async () => {
            console.log('[DEBUG] ========================================');
            console.log('[DEBUG] Speed button clicked');
            console.log('[DEBUG] Current playbackRate before:', audioElement.playbackRate);
            console.log('[DEBUG] Current speed variable:', currentSpeed);
            console.log('[DEBUG] Audio element ready state:', audioElement.readyState);
            console.log('[DEBUG] Audio element paused:', audioElement.paused);
            console.log('[DEBUG] Audio element duration:', audioElement.duration);
            console.log('[DEBUG] Audio element src:', audioElement.src);
            
            try {
                const data = await apiCall('/api/audio/speed', { method: 'POST' });
                console.log('[DEBUG] Speed response:', data);
                
                if (data.success) {
                    const oldSpeed = currentSpeed;
                    currentSpeed = data.speed;
                    console.log('[DEBUG] Speed change:', oldSpeed, '→', currentSpeed);
                    console.log('[DEBUG] Setting playbackRate to:', currentSpeed);
                    
                    // 直接設定
                    audioElement.playbackRate = currentSpeed;
                    console.log('[DEBUG] Immediately after setting:', audioElement.playbackRate);
                    
                    // 複数回確認
                    setTimeout(() => {
                        console.log('[DEBUG] After 50ms:', audioElement.playbackRate);
                        audioElement.playbackRate = currentSpeed; // 再設定
                    }, 50);
                    
                    setTimeout(() => {
                        console.log('[DEBUG] After 200ms:', audioElement.playbackRate);
                        audioElement.playbackRate = currentSpeed; // 再設定
                    }, 200);
                    
                    setTimeout(() => {
                        console.log('[DEBUG] After 500ms:', audioElement.playbackRate);
                        console.log('[DEBUG] Audio still playing?:', !audioElement.paused);
                        console.log('[DEBUG] Current time:', audioElement.currentTime);
                    }, 500);
                    
                    speedBtn.textContent = `⚡ ${currentSpeed}x`;
                    speedBtn.classList.add('active');
                    
                    // UI上でも確認できるように
                    showSuccess(audioStatusEl, `再生速度: ${currentSpeed}x に変更しました`);
                    console.log('[DEBUG] ========================================');
                }
            } catch (error) {
                console.error('[ERROR] Speed change error:', error);
                showError(audioStatusEl, `速度変更エラー: ${error.message}`);
            }
        });
    } else {
        console.error('[ERROR] speedBtn not found!');
    }
    
    // グローバルに公開する関数
    window.showAudioDirectoryScreen = showAudioDirectoryScreen;
})();

