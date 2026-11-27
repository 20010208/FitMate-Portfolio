# FitMate — 筋トレ・食事・体重をまとめて管理するWebアプリ

**公開サービス:** https://www.fitmate.run/

FitMateは、筋トレ・食事・体重の記録を一元管理する個人開発のWebアプリです。2026年5月に公開し、機能改善・保守運用を継続しています。採用選考で実際の設計・実装をご確認いただくため、ソースコードの一部を公開しています。

> ※本リポジトリは作品紹介用の公開版です。本番環境の認証情報やユーザーデータは含まれていません。

## 主な機能

- **トレーニング記録:** 種目、重量、回数、セット数の入力と履歴管理
- **食事・栄養管理:** カロリーとPFC（たんぱく質・脂質・炭水化物）の記録
- **AIによる食事解析:** 食事写真からカロリー・栄養素の記録を補助
- **運動の消費カロリー推定:** 入力したトレーニングの内容をAIで推定
- **体重管理:** 体重・体脂肪率の推移をグラフで表示
- **ユーザー認証:** アカウントごとのデータ管理、ゲスト利用
- **サービス運用:** レスポンシブ対応、ブログ、SEO・構造化データ

## 技術スタック

| 分野 | 使用技術 |
| --- | --- |
| フロントエンド | Next.js 16（App Router）、React 19、TypeScript |
| UI | Tailwind CSS 4、Recharts、Lucide |
| 認証・データベース | Supabase Auth、PostgreSQL（RLS） |
| AI | OpenAI API |
| デプロイ | Vercel |
| 開発・検証 | Node.js 24、ESLint、TypeScript、Node.js Test Runner、Vitest |

詳細なバージョンは `package.json` を参照してください。

## 設計・実装で工夫したこと

1. **データの分離:** Supabase AuthとPostgreSQLのRLSで、ユーザーごとの食事・体重・運動記録を管理。
2. **AI APIの安全対策:** サーバー側で認証と入力検証を行い、データベース側でAI機能の利用枠を管理。秘密鍵をクライアントに公開しない設計。
3. **写真の保護:** ユーザーごとの保存パスを検証し、非公開Storage内の写真を期限付きURLで取得。
4. **保守・品質:** lint、型チェック、テスト、CIによって変更の安全性を確認。
5. **継続運用:** 個人で企画から公開・改善まで担当。AI開発支援ツールも要件整理・実装・検証に活用。

## ローカル実行

Node.js 24とnpmが必要です。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

※認証・データベース・AIなど一部機能の実行には、外部サービスの設定が必要です。

## テスト・検証

```bash
npm run lint
npm run typecheck
npm test
npm run test:ai
```

## 関連リンク

- **公開サービス:** https://www.fitmate.run/
- **GitHub:** このリポジトリ（採用選考・作品紹介用の公開版）

---

© 2026 FitMate project. This repository does not include an open-source license.
