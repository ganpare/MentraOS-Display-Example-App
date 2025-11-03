// 字幕データの型定義
interface Subtitle {
  startTime: number; // 開始時間（秒）
  endTime: number;   // 終了時間（秒）
  text: string;       // 字幕テキスト
}

// サンプル字幕データ（実際の使用時は外部ファイルから読み込む）
const sampleSubtitles: Subtitle[] = [
  { startTime: 0, endTime: 3, text: "こんにちは、MentraOSです" },
  { startTime: 3, endTime: 7, text: "ARグラスで字幕を表示できます" },
  { startTime: 7, endTime: 12, text: "音声はiPhoneで再生されます" },
  { startTime: 12, endTime: 17, text: "字幕と音声が同期して表示されます" },
];

