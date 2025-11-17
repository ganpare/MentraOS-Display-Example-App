# サーバー再起動の仕組み

## 🔄 自動再起動（bun --hot）

現在、サーバーは **`bun --hot`** で起動されています。これは開発環境でファイル変更を自動検知して、サーバーを自動再起動する機能です。

### 動作

- ✅ **TypeScript/JavaScriptファイル**（`src/**/*.ts`）を変更すると自動再起動
- ✅ **設定ファイル**（`.env`など）を変更した場合は手動再起動が必要
- ⚠️ **publicファイル**（`public/**/*`）の変更は再起動不要（静的ファイルとして直接提供）

### 起動コマンド

```bash
# 開発モード（自動再起動あり）
bun --hot src/index.ts

# または
bun run dev
```

### 再起動が必要な場合

以下のファイルを変更した場合は、**手動で再起動が必要**です：

1. **`.env`ファイル** - 環境変数の変更
2. **`package.json`** - 依存関係の変更（その後`bun install`も必要）
3. **初期化コード**（`src/index.ts`のコンストラクタなど）- まれに自動再起動が検知しない場合

## 🔧 手動再起動方法

### 方法1: byobuセッション内で再起動（推奨）

```bash
# セッションに接続
byobu attach -t server

# セッション内で：
# Ctrl+C で現在のプロセスを停止
# その後、自動的に再起動される（bun --hotの場合）

# または、手動で再起動
cd /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App
bun --hot src/index.ts
```

### 方法2: セッション外から再起動

```bash
# プロセスを停止
pkill -f "bun.*src/index.ts"

# 新しいセッションで再起動
cd /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App
byobu new-session -d -s server -c /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App "bun --hot src/index.ts"
```

### 方法3: スクリプトで再起動

```bash
#!/bin/bash
# restart-server.sh

cd /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App

# 既存のプロセスを停止
pkill -f "bun.*src/index.ts"

# 少し待つ
sleep 2

# 新しいセッションで再起動
byobu new-session -d -s server -c /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App "bun --hot src/index.ts"

echo "サーバーを再起動しました"
```

## 📋 現在の状態確認

### サーバーが起動しているか確認

```bash
# プロセス確認
ps aux | grep "bun.*src/index.ts" | grep -v grep

# セッション確認
byobu list-sessions

# ログ確認
byobu capture-pane -t server -p | tail -20
```

### サーバーの状態を確認

```bash
# セッションに接続
byobu attach -t server

# 最新のログを確認
# Ctrl+A → [ でコピーモードに入り、矢印キーでスクロール
```

## 🎯 開発時のベストプラクティス

### 1. 通常の開発フロー

```bash
# サーバーは起動したまま
# src/**/*.ts ファイルを編集
# → 自動的に再起動される（数秒待つ）
# → 変更が反映される
```

### 2. 環境変数を変更した場合

```bash
# .env ファイルを編集
nano .env

# サーバーを手動で再起動
byobu attach -t server
# Ctrl+C → bun --hot src/index.ts
```

### 3. 依存関係を変更した場合

```bash
# package.json を編集
nano package.json

# 依存関係をインストール
bun install

# サーバーを再起動
byobu attach -t server
# Ctrl+C → bun --hot src/index.ts
```

## 🔍 トラブルシューティング

### 自動再起動が機能しない場合

1. **ファイル変更が検知されていない**
   ```bash
   # ファイルの権限を確認
   ls -la src/
   
   # ファイルが実際に保存されているか確認
   # エディタの自動保存が有効か確認
   ```

2. **プロセスがハングしている**
   ```bash
   # プロセスを強制終了
   pkill -9 -f "bun.*src/index.ts"
   
   # 再起動
   byobu new-session -d -s server -c /home/hide-deployment/projects/MentraOS/AugmentOS-Cloud-Example-App "bun --hot src/index.ts"
   ```

3. **ポートが使用中**
   ```bash
   # ポート3033を使用しているプロセスを確認
   sudo lsof -i :3033
   
   # 必要に応じて停止
   kill -9 <PID>
   ```

## 📝 メモ

- **開発時**: `bun --hot` を使用（自動再起動あり）
- **本番時**: `bun run start` を使用（自動再起動なし、より安定）

現在の起動方法: `bun --hot src/index.ts`（自動再起動有効）
