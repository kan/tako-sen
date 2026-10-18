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
2. タップで `×` を付け外し、空きマスから押したままドラッグすると通過したマスへ `×` を追加できます。`×` のマスからドラッグすると `×` を除去します。
3. タコを置くマスを長押しすると、すぐに細い枠と進捗が出ます。太い枠になってから離すと配置を確定します。太い枠が出た後もスライドするとタコ確定を解除して `×` のドラッグ入力へ切り替わります。ドラッグ開始前に盤面外へ動かすと何も入力せずキャンセルできます。`×` があるマスでは先にタップで `×` を外してください。誤配置は固定された赤い `×` になります。
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

オフラインでのプレイには API の起動は不要です。履歴の同期やランキングをローカルで試すときは、kan-game.app の ID 基盤（[kan/game](https://github.com/kan/game)）も一緒に動かします。ID の発行、名前の登録、引き継ぎコードはそちらが担います。

1. kan/game をこのリポジトリの隣（`../game`）に置き、README のとおり準備する。別の場所なら環境変数 `KAN_GAME_DIR` で指定する

   ```bash
   cd ../game
   npm install
   npm run generate-key -- --dev-vars   # .dev.vars にローカル用の鍵を書く
   npx wrangler d1 migrations apply DB --local
   ```

2. このリポジトリの直下に `.dev.vars` を作る（Git の管理対象外）

   ```text
   ALLOWED_ORIGINS="http://localhost:5173"
   ```

3. ローカル D1 へマイグレーションを適用し、画面を一度ビルドしてから、まとめて起動する（API の `wrangler dev` は `dist` がないと起動しない）

   ```bash
   npx wrangler d1 migrations apply tako-local --local
   npm run build
   npm run dev:all
   ```

`npm run dev:all` は kan/game の ID 基盤、API、画面を、それぞれ空いているポートで起動します。API は wrangler の dev registry で ID 基盤につながり、ID の Cookie を kan/game の `.dev.vars` にあるローカル用の公開鍵で検証します。Vite の `/api` は API へ転送されます。ポータル（復旧コードと退会のアカウント画面）は起動時に出る kan/game の URL で開けます。

[roji](https://github.com/kan/roji) が使える環境では、`npm run dev:all` の代わりに `npm run dev:roji` を使います。空いているポートで起動し、`https://tako-sen.<roji のドメイン>` で開けます。この場合、API と ID 基盤は roji の URL を origin として受け付けるので、`.dev.vars` の `ALLOWED_ORIGINS` を書き換える必要はありません。ただし roji 経由では、画面（roji の URL）とポータル（`localhost`）のホストが違い、ID の Cookie を共有しません。ポータルでの復旧コードや退会を試すときは `npm run dev:all` で起動してください。

開いた端末には自動で ID が付きます。名前がなくても遊べ、クリアは名前を決める前から本人の履歴として同期されます。ランキングに載るのは、プレイヤー名と公開ルールへの同意を設定したあとに初めて解いた問題の、最初のクリアだけです。送信後もローカル履歴は削除しません。未送信記録は ID 別に端末へ保存し、再接続時に再送します。通信失敗時もゲーム本体は引き続き利用できます。別の端末へは引き継ぎコードで移れます。退会は kan-game.app のアカウント画面で行い、ID 基盤から呼ばれた TAKO-SEN が記録を削除します。端末のローカル履歴は残ります。仕様の正本は [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md) です。

問題共有リンクの作成にはプレイヤー名が必要で、受け取った人は ID や名前がなくても問題を開けます。盤面の公開スナップショットは正解配置を含まず、受信側で唯一解を検証します。再送しても同じ挑戦は重複しません。

オンライン履歴の表示では、取得済みの直近500件から問題別自己ベスト、期間・難易度別集計、最近のクリア時間、シード・問題 ID の絞り込みを行います。開発用 Worker で表示と絞り込みの動作を確認済みです。これらは本人だけの非公開集計であり、全ユーザーの公開ランキングではありません。

### 公開前の確認事項

公開ランキングは、プレイヤー名と公開ルールへの同意を設定した参加者の、各問題で最初にサーバーへ登録されたクリアだけを表示します。再挑戦は個人履歴には残りますが、ランキングを更新しません。個別の非公開設定はなく、退会でプレイヤー名と公開記録を削除します。自己申告の参考順位として扱います。

2026-09-28 に新仕様を開発環境へ適用しました。`0004_automatic_ranking.sql` により旧公開記録は非公開に戻り、新仕様へ自動移行・再公開されません。既存オンライン履歴は本人の個人履歴として残ります。API とフロントエンドは再デプロイ済みです。[`docs/NEXT_PHASE.md`](docs/NEXT_PHASE.md) の第5段階の実機確認後にβ公開を判断してください。

本番公開は kan-game.app への移行として進めています（[`docs/NEXT_PHASE.md`](docs/NEXT_PHASE.md)「本番リリース計画」）。

- `main` の開発環境は <https://tako-dev.kan-game.app>（Worker と D1 は `tako-dev`）、本番は <https://tako.kan-game.app> の予定です。`wrangler.jsonc` の先頭はローカル用です
- これまでの開発用 URL <https://tako-sen.kan-fushihara.workers.dev>（Clerk 版、D1 `tako-sen-dev`）は `legacy-clerk` ブランチからデプロイし、移行期間中は旧 URL として移転の案内と引き継ぎだけを行います。その環境のデプロイの記録は [`docs/DEPLOY_DEV.md`](docs/DEPLOY_DEV.md) にあります

## テスト

```bash
npm test
# 大量監査だけを手動実行する場合
npm run test:audit
# 大量監査を含む全テスト
npm run test:full
```

通常の `npm test` は盤面生成の代表24ケース（各難易度8seed）を検証します。旧Generatorの互換性など、その他の回帰テストも引き続き実行します。大量監査では従来の256ケース（初級128・中級64・上級64）について、唯一解・定石での解決・再現性・多様性・難易度分布を検証します。

フルテストは基本的に GitHub Actions の CI で実行します。各ブランチへのpushと手動実行で `npm ci`、`npm run test:full`、型チェックを含むビルドを行います。デプロイやCloudflareの秘密情報は不要です。Generator・Solverの変更や不具合調査時には、必要に応じてローカルでも大量監査を実行してください。既知の不具合seedは通常テストの回帰ケースに残します。

## 型チェック

```bash
npm run typecheck
```

## ビルド

```bash
npm run build
```

## タコアイコン

`public/tako.svg` が盤面・遊び方・favicon共通の原本です。図案を変更したら、PNGも再生成します。現在の開発依存にはWrangler経由で `sharp` が含まれています。

```bash
node --input-type=module -e '
import sharp from "sharp";
await sharp("public/tako.svg").resize(32, 32).png().toFile("public/favicon-32.png");
await sharp("public/tako.svg").resize(180, 180).flatten({ background: "#fff7ec" }).png().toFile("public/apple-touch-icon.png");
'
```

## 設計メモ

パズルのコアロジックは Vue や DOM から独立した pure TypeScript として実装する方針です。

ゲーム仕様の正本は [`docs/DESIGN.md`](docs/DESIGN.md) です。ゲームルール、Solver、Generator、ヒント、操作体系などに関わる変更では、まずこの文書を確認してください。
