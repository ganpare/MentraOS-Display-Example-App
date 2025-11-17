# サーバー永続化の仕組み

## 📋 現在の構成

現在、サーバーは **byobu**（実質的には **tmux**）を使用して永続化されています。

### 仕組み

1. **byobu** = `tmux`のラッパーです
2. **tmux** = ターミナルマルチプレクサーで、セッションを維持します
3. セッションは、SSH接続が切断されても**バックグラウンドで継続**します

### 現在の状態

```bash
# セッション一覧を確認
byobu list-sessions

# 実行中のプロセスを確認
ps aux | grep "bun.*src/index.ts"
```

### セッション名

- **現在のセッション**: `mentraos-server-new`
- **コマンド**: `bun --hot src/index.ts`
- **ディレクトリ**: `/home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App`

---

## 🔄 サーバー操作コマンド

### セッションに接続

```bash
# セッション一覧を確認
byobu list-sessions

# セッションにアタッチ（接続）
byobu attach -t mentraos-server-new

# または、セッション名を指定しない場合（自動選択）
byobu attach
```

### セッションからデタッチ（切断）

セッション内で：
- **`Ctrl+A` を押してから `D`** を押す（デタッチ）
- または **`F6`** を押す（byobuのデフォルト）

これで、プロセスはバックグラウンドで継続します。

### サーバーを再起動

#### 方法1: セッション内で再起動

```bash
# セッションに接続
byobu attach -t mentraos-server-new

# セッション内で：
# Ctrl+C で現在のプロセスを停止
# その後、以下のコマンドを実行
cd /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App
bun --hot src/index.ts
```

#### 方法2: セッション外から再起動

```bash
# プロセスを停止
pkill -f "bun.*src/index.ts"

# 新しいセッションを作成して起動
cd /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App
byobu new-session -d -s mentraos-server -c /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App "bun --hot src/index.ts"
```

#### 方法3: 既存セッションを再利用

```bash
# セッション内の既存ウィンドウをkillして再起動
byobu kill-window -t mentraos-server-new:0
byobu new-window -t mentraos-server-new -c /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App "bun --hot src/index.ts"
```

### サーバーを停止

```bash
# プロセスを停止
pkill -f "bun.*src/index.ts"

# セッション全体を削除する場合
byobu kill-session -t mentraos-server-new
```

### ログを確認

```bash
# セッションに接続してログを確認
byobu attach -t mentraos-server-new

# または、プロセスの出力を確認
# セッションに接続して画面をスクロール
```

---

## 🔧 systemdサービスとの比較

### 現在の方式（byobu/tmux）の特徴

**メリット:**
- ✅ 設定が簡単（すぐに使える）
- ✅ 対話的な操作が可能（手動でのコマンド実行など）
- ✅ ログをリアルタイムで確認できる
- ✅ sudo権限が不要

**デメリット:**
- ❌ システム再起動時に自動起動しない（手動で起動が必要）
- ❌ プロセス管理が手動（クラッシュ時の自動再起動なし）
- ❌ ログファイルへの自動保存がない

### systemdサービスの特徴

**メリット:**
- ✅ システム再起動時に自動起動
- ✅ プロセスがクラッシュした場合の自動再起動
- ✅ ログファイルへの自動保存（`journalctl`で確認）
- ✅ 起動順序の制御（他のサービスに依存できる）

**デメリット:**
- ❌ 設定が複雑（サービスファイルの作成が必要）
- ❌ sudo権限が必要
- ❌ 対話的な操作が難しい

---

## 📝 systemdサービス化する場合の例

もしsystemdサービス化したい場合は、以下のような設定ファイルを作成します：

### サービスファイル例

`/etc/systemd/system/mentraos-server.service`:

```ini
[Unit]
Description=MentraOS App Server
After=network.target

[Service]
Type=simple
User=hide-deployment
WorkingDirectory=/home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App
ExecStart=/usr/local/bin/bun --hot src/index.ts
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 使用方法

```bash
# サービスファイルを作成（sudoが必要）
sudo nano /etc/systemd/system/mentraos-server.service

# サービスを有効化
sudo systemctl enable mentraos-server

# サービスを起動
sudo systemctl start mentraos-server

# ステータスを確認
sudo systemctl status mentraos-server

# ログを確認
sudo journalctl -u mentraos-server -f

# サービスを再起動
sudo systemctl restart mentraos-server

# サービスを停止
sudo systemctl stop mentraos-server
```

---

## 🎯 推奨事項

### 開発環境

**byobu/tmuxを使用**（現在の構成）
- 開発中は対話的な操作が必要
- ログをリアルタイムで確認したい
- 簡単に再起動したい

### 本番環境

**systemdサービスを推奨**
- 自動起動が必要
- プロセス管理の堅牢性が必要
- ログ管理が必要

---

## 🔍 トラブルシューティング

### セッションが見つからない

```bash
# すべてのbyobuセッションを確認
byobu list-sessions

# tmuxセッションを直接確認
tmux list-sessions
```

### プロセスが複数起動している

```bash
# すべてのプロセスを確認
ps aux | grep "bun.*src/index.ts"

# 不要なプロセスを停止
pkill -f "bun.*src/index.ts"

# その後、新しいセッションを作成
```

### ポートが既に使用されている

```bash
# ポート3033を使用しているプロセスを確認
sudo lsof -i :3033

# プロセスを停止
kill <PID>
```

---

## 📚 参考資料

- [byobu公式ドキュメント](https://www.byobu.org/)
- [tmux公式ドキュメント](https://tmux.github.io/)
- [systemdサービス管理](https://www.freedesktop.org/software/systemd/man/systemd.service.html)





