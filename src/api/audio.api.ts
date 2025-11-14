// 音声プレーヤーAPIエンドポイント
import { AppSession, ViewType } from '@mentra/sdk';
import { Express } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { SRTParser, SubtitleEntry } from '../services/audio/SRTParser';
import { AudioFileNameParser } from '../services/audio/AudioFileNameParser';
import { debugLog, debugError } from '../utils/debug';
import { AUDIO_SOURCE_DIR } from '../utils/config';

export interface AudioAPIDependencies {
  sessions: Map<string, AppSession>;
  userIdToSessionId: Map<string, string>;
  subtitleCache: Map<string, SubtitleEntry[]>;
  getAppSessionForUser: (userId: string) => AppSession | null;
  // 音声プレーヤー制御用（オプション、外部から渡す場合）
  sessionCommandQueues?: Map<string, Array<{ type: 'seek' | 'speed' | 'play' | 'pause' | 'next' | 'prev'; value?: number; timestamp: number }>>;
  sessionPlaybackStates?: Map<string, { currentSubtitleIndex: number; currentTime: number; lastUpdateTime: number }>;
}

// セッションごとの音声プレーヤー状態（内部で作成する場合のフォールバック）
const sessionRepeatStates = new Map<string, boolean>();
const sessionSpeedStates = new Map<string, number>();

// セッションごとの再生状態管理
interface PlaybackState {
  currentSubtitleIndex: number;
  currentTime: number;
  lastUpdateTime: number;
}

// 内部で作成する場合のフォールバックMap（外部から渡されない場合）
let internalSessionPlaybackStates = new Map<string, PlaybackState>();
let internalSessionCommandQueues = new Map<string, ControlCommand[]>();

// セッションごとの制御命令キュー
interface ControlCommand {
  type: 'seek' | 'speed' | 'play' | 'pause' | 'next' | 'prev' | 'next_subtitle' | 'prev_subtitle' | 'repeat';
  value?: number;
  timestamp: number;
}

export function setupAudioAPI(
  app: Express,
  deps: AudioAPIDependencies,
  createAuthMiddlewareForPath: (path: string) => any
): void {
  app.use('/api/audio', createAuthMiddlewareForPath('/api/audio'));

  // 外部から渡されたMapを使用、なければ内部Mapを使用
  const sessionPlaybackStates = deps.sessionPlaybackStates || internalSessionPlaybackStates;
  const sessionCommandQueues = deps.sessionCommandQueues || internalSessionCommandQueues;

  // ディレクトリ一覧を取得
  app.get('/api/audio/directories', (req: any, res: any) => {
    try {
      const directories: Array<{ id: string; name: string; path: string }> = [];
      
      if (AUDIO_SOURCE_DIR && fs.existsSync(AUDIO_SOURCE_DIR)) {
        directories.push({
          id: 'kamiwaza',
          name: '神威ディレクトリ',
          path: AUDIO_SOURCE_DIR
        });
      }

      debugLog(`ディレクトリ一覧取得: ${directories.length}件`);
      res.json({ success: true, directories });
    } catch (error: any) {
      debugError('ディレクトリ一覧取得エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 音声ファイル一覧を取得
  app.get('/api/audio/files', (req: any, res: any) => {
    try {
      const directoryId = req.query.directory || 'kamiwaza';
      const monthFilter = req.query.month;
      const speakerFilter = req.query.speaker;

      if (!AUDIO_SOURCE_DIR || !fs.existsSync(AUDIO_SOURCE_DIR)) {
        debugLog('AUDIO_SOURCE_DIRが設定されていません、またはディレクトリが存在しません');
        return res.json({ success: true, files: [], months: [], speakers: [] });
      }

      const files = fs.readdirSync(AUDIO_SOURCE_DIR);
      const parsedFiles: Array<{
        id: string;
        name: string;
        date: string;
        timeOfDay: string;
        level: string;
        title: string;
        speaker: 'luna' | 'professor';
        month: string;
      }> = [];
      const monthSet = new Set<string>();
      const speakerSet = new Set<string>();

      for (const file of files) {
        if (file.toLowerCase().endsWith('.wav')) {
          const baseName = path.basename(file, '.wav');
          const srtPath = path.join(AUDIO_SOURCE_DIR, `${baseName}.srt`);
          
          if (fs.existsSync(srtPath)) {
            const parsed = AudioFileNameParser.parse(file);
            
            if (parsed) {
              const month = AudioFileNameParser.getMonth(parsed.date);
              monthSet.add(month);
              speakerSet.add(parsed.speaker);

              parsedFiles.push({
                id: baseName,
                name: file,
                date: parsed.date,
                timeOfDay: parsed.timeOfDay,
                level: parsed.level,
                title: parsed.title,
                speaker: parsed.speaker,
                month: month
              });
            }
          }
        }
      }

      let filteredFiles = parsedFiles;
      
      if (monthFilter) {
        filteredFiles = filteredFiles.filter(f => f.month === monthFilter);
      }
      
      if (speakerFilter) {
        filteredFiles = filteredFiles.filter(f => f.speaker === speakerFilter);
      }

      filteredFiles.sort((a, b) => {
        if (a.date !== b.date) {
          return b.date.localeCompare(a.date);
        }
        const timeOrder = { '昼': 0, '夜': 1 };
        return (timeOrder[a.timeOfDay as keyof typeof timeOrder] || 2) - 
               (timeOrder[b.timeOfDay as keyof typeof timeOrder] || 2);
      });

      const months = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
      const speakers = Array.from(speakerSet).sort();

      debugLog(`音声ファイル一覧取得: 全${parsedFiles.length}件、フィルタ後${filteredFiles.length}件`);
      res.json({ 
        success: true, 
        files: filteredFiles,
        months: months,
        speakers: speakers
      });
    } catch (error: any) {
      debugError('音声ファイル一覧取得エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // HTTP Range対応の音声ストリーミング
  app.get('/api/audio/stream/:id', (req: any, res: any) => {
    try {
      if (!AUDIO_SOURCE_DIR) {
        return res.status(404).json({ success: false, error: 'AUDIO_SOURCE_DIRが設定されていません' });
      }

      const audioId = req.params.id;
      const audioPath = path.join(AUDIO_SOURCE_DIR, `${audioId}.wav`);

      if (!fs.existsSync(audioPath)) {
        return res.status(404).json({ success: false, error: '音声ファイルが見つかりません' });
      }

      const stat = fs.statSync(audioPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(audioPath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'audio/wav',
        };

        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': 'audio/wav',
        };
        res.writeHead(200, head);
        fs.createReadStream(audioPath).pipe(res);
      }
    } catch (error: any) {
      console.error('[エラー] 音声ストリーミングエラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 字幕データを取得
  app.get('/api/audio/subtitles/:id', (req: any, res: any) => {
    try {
      if (!AUDIO_SOURCE_DIR) {
        return res.status(404).json({ success: false, error: 'AUDIO_SOURCE_DIRが設定されていません' });
      }

      const audioId = req.params.id;
      const srtPath = path.join(AUDIO_SOURCE_DIR, `${audioId}.srt`);

      if (!fs.existsSync(srtPath)) {
        return res.status(404).json({ success: false, error: '字幕ファイルが見つかりません' });
      }

      if (deps.subtitleCache.has(audioId)) {
        const subtitles = deps.subtitleCache.get(audioId)!;
        debugLog(`字幕データ取得（キャッシュ）: ${audioId}, ${subtitles.length}件`);
        return res.json({ success: true, subtitles });
      }

      const srtContent = fs.readFileSync(srtPath, 'utf-8');
      const subtitles = SRTParser.parse(srtContent);
      
      deps.subtitleCache.set(audioId, subtitles);
      
      debugLog(`字幕データ取得: ${audioId}, ${subtitles.length}件`);
      
      // セッションIDを取得して再生状態を初期化
      const userId = (req as any).authUserId;
      if (userId) {
        const sessionId = deps.userIdToSessionId.get(userId);
        if (sessionId) {
          sessionPlaybackStates.set(sessionId, {
            currentSubtitleIndex: -1,
            currentTime: 0,
            lastUpdateTime: Date.now()
          });
          
          // 命令キューを初期化
          if (!sessionCommandQueues.has(sessionId)) {
            sessionCommandQueues.set(sessionId, []);
          }
        }
      }
      
      res.json({ success: true, subtitles });
    } catch (error: any) {
      console.error('[エラー] 字幕データ取得エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 音声再生状態を更新（ARグラスに字幕を表示）
  app.post('/api/audio/state', async (req: any, res: any) => {
    try {
      const userId = (req as any).authUserId;
      
      if (!userId) {
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      const sessionId = deps.userIdToSessionId.get(userId);
      if (!sessionId) {
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      const session = deps.sessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      const { subtitleText, currentTime, subtitleIndex } = req.body;

      // 再生状態を更新
      if (typeof currentTime === 'number' && typeof subtitleIndex === 'number') {
        const playbackState = sessionPlaybackStates.get(sessionId);
        if (playbackState) {
          playbackState.currentTime = currentTime;
          playbackState.currentSubtitleIndex = subtitleIndex;
          playbackState.lastUpdateTime = Date.now();
        }
      }

      if (subtitleText && subtitleText.trim()) {
        const cleanText = subtitleText.trim();
        session.layouts.showTextWall(cleanText, {
          view: ViewType.MAIN
        });
        debugLog(`字幕をARグラスに表示: ${cleanText.substring(0, 50)}...`);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('[エラー] 音声状態更新エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // リピート状態を切り替え
  app.post('/api/audio/repeat', async (req: any, res: any) => {
    try {
      debugLog('[DEBUG] /api/audio/repeat called');
      const userId = (req as any).authUserId;
      if (!userId) {
        debugError('[DEBUG] No userId found');
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      const sessionId = deps.userIdToSessionId.get(userId);
      if (!sessionId) {
        debugError('[DEBUG] No sessionId found for userId:', userId);
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      const currentState = sessionRepeatStates.get(sessionId) || false;
      const newState = !currentState;
      sessionRepeatStates.set(sessionId, newState);
      
      // リピートONの場合、現在の字幕の頭に戻る命令を送る
      if (newState) {
        const playbackState = sessionPlaybackStates.get(sessionId);
        if (playbackState && playbackState.currentSubtitleIndex >= 0) {
          const audioId = (req.body as any).audioId;
          if (audioId && deps.subtitleCache.has(audioId)) {
            const subtitles = deps.subtitleCache.get(audioId)!;
            const currentSubtitle = subtitles[playbackState.currentSubtitleIndex];
            if (currentSubtitle) {
              // 命令キューに追加
              const commandQueue = sessionCommandQueues.get(sessionId) || [];
              commandQueue.push({
                type: 'seek',
                value: currentSubtitle.startTime,
                timestamp: Date.now()
              });
              sessionCommandQueues.set(sessionId, commandQueue);
              debugLog(`リピートON: 字幕インデックス ${playbackState.currentSubtitleIndex} の頭 (${currentSubtitle.startTime}s) に戻る命令を送信`);
            }
          }
        }
      }

      debugLog(`リピート状態切り替え: ${newState ? 'ON' : 'OFF'} (sessionId: ${sessionId})`);
      res.json({ success: true, repeat: newState });
    } catch (error: any) {
      debugError('リピート状態切り替えエラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 再生速度を変更
  app.post('/api/audio/speed', async (req: any, res: any) => {
    try {
      debugLog('[DEBUG] ========================================');
      debugLog('[DEBUG] /api/audio/speed called');
      const userId = (req as any).authUserId;
      debugLog(`[DEBUG] userId: ${userId}`);
      
      if (!userId) {
        debugError('[DEBUG] No userId found');
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      const sessionId = deps.userIdToSessionId.get(userId);
      debugLog(`[DEBUG] sessionId: ${sessionId}`);
      
      if (!sessionId) {
        debugError('[DEBUG] No sessionId found for userId:', userId);
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      const speeds = [1.0, 1.25, 1.5, 1.75, 2.0];
      const currentSpeed = sessionSpeedStates.get(sessionId) || 1.0;
      const currentIndex = speeds.indexOf(currentSpeed);
      const nextIndex = (currentIndex + 1) % speeds.length;
      const newSpeed = speeds[nextIndex];

      sessionSpeedStates.set(sessionId, newSpeed);
      
      // 速度変更命令を送る
      const commandQueue = sessionCommandQueues.get(sessionId) || [];
      commandQueue.push({
        type: 'speed',
        value: newSpeed,
        timestamp: Date.now()
      });
      sessionCommandQueues.set(sessionId, commandQueue);

      debugLog(`[SUCCESS] 再生速度変更: ${currentSpeed}x → ${newSpeed}x`);
      debugLog(`[SUCCESS] Command queued for sessionId: ${sessionId}`);
      debugLog('[DEBUG] ========================================');
      
      res.json({ success: true, speed: newSpeed });
    } catch (error: any) {
      debugError('[ERROR] 再生速度変更エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 現在の状態を取得
  app.get('/api/audio/settings', async (req: any, res: any) => {
    try {
      const userId = (req as any).authUserId;
      if (!userId) {
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      const sessionId = deps.userIdToSessionId.get(userId);
      if (!sessionId) {
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      const repeat = sessionRepeatStates.get(sessionId) || false;
      const speed = sessionSpeedStates.get(sessionId) || 1.0;

      res.json({ success: true, repeat, speed });
    } catch (error: any) {
      debugError('設定取得エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 制御命令を取得（ポーリング用）
  app.get('/api/audio/commands', async (req: any, res: any) => {
    try {
      console.log('[DEBUG] /api/audio/commands called');
      console.log('[DEBUG] Headers:', JSON.stringify(req.headers, null, 2));
      console.log('[DEBUG] Cookies:', JSON.stringify(req.cookies, null, 2));
      console.log('[DEBUG] authUserId:', (req as any).authUserId);
      
      const userId = (req as any).authUserId;
      if (!userId) {
        debugLog('[DEBUG] /api/audio/commands - No userId');
        console.log('[DEBUG] Full req object keys:', Object.keys(req));
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      const sessionId = deps.userIdToSessionId.get(userId);
      if (!sessionId) {
        debugLog('[DEBUG] /api/audio/commands - No sessionId for userId:', userId);
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }

      const commandQueue = sessionCommandQueues.get(sessionId) || [];
      
      // 古い命令（5秒以上前）を削除
      const now = Date.now();
      const validCommands = commandQueue.filter(cmd => (now - cmd.timestamp) < 5000);
      
      if (validCommands.length > 0) {
        debugLog('[DEBUG] ****************************************');
        debugLog(`[DEBUG] /api/audio/commands - Sending ${validCommands.length} command(s) to client`);
        debugLog('[DEBUG] Commands:', JSON.stringify(validCommands, null, 2));
        debugLog('[DEBUG] ****************************************');
      }
      
      // キューをクリア
      sessionCommandQueues.set(sessionId, []);
      
      res.json({ success: true, commands: validCommands });
    } catch (error: any) {
      debugError('[ERROR] /api/audio/commands error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 字幕終了検知（クライアントから通知を受ける）
  app.post('/api/audio/subtitle-end', async (req: any, res: any) => {
    try {
      const userId = (req as any).authUserId;
      if (!userId) {
        return res.status(401).json({ success: false, error: '認証が必要です' });
      }

      const sessionId = deps.userIdToSessionId.get(userId);
      if (!sessionId) {
        return res.status(404).json({ success: false, error: 'セッションが見つかりません' });
      }
      
      const { audioId, subtitleIndex } = req.body;
      const isRepeat = sessionRepeatStates.get(sessionId) || false;
      
      if (isRepeat && audioId && deps.subtitleCache.has(audioId)) {
        const subtitles = deps.subtitleCache.get(audioId)!;
        if (subtitleIndex >= 0 && subtitleIndex < subtitles.length) {
          const subtitle = subtitles[subtitleIndex];
          
          // 同じ字幕の頭に戻る命令を送る
          const commandQueue = sessionCommandQueues.get(sessionId) || [];
          commandQueue.push({
            type: 'seek',
            value: subtitle.startTime,
            timestamp: Date.now()
          });
          sessionCommandQueues.set(sessionId, commandQueue);
          
          debugLog(`字幕終了検知: リピートモードで字幕 ${subtitleIndex} の頭 (${subtitle.startTime}s) に戻る`);
          
          return res.json({ success: true, seekTo: subtitle.startTime });
        }
      }
      
      res.json({ success: true });
    } catch (error: any) {
      debugError('字幕終了検知エラー:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

