# TAKO-SEN

TAKO-SEN は、Star Battle 系のパズルをベースにした、スマートフォン向けのロジックパズルゲームです。

各行・各列・各 Region にタコを1匹ずつ配置し、タコ同士が上下左右・斜めに接触しないように解いていきます。

## 開発状況

このリポジトリは現在開発中です。

現時点では、基本ゲームを最後までプレイできる最小プロトタイプを実装しています。UI、ヒント、問題生成、難易度制御、視認性、快適さなどは今後改善していく予定です。

詳細な設計方針は [`docs/DESIGN.md`](docs/DESIGN.md)、直近の実装計画は [`docs/MILESTONE.md`](docs/MILESTONE.md) を参照してください。

## 現在できること

- 8×8 盤面の表示
- Region の色分け表示
- タップによる `×` の toggle
- ロングタップによるタコ確定
- 誤ったタコ配置時の固定赤 `×`
- タコからの一括消去
- Region-Line 消去
- 基本的なヒント
- Complete Solver による唯一解検証
- seed 指定可能な初期 Puzzle Generator
- localStorage によるプレイ中状態の保存

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
