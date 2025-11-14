# MentraOS-Display-Example-App

### Install MentraOS on your phone

MentraOS install links: [mentra.glass/install](https://mentra.glass/install)

### (Easiest way to get started) Set up ngrok

1. `brew install ngrok`

2. Make an ngrok account

3. [Use ngrok to make a static address/URL](https://dashboard.ngrok.com/)

### Register your App with MentraOS

1. Navigate to [console.mentra.glass](https://console.mentra.glass/)

2. Click "Sign In", and log in with the same account you're using for MentraOS

3. Click "Create App"

4. Set a unique package name like `com.yourName.yourAppName`

5. For "Public URL", enter your Ngrok's static URL

6. In the edit app screen, add the microphone permission

### Get your App running!

1. [Install bun](https://bun.sh/docs/installation)

2. Create a new repo from this template using the `Use this template` dropdown in the upper right or the following command: `gh repo create --template Mentra-Community/MentraOS-Cloud-Example-App`

    ![Create repo from template](https://github.com/user-attachments/assets/c10e14e8-2dc5-4dfa-adac-dd334c1b73a5)

3. Clone your new repo locally: `git clone <your-repo-url>`

4. cd into your repo, then type `bun install`

5. Set up your environment variables:
   * Create a `.env` file in the root directory by copying the example: `cp .env.example .env`
   * Edit the `.env` file with your app details:
     ```
     PORT=3000
     PACKAGE_NAME=com.yourName.yourAppName
     MENTRAOS_API_KEY=your_api_key_from_console
     COOKIE_SECRET=your-secret-key-change-this-in-production
     SERVER_URL=https://your-server-url.com
     WEBVIEW_URL=https://your-server-url.com/webview/
     AUDIO_SOURCE_DIR=/path/to/audio/files
     ```
   * Make sure the `PACKAGE_NAME` matches what you registered in the MentraOS Console
   * Get your `API_KEY` from the MentraOS Developer Console
   * Set `SERVER_URL` to your public server URL (e.g., your ngrok URL)
   * Set `WEBVIEW_URL` to your webview URL (defaults to `${SERVER_URL}/webview/` if not set)
   * Set `AUDIO_SOURCE_DIR` to the directory containing `.wav` files and their corresponding `.srt` subtitle files (optional, for audio player mode)

6. Run your app with `bun run dev`

7. To expose your app to the internet (and thus MentraOS) with ngrok, run: `ngrok http --url=<YOUR_NGROK_URL_HERE> 3000`
    * `3000` is the port. It must match what is in the app config. For example, if you entered `port: 8080`, use `8080` for ngrok instead.


## Quick Start (起動手順)

サーバーを起動するには以下の手順を実行してください：

### 前提条件
- [Bun](https://bun.sh/docs/installation) がインストールされていること
- `.env` ファイルが設定されていること（上記の手順5を参照）

### 開発環境での起動

```bash
# プロジェクトディレクトリに移動
cd AugmentOS-Cloud-Example-App

# 依存パッケージのインストール（初回のみ）
bun install

# 開発サーバーを起動（ホットリロード有効）
bun --hot src/index.ts
# または
bun run dev
```

サーバーが起動すると、以下のようなメッセージが表示されます：
```
🎯 App server running at http://localhost:3033
📂 Serving static files from ./public
```

### 本番環境での起動

```bash
# 本番モードで起動
bun src/index.ts
# または
bun run start
```

### トラブルシューティング

**パスエラーが発生する場合:**
- `@mentra/sdk` が正しくインストールされているか確認してください
- `bun install` を再度実行してみてください

**ポートが使用中の場合:**
- `.env` ファイルの `PORT` を変更してください
- ngrok を使用する場合は、ngrok のポート番号も合わせて変更してください

### 常時起動（バックグラウンド実行）

#### 方法1: byobu（開発中におすすめ）

開発中に簡単にバックグラウンドで起動したい場合：

```bash
# byobuを起動
byobu

# プロジェクトディレクトリに移動
cd /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App

# ログを保存しながら起動
bun run dev:tee

# byobuから抜ける: F6 を押す（または Ctrl+A を押してから D を押す）
# 再接続: byobu コマンドで再接続
# 終了: byobuセッション内で Ctrl+C を押す
```

byobuの便利なコマンド：
- **セッションから抜ける**: `F6` または `Ctrl+A` を押してから `D`
- **再接続**: `byobu` コマンドで自動再接続
- **セッション一覧**: `byobu ls`
- **特定セッションに接続**: `byobu attach -t <session-name>`

#### 方法2: systemd（本番環境におすすめ）

システムサービスとして常時起動し、再起動後も自動起動させる場合：

```bash
# サービスファイルを作成
sudo nano /etc/systemd/system/mentraos-app.service
```

以下の内容を追加：

```ini
[Unit]
Description=MentraOS App Server
After=network.target

[Service]
Type=simple
User=hide-deployment
WorkingDirectory=/home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App
ExecStart=/home/hide-deployment/.bun/bin/bun run start
Restart=on-failure
RestartSec=10
StandardOutput=append:/home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App/server.log
StandardError=append:/home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App/server.log
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**注意**: `ExecStart` のパスは `which bun` で確認してください。

```bash
# systemdをリロード
sudo systemctl daemon-reload

# サービスを有効化（起動時に自動起動）
sudo systemctl enable mentraos-app

# サービスを開始
sudo systemctl start mentraos-app

# ステータス確認
sudo systemctl status mentraos-app

# ログを確認
sudo journalctl -u mentraos-app -f
# または
tail -f server.log
```

**systemdのメリット:**
- システム再起動後も自動起動
- クラッシュ時に自動再起動
- ログ管理が標準化されている

**byobuのメリット:**
- 開発中に簡単に起動・停止・確認できる
- セッション管理が簡単
- ログを直接確認できる

### Next Steps

Check out the full documentation at [docs.mentra.glass](https://docs.mentra.glass/core-concepts)

#### Subscribing to events

You can listen for transcriptions, translations, and other events within the onSession function.
