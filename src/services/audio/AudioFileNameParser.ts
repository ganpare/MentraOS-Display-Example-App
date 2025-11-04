// ファイル名パターン解析クラス
export class AudioFileNameParser {
  static parse(fileName: string): {
    date: string;           // yyyy-mm-dd
    timeOfDay: string;      // 昼 or 夜
    level: string;          // 初心者, 中級者, 上級者
    title: string;         // タイトル部分
    speaker: 'luna' | 'professor'; // 話者
    rawFileName: string;    // 元のファイル名
  } | null {
    // 日付パターン: yyyy-mm-ddで始まる
    const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) return null;

    const date = dateMatch[1];

    // 話者パターン: _luna_daisuki または _professor_daisuki で終わる
    const speakerMatch = fileName.match(/_(luna|professor)_daisuki\.(wav|srt)$/);
    if (!speakerMatch) return null;

    const speaker = speakerMatch[1] as 'luna' | 'professor';

    // 時刻パターン: _-_昼_ または _-_夜_
    const timeMatch = fileName.match(/_-_([昼夜])_/);
    const timeOfDay = timeMatch ? timeMatch[1] : '';

    // レベルパターン: [初心者], [中級者], [上級者]
    const levelMatch = fileName.match(/\[([^\]]+)\]/);
    const level = levelMatch ? levelMatch[1] : '';

    // タイトル部分を抽出（日付以降、話者以前の部分）
    // パターン: date_-_timeOfDay_[level]_title_-_神威日報_speaker
    const titleStart = fileName.indexOf(']_');
    const titleEnd = fileName.indexOf('_-_神威日報_');
    
    let title = '';
    if (titleStart !== -1 && titleEnd !== -1) {
      title = fileName.substring(titleStart + 2, titleEnd).trim();
    } else if (titleStart !== -1) {
      // フォールバック: レベル以降から話者以前まで
      const speakerStart = fileName.lastIndexOf(`_${speaker}_daisuki`);
      if (speakerStart !== -1) {
        title = fileName.substring(titleStart + 2, speakerStart).replace(/_-_神威日報_?$/, '').trim();
      }
    }

    return {
      date,
      timeOfDay,
      level,
      title,
      speaker,
      rawFileName: fileName
    };
  }

  // 月の文字列を取得（yyyy-mm形式）
  static getMonth(dateStr: string): string {
    const match = dateStr.match(/^(\d{4}-\d{2})/);
    return match ? match[1] : '';
  }
}

