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

切り替えの日を決め、移行期間の最終日をその 3 か月後にします。旧 URL では、前日から画面の上に移転の帯を出します（`legacy-clerk` の `App.vue`）。2 から 4 は続けて行います。旧 URL は 2 で書き込みを止めて案内に変わり、4 で対応表が入るまでは「引き継ぎの準備中」と出します。

1. 予行のデータを消す（「予行のデータを消す」の手順。`tako-prod` は D1 ごと作り直し、`kan-game-prod` は kan/game 側で空にする）
2. 旧 URL を切り替える（`legacy-clerk` の `docs/DEPLOY_DEV.md`「移転の案内への切り替え」）。マイグレーション 0013 を当て、`MOVED_TO` と `MIGRATION_ENDS` を設定してデプロイする。これで旧 URL への書き込みが止まる
3. 「移行で作るファイル」の手順で、旧 D1 を書き出し直して SQL を作る。`--expires` には移行期間の最終日を指定する
4. 取り込む
   - `tako-import.sql` を `tako-prod` へ（「本番の構築」の 2）
   - `kan-game-import.sql` を `kan-game-prod` へ（kan/game 側）
   - `legacy-handoffs.sql` を `tako-sen-dev` へ
5. `public/_headers` から `X-Robots-Tag` を消し、`tako` をデプロイし直す。kan/game 側も同じ時点で外す
6. 確かめる: 本番で ID の発行、同期、ランキング、デイリー、超級、退会。旧 URL の共有リンクから本番の同じ問題が開けること。実際のアカウントで旧 URL から引き継げること。移行の前後の比較（`compareMigration`、ランキング API）

## 運用

2026-10-18 に利用者と決めた最小限の運用です。利用者が増えたら見直します。

### 濫用の監視

頻度制限（ID の発行、記録の投稿、引き継ぎコードの入力）に任せ、週に 1 回、Cloudflare のダッシュボードで `tako` と `kan-game` のログ（observability）を見ます。`play_rate_limited` などの拒否が一部の ID に偏っていないか、エラーが増えていないかを確かめます。自動の警報はまだ設けません。

### ゲーム名への対応

名前は本人が変えられないので、不適切な名前の連絡を規約の連絡先で受け、運営者が消します。消された本人は、次に開いたときに名前を決め直せます。

1. kan/game 側で、その ID の名前を消す（kan/game の `docs/DEPLOY_PROD.md`）。この順序を守る。TAKO-SEN 側を先に消すと、本人が名前を決め直すときに ID 基盤が元の名前を返し、元の名前が戻ってしまう
2. TAKO-SEN 側では、プロフィールの行を消さずに、名前を仮の文字列に替えて同意を外す。行を消すと、外部キーで超級の進捗まで消えるため。元の名前を条件に入れるのは、1 と 2 のあいだに本人が決め直した新しい名前を上書きしないため

   ```bash
   npx wrangler d1 execute tako-prod --env production --remote --command \
     "UPDATE leaderboard_profiles SET display_name = 'removed:' || account_id, consent_version = NULL, consented_at = NULL WHERE account_id = '<ID>' AND display_name = '<元の名前>'"
   ```

   同意がないあいだ、その ID の記録はランキングに出ません。本人が名前を決め直すと同意が戻り、これまでの記録もランキングに戻ります

消した名前はすぐに空き、だれでも（本人も）登録し直せます。使えない名前の一覧はまだありません。同じ名前が繰り返し登録されるようなら、kan/game 側に一覧を設けます。

### バックアップ

D1 の Time Travel（Workers Paid では過去 30 日の任意の時点へ戻せる）に任せます。D1 を書き換える作業の前には、`wrangler d1 export` で書き出しを取り、リポジトリの外に置きます。

### 障害時の復旧

- Worker: 直前の版に戻す。`npx wrangler rollback --env production`（版の一覧は `npx wrangler versions list --env production`）
- D1: Time Travel で戻す。現在の地点は `npx wrangler d1 time-travel info tako-prod --env production` で確かめる。戻すときは `npx wrangler d1 time-travel restore tako-prod --env production --timestamp <時刻>` を使う。戻すとその時刻より後の書き込みは消えるので、利用者の承認を得てから行う
- `tako-prod` と `kan-game-prod` は ID でつながっている。片方だけを戻したときの食い違いは kan/game の `docs/DEPLOY_PROD.md`「障害時の復旧」にある（たとえば `tako-prod` だけを戻すと、ID 基盤には名前が残り、TAKO-SEN ではプロフィールと記録が消える）
- 署名鍵を入れ替えたあとは、入れ替える前の版へ Worker を戻さない。新しい鍵の Cookie を検証できず、その端末は ID を失う
