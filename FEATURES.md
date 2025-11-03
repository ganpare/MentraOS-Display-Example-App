# MentraOSアプリ機能一覧

## 📱 現在実装されている機能

### 1. Hello Worldメッセージ表示
- **説明**: アプリセッション開始時に「Hello World! 👋」を表示します
- **表示場所**: 
  - ARグラス（ViewType.MAIN）
  - iPhoneアプリ（ViewType.DASHBOARD）
- **表示時間**: 次の表示まで残り続けます（durationMs未指定）

### 2. バッテリー情報表示
- **説明**: ARグラスのバッテリー残量を取得して表示します
- **表示場所**: 
  - ARグラス（ViewType.MAIN）
  - iPhoneアプリ（ViewType.DASHBOARD）
- **表示時間**: 5秒間
- **表示形式**: `バッテリー: XX%`
- **取得方法**: `session.events.onGlassesBattery()` イベント

### 3. ライブキャプション機能（リアルタイム音声認識）
- **説明**: 音声をリアルタイムで文字起こしし、表示します
- **表示場所**: 
  - ARグラス（ViewType.MAIN）
  - iPhoneアプリ（ViewType.DASHBOARD）
- **動作**:
  - **途中のテキスト**: 「聞いています: [認識中のテキスト]」としてリアルタイム更新
  - **確定したテキスト**: 「聞こえました: [確定したテキスト]」として5秒間表示
- **必要な権限**: マイク権限（MentraOS Developer Consoleで設定が必要）

## 🔧 技術仕様

### 使用しているAPI
- `session.layouts.showTextWall()`: テキスト表示
- `session.events.onGlassesBattery()`: バッテリー情報取得
- `session.events.onTranscription()`: 音声認識イベント

### ViewType
- `ViewType.MAIN`: ARグラスに表示
- `ViewType.DASHBOARD`: iPhoneアプリに表示

### 動作環境
- **サーバー**: Node.js/Bun
- **ポート**: 3033（環境変数で変更可能）
- **公開URL**: https://mentra-app.sunandgo35.com（Cloudflare Tunnel経由）

## 📝 注意事項
- 音声認識機能を使用するには、MentraOS Developer Consoleでマイク権限を有効にする必要があります
- バッテリー情報は自動的に取得されます（イベントベース）

