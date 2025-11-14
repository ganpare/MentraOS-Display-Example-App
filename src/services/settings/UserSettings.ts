// ユーザー設定管理サービス
import * as fs from 'fs';
import * as path from 'path';
import { debugLog, debugError } from '../../utils/debug';

// 旧形式（後方互換性のため残す）
export interface ButtonMapping {
  // シングルクリック時の動作
  single: {
    type: 'text_nextpage' | 'text_prevpage' | 'audio_play' | 'audio_pause' | 'audio_next' | 'audio_prev' | 'audio_skip_forward' | 'audio_skip_backward' | 'none';
    value?: number; // skipの秒数など
  };
  // ダブルクリック時の動作
  double: {
    type: 'text_nextpage' | 'text_prevpage' | 'audio_play' | 'audio_pause' | 'audio_next' | 'audio_prev' | 'audio_skip_forward' | 'audio_skip_backward' | 'none';
    value?: number;
  };
}

// アクション→トリガーのマッピング（新しい形式）
export interface ActionTriggerMapping {
  // シングルクリック時のトリガー
  single?: {
    trigger: 'playpause' | 'nexttrack' | 'prevtrack' | 'none';
  };
  // ダブルクリック時のトリガー
  double?: {
    trigger: 'playpause' | 'nexttrack' | 'prevtrack' | 'none';
  };
}

export interface UserMediaSettings {
  userId: string;
  // 旧形式（後方互換性）
  mappings?: {
    playpause?: ButtonMapping;
    nexttrack?: ButtonMapping;
    prevtrack?: ButtonMapping;
  };
  // 新形式：アクション（GUIボタン）→トリガー（Bluetoothボタン）
  actionMappings?: {
    // テキストリーダー
    'text_prevBtn'?: ActionTriggerMapping;  // 前のページ
    'text_nextBtn'?: ActionTriggerMapping;  // 次のページ
    // 音声プレーヤー
    'audio_playBtn'?: ActionTriggerMapping;      // 再生
    'audio_pauseBtn'?: ActionTriggerMapping;     // 一時停止
    'audio_skipForwardBtn'?: ActionTriggerMapping;   // 早送り +10秒
    'audio_skipBackwardBtn'?: ActionTriggerMapping;  // 巻き戻し -10秒
    'audio_nextSubtitleBtn'?: ActionTriggerMapping;  // 次字幕
    'audio_prevSubtitleBtn'?: ActionTriggerMapping;  // 前字幕
    'audio_repeatSubtitleBtn'?: ActionTriggerMapping; // リピート
    'audio_speedBtn'?: ActionTriggerMapping;      // 速度変更
  };
  updatedAt: number;
}

const SETTINGS_DIR = path.join(process.cwd(), 'data', 'settings');
const SETTINGS_FILE = (userId: string) => path.join(SETTINGS_DIR, `${userId}.json`);

// デフォルト設定（新形式）
const DEFAULT_ACTION_MAPPINGS: UserMediaSettings['actionMappings'] = {
  'text_prevBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
  'text_nextBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
  'audio_playBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
  'audio_pauseBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
  'audio_skipForwardBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
  'audio_skipBackwardBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
  'audio_nextSubtitleBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
  'audio_prevSubtitleBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
  'audio_repeatSubtitleBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
  'audio_speedBtn': { single: { trigger: 'none' }, double: { trigger: 'none' } },
};

// 設定ディレクトリの初期化
function ensureSettingsDir(): void {
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    debugLog(`設定ディレクトリを作成: ${SETTINGS_DIR}`);
  }
}

// ユーザー設定を読み込む
export function getUserSettings(userId: string): UserMediaSettings {
  ensureSettingsDir();
  
  const filePath = SETTINGS_FILE(userId);
  
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      const settings: UserMediaSettings = JSON.parse(data);
      
      // デフォルト値で不足している項目を補完
      return {
        ...settings,
        actionMappings: {
          ...DEFAULT_ACTION_MAPPINGS,
          ...settings.actionMappings
        },
        userId: settings.userId || userId
      };
    }
  } catch (error: any) {
    debugError(`ユーザー設定の読み込みエラー (${userId}):`, error);
  }
  
  // デフォルト設定を返す
  return {
    userId,
    actionMappings: { ...DEFAULT_ACTION_MAPPINGS },
    updatedAt: Date.now()
  };
}

// ユーザー設定を保存する
export function saveUserSettings(settings: UserMediaSettings): void {
  ensureSettingsDir();
  
  const filePath = SETTINGS_FILE(settings.userId);
  
  try {
    const data = JSON.stringify({
      ...settings,
      updatedAt: Date.now()
    }, null, 2);
    
    fs.writeFileSync(filePath, data, 'utf-8');
    debugLog(`ユーザー設定を保存: ${settings.userId}`);
  } catch (error: any) {
    debugError(`ユーザー設定の保存エラー (${settings.userId}):`, error);
    throw error;
  }
}

// ユーザー設定を更新する（部分更新）
export function updateUserSettings(
  userId: string,
  updates: Partial<UserMediaSettings['actionMappings']>
): UserMediaSettings {
  const current = getUserSettings(userId);
  
  const updated: UserMediaSettings = {
    ...current,
    actionMappings: {
      ...current.actionMappings || {},
      ...updates
    },
    updatedAt: Date.now()
  };
  
  saveUserSettings(updated);
  return updated;
}

// アクションからトリガーへのマッピングを逆引き（旧形式との互換性）
export function convertActionMappingsToButtonMappings(actionMappings: UserMediaSettings['actionMappings']): UserMediaSettings['mappings'] | undefined {
  if (!actionMappings) return undefined;
  
  const result: UserMediaSettings['mappings'] = {
    playpause: { single: { type: 'none' }, double: { type: 'none' } },
    nexttrack: { single: { type: 'none' }, double: { type: 'none' } },
    prevtrack: { single: { type: 'none' }, double: { type: 'none' } }
  };
  
  // アクションマッピングをボタンマッピングに変換
  for (const [actionId, mapping] of Object.entries(actionMappings)) {
    if (!mapping) continue;
    
    const actionTypeMap: Record<string, 'text_nextpage' | 'text_prevpage' | 'audio_play' | 'audio_pause' | 'audio_skip_forward' | 'audio_skip_backward' | 'audio_next_subtitle' | 'audio_prev_subtitle' | 'audio_repeat' | 'audio_speed'> = {
      'text_prevBtn': 'text_prevpage',
      'text_nextBtn': 'text_nextpage',
      'audio_playBtn': 'audio_play',
      'audio_pauseBtn': 'audio_pause',
      'audio_skipForwardBtn': 'audio_skip_forward',
      'audio_skipBackwardBtn': 'audio_skip_backward',
      'audio_nextSubtitleBtn': 'audio_next_subtitle',
      'audio_prevSubtitleBtn': 'audio_prev_subtitle',
      'audio_repeatSubtitleBtn': 'audio_repeat',
      'audio_speedBtn': 'audio_speed'
    };
    
    const actionType = actionTypeMap[actionId];
    if (!actionType) continue;
    
    if (mapping.single?.trigger && mapping.single.trigger !== 'none') {
      const trigger = mapping.single.trigger;
      if (result[trigger]) {
        result[trigger]!.single.type = actionType;
      }
    }
    
    if (mapping.double?.trigger && mapping.double.trigger !== 'none') {
      const trigger = mapping.double.trigger;
      if (result[trigger]) {
        result[trigger]!.double.type = actionType;
      }
    }
  }
  
  return result;
}

