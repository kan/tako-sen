# TAKO-SEN

TAKO-SEN は、Star Battle 系のパズルをベースにした、スマートフォン向けのロジックパズルゲームです。

各行・各列・各 Region にタコを1匹ずつ配置し、タコ同士が上下左右・斜めに接触しないように解いていきます。

## 開発状況

このリポジトリは現在開発中です。

8×8 の問題生成からクリア、段階的ヒント、ローカル成績まで遊べる初期版です。問題の多様性・難易度精度と実機でのアクセシビリティ確認は引き続き改善中です。

詳細な設計方針は [`docs/DESIGN.md`](docs/DESIGN.md)、初期版の実装経緯は [`docs/MILESTONE.md`](docs/MILESTONE.md)、次フェーズの仕様と着手順は [`docs/NEXT_PHASE.md`](docs/NEXT_PHASE.md) を参照してください。端末での確認項目は [`docs/DEVICE_CHECKLIST.md`](docs/DEVICE_CHECKLIST.md) にまとめています。

## 現在できること

- 8×8 盤面の表示
- 隣接関係を考慮した Region の色分けと境界表示
- タップによる `×` の切り替え、ドラッグによる連続 `×` 入力
- ロングタップ後、指やマウスを離してタコを確定
- 誤ったタコ配置時の固定赤 `×`
- タコからの一括消去と Region-Line 消去のショートカット
- 論理的な定石と矛盾検出に基づくヒント
- Complete Solver による唯一解検証
- 初級・中級・上級を選べる seed 指定可能な Puzzle Generator と難易度分析
- シードの表示・コピー・復元
- READY 画面から始まるタイマー、一時停止、再読み込み時の一時停止
- クリア結果、同一シードのローカル順位、難易度別集計
- localStorage によるプレイ中状態・匿名ユーザー ID・成績の保存

## 遊び方

1. 問題が表示されたら「READY?」の「OK」を押して開始します。タイマーはこの時点から進みます。
2. タップで `×` を付け外し、押したままドラッグすると通過したマスへ `×` を追加できます。
3. タコを置くマスを長押しし、枠が出てから離すと配置を確定します。`×` があるマスでは先にタップで `×` を外してください。誤配置は固定された赤い `×` になります。
4. 配置済みタコや対象 Region をダブルタップすると、対応する一括消去を実行します。
5. 時間表示の右の一時停止ボタンで READY 画面に戻れます。再読み込み後も一時停止し、OK で続きから再開します。一時停止中の時間はクリア時間に含みません。

「シード表示・復元」から問題コードをコピー・入力できます。「ローカル成績」の最近のシードからも同じ問題を復元できます。Generator バージョンは問題コードに含まれますが、現在復元できるのは現行バージョンのコードのみです。

成績はこの端末内だけの記録です。`×` またはタコで盤面が変わった時点で挑戦として数え、何も置かず次の問題へ進んだ場合は数えません。

## 技術構成

- TypeScript
- Vue 3
- Vite
- Vitest
- Cloudflare Workers Static Assets

## セットアップ

```bash
npm install
```

## 開発サーバー

```bash
npm run dev
```

未ログイン・オフラインでのプレイには API の起動は不要です。履歴同期をローカルで試す場合は、Clerk Development アプリの公開可能キーを `.env.local` に設定します。

```text
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

別途、秘密鍵を含む `.dev.vars` をリポジトリ直下に作成します。どちらのファイルも Git の管理対象外です。`CLERK_PUBLISHABLE_KEY` には `.env.local` と同じ公開可能キーを設定します。`CLERK_SECRET_KEY` は Clerk Dashboard の Secret Key を使い、チャットやリポジトリへ貼らないでください。

```text
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
ALLOWED_ORIGINS="http://localhost:5173,http://localhost:8787"
```

`CLERK_WEBHOOK_SIGNING_SECRET` は Clerk Dashboard の Webhooks で `POST /api/clerk-webhook` に `user.deleted` を配信するエンドポイントを作成した後、その Signing Secret を設定します。ローカルで webhook を試すには外部から到達できる HTTPS 転送が必要です。値をチャットやリポジトリに貼らないでください。

最初にローカル D1 へマイグレーションを適用し、2つのターミナルで API と画面を起動します。Vite の `/api` はローカル Worker へ転送されます。

```bash
npx wrangler d1 migrations apply tako-sen-dev --local
npm run build
npm run dev:api
# 別ターミナルで
npm run dev
```

ログイン後の「オンライン履歴」から明示的に取り込んだクリア結果だけを送信します。送信後もローカル履歴は削除しません。通信失敗時もゲーム本体は引き続き利用できます。退会操作では Clerk アカウントとオンライン履歴を削除し、端末のローカル履歴は残します。Clerk Dashboard 等から直接削除された場合の履歴削除には、`POST /api/clerk-webhook` に `user.deleted` を送る Clerk webhook と `CLERK_WEBHOOK_SIGNING_SECRET` の設定が必要です。開発用 Worker を公開し、同一アカウントでの別端末同期、別アカウントの履歴分離、使い捨てアカウントの退会を確認済みです。Clerk Dashboard の `user.deleted` テスト配信も `200` で成功しました。

### 公開前の確認事項

開発用デプロイと確認の手順は [`docs/DEPLOY_DEV.md`](docs/DEPLOY_DEV.md) を参照してください。開発用 URL は <https://tako-sen.kan-fushihara.workers.dev> です。本番公開ではありません。

- 現在の D1 binding は開発用 `tako-sen-dev` を指します。本番公開時には保存先を分け、対象を確認してください。
- 開発用 Clerk キーを使う公開 URL は動作確認用として扱います。本番運用には Clerk の本番インスタンスと専用ドメインが必要です。
- Worker 側に `CLERK_PUBLISHABLE_KEY`、`CLERK_SECRET_KEY`、`CLERK_WEBHOOK_SIGNING_SECRET`、`ALLOWED_ORIGINS` を設定します。`ALLOWED_ORIGINS` には実際の公開 URL の origin を指定します。`.dev.vars` の値はデプロイ先へ自動転送されません。
- Clerk Dashboard で `user.deleted` を `https://<公開URL>/api/clerk-webhook` に配信し、署名シークレットを Worker に設定します。Webhook の到達、再送、失敗時の確認方法を検証してから利用者へ案内してください。
- 別端末から本人の履歴取得、未認証の `401`、他者の履歴が見えないことを確認します。退会の実動作確認にはテスト用アカウントだけを使い、ローカル履歴が残ることも確認します。

## テスト

```bash
npm test
```

## 型チェック

```bash
npm run typecheck
```

## ビルド

```bash
npm run build
```

## 設計メモ

パズルのコアロジックは Vue や DOM から独立した pure TypeScript として実装する方針です。

ゲーム仕様の正本は [`docs/DESIGN.md`](docs/DESIGN.md) です。ゲームルール、Solver、Generator、ヒント、操作体系などに関わる変更では、まずこの文書を確認してください。
