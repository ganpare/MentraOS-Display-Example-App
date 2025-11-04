// デバッグログユーティリティ
import { DEBUG } from './config';

export function debugLog(message: string, ...args: any[]): void {
  if (DEBUG) {
    console.log(`[デバッグ] ${message}`, ...args);
  }
}

export function debugError(message: string, ...args: any[]): void {
  if (DEBUG) {
    console.error(`[デバッグ] ${message}`, ...args);
  }
}

