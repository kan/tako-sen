# 開発用 Worker の公開確認手順

この手順は別端末での履歴同期を確認するための開発用デプロイです。本番公開手順ではありません。2026-09-25 に承認を得て <https://tako-sen.kan-fushihara.workers.dev> へデプロイ済みです。再デプロイ前にも公開 URL と対象 D1 を確認します。

## 事前確認

1. `wrangler.jsonc` の Worker 名と D1 binding が意図した開発用リソースを指すことを確認する。現在の D1 名は `tako-sen-dev`。
2. Cloudflare の公開 URL の origin（例: `https://tako-sen.<subdomain>.workers.dev`）を確認する。公開 URL は認証前の画面も含めて誰でも開けるため、開発用として扱う。
3. `.env.local` の `VITE_CLERK_PUBLISHABLE_KEY` が開発用 Clerk アプリの公開可能キーであることを確認する。Vite のビルドにはこの値が埋め込まれる。秘密鍵を `VITE_` 付きにしない。
4. Clerk Dashboard の Webhooks で公開 URL の `/api/clerk-webhook` に `user.deleted` を送るエンドポイントを作り、Signing Secret を取得する。デプロイ前に設定し、公開後に配信テストを行う。

## デプロイ設定

リポジトリ直下に Git 管理対象外の `.env.deploy.local` を作る。`.dev.vars` をそのまま使わない。特に `ALLOWED_ORIGINS` は localhost だけでは公開画面からの API リクエストを拒否する。

```text
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
ALLOWED_ORIGINS=https://tako-sen.<subdomain>.workers.dev
```

Clerk の公開可能キーは `.env.local` と同じインスタンスのものを使う。秘密鍵・Signing Secret・ファイル内容をチャットや Git に貼らない。`--secrets-file` は、このファイルの値をデプロイ時に暗号化された Worker secrets として送る。`wrangler secret put` は即時デプロイを伴うため、この手順では使わない。

## 実行と確認

```bash
npx wrangler d1 migrations list tako-sen-dev --remote
npm run typecheck
npm test
npm run build
npx wrangler deploy --dry-run
# 対象・公開 URL・利用者の承認を確認してから実行
npx wrangler deploy --secrets-file .env.deploy.local
```

公開後は以下を確認する。

1. 未ログインの `GET /api/plays` と `DELETE /api/account` が `401` になる。Origin が許可外なら `403` になる。
2. テスト用アカウントでログインし、端末 A で明示的に履歴を取り込み、端末 B で本人の履歴を取得できる。別アカウントからは見えない。
3. 通信を切ってもゲーム本体・ローカル保存が動き、再送時に履歴が重複しない。
4. Clerk Dashboard の webhook 配信結果で `user.deleted` の署名検証と到達を確認する。退会の実動作はテスト用アカウントに限り、D1 の履歴が消え、端末のローカル履歴が残ることを確認する。

Clerk の webhook は非同期で、配信失敗や遅延があり得る。失敗時の再送・監視を確認するまで、実利用者向けに退会完了を保証する運用はしない。

2026-09-25 の確認結果: 静的画面 `200`、未認証の履歴取得・退会 `401`、未署名 webhook `400`、許可外 Origin `403`、架空 ID を使う署名付き webhook `200`。利用者は同一アカウントの2端末で履歴を同期し、別アカウントでは既存のオンライン履歴が表示されないことを確認した。Clerk Dashboard の `user.deleted` テスト配信も `200`。使い捨てアカウントで記録を取り込んでから退会すると、ローカル履歴は残った。D1 の件数は退会前の2アカウント計3件から、退会後の1アカウント計2件になった。普段使いのアカウントは削除していない。
