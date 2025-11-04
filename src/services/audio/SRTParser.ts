// SRT字幕パーサークラス
export interface SubtitleEntry {
  index: number;
  startTime: number; // 秒単位
  endTime: number; // 秒単位
  text: string;
}

export class SRTParser {
  static parse(content: string): SubtitleEntry[] {
    const entries: SubtitleEntry[] = [];
    const blocks = content.trim().split(/\n\s*\n/);
    
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 3) continue;
      
      const index = parseInt(lines[0]);
      if (isNaN(index)) continue;
      
      const timecode = lines[1];
      const timeMatch = timecode.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
      if (!timeMatch) continue;
      
      const startTime = 
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]) +
        parseInt(timeMatch[4]) / 1000;
      
      const endTime = 
        parseInt(timeMatch[5]) * 3600 +
        parseInt(timeMatch[6]) * 60 +
        parseInt(timeMatch[7]) +
        parseInt(timeMatch[8]) / 1000;
      
      const text = lines.slice(2).join(' ').trim();
      
      if (text) {
        entries.push({
          index,
          startTime,
          endTime,
          text
        });
      }
    }
    
    return entries.sort((a, b) => a.startTime - b.startTime);
  }
}

