# 本番の構築と移行の手順

TAKO-SEN の本番（<https://tako.kan-game.app>）を作り、旧 URL（<https://tako-sen.kan-fushihara.workers.dev>）の記録を移す手順です。方針と段階（R3〜R5）は `docs/NEXT_PHASE.md`「本番リリース計画」を正とします。ID 基盤（`kan-game.app`）側の手順は kan/game の `docs/DEPLOY_PROD.md` にあります。

リモートの D1 への書き込み、D1 の作成と削除、デプロイは、どれも利用者の承認を得てから行います。

## 構成

| 環境 | ホスト                  | Worker     | D1             | ID 基盤        | 設定                                 |
| ---- | ----------------------- | ---------- | -------------- | -------------- | ------------------------------------ |
| 本番 | `tako.kan-game.app`     | `tako`     | `tako-prod`    | `kan-game`     | `wrangler.jsonc` の `env.production` |
| 開発 | `tako-dev.kan-game.app` | `tako-dev` | `tako-dev`     | `kan-game-dev` | `env.dev`                            |
| 旧   | 旧 URL                  | `tako-sen` | `tako-sen-dev` | なし（Clerk）  | `legacy-clerk` ブランチ              |

`tako` と `kan-game` は互いを Service Binding で指します。`kan-game` を先に `GAME_TAKO` なしで出し、`tako` を出したあと `GAME_TAKO` 付きで出し直します（kan/game 側の作業）。

## 移行で作るファイル

`scripts/migrate-legacy.ts` が、旧 D1 の書き出しから次の 4 つを作ります。出力にはトークンが平文で入るので、リポジトリの外に置き、移行期間が終わったら消します。

| ファイル              | 流す先                                  | 中身                                           |
| --------------------- | --------------------------------------- | ---------------------------------------------- |
| `tako-import.sql`     | `tako-prod`（テーブルが 1 つもない D1） | 記録のすべて。ID を新しい ID に置き換えたもの  |
| `kan-game-import.sql` | `kan-game-prod`（kan/game から流す）    | 新しい ID、名前、引き継ぎ用トークンのハッシュ  |
| `legacy-handoffs.sql` | `tako-sen-dev`（旧 URL の D1）          | Clerk のユーザー ID と引き継ぎ用トークンの対応 |
| `accounts.json`       | どこにも流さない                        | Clerk のユーザー ID、新しい ID、名前の対応     |

```bash
OUT=<リポジトリの外のディレクトリ>
npx wrangler d1 export tako-sen-dev --remote -c <legacy-clerk の wrangler.jsonc> --output "$OUT/export.sql"
node scripts/migrate-legacy.ts --dump "$OUT/export.sql" --expires <移行期間の最終日 YYYY-MM-DD> --out "$OUT/out"
```

- 旧 D1 の書き出しは読み取りだけで、旧 D1 は変わりません
- スクリプトは、移行の前後で行が 1 件でも食い違うと何も書き出さずに止まります。ID 基盤の D1（`tests/kan-game/0001_initial.sql`）が受け付けない内容のときも止まります
- `tako-import.sql` は、`wrangler d1 export` と同じく、行のあとにトリガーを作ります。取り込みの途中で頻度制限や初回スコアのトリガーは動きません
- `tako-import.sql` は `CREATE TABLE` から始まるので、テーブルが 1 つもない D1 にしか入りません。`migrations apply` を先に流さないでください。マイグレーションの記録（`d1_migrations`）も一緒に入るので、取り込んだあとは通常どおり `migrations apply` で続きを当てられます

## 本番の構築（R3）

1. D1 を作り、`wrangler.jsonc` の `env.production` に `database_id` を書く

   ```bash
   npx wrangler d1 create tako-prod
   ```

2. 予行のデータを取り込む（「移行で作るファイル」の手順で作ったもの）

   ```bash
   npx wrangler d1 execute tako-prod --env production --remote --file "$OUT/out/tako-import.sql"
   ```

3. ビルドしてデプロイする

   ```bash
   npm run build
   npx wrangler deploy --env production
   ```

4. kan/game 側に、`GAME_TAKO` 付きで `kan-game` を出し直すよう依頼する。`kan-game-import.sql` の取り込みも kan/game 側で行う
5. 旧 URL の D1 に `legacy-handoffs.sql` を流す（`legacy-clerk` ブランチの手順）

告知（R4）までは、`public/_headers` の `X-Robots-Tag: noindex` で検索エンジンに載せません。

## 予行のデータを消す（R4 の前）

予行で入れた記録は、本番の移行の前に消します。`tako-prod` と `kan-game-prod` は同じ時点で空にします。片方だけだと、記録と ID が食い違います。

`tako-import.sql` はテーブルのない D1 にしか入らないので、`tako-prod` は D1 ごと作り直します。

```bash
npx wrangler d1 delete tako-prod
npx wrangler d1 create tako-prod   # 新しい database_id を env.production に書く
```

`kan-game-prod` を空に戻す手順は kan/game の `docs/DEPLOY_PROD.md` にあります。旧 URL の D1 の対応表（`migration_handoffs`）も消してから、本番の移行で作り直します。

## 本番の移行（R4）

1. 旧 URL への書き込みを止める（`legacy-clerk` ブランチの手順）
2. 「移行で作るファイル」の手順を、本番の移行期間の最終日を `--expires` に指定してやり直す
3. 「本番の構築」の 2、4、5 と同じ順に取り込み、`tako` をデプロイし直す
4. `public/_headers` から `X-Robots-Tag` を消してデプロイし、旧 URL を移転の案内に切り替える
