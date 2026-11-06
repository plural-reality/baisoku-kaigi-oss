# 倍速会議 (Baisoku Kaigi / Cartographer)

参加者の認識を集めて可視化し、合意形成を助ける Web アプリケーションです。LLM が論点(ステートメント)を作り、参加者が 5 段階評価と自由記述で答え、合意点・相違点・不明点をレポートにまとめます。

合同会社多元現実が開発し、[GNU Affero General Public License v3.0](./LICENSE) で公開しています。自治体・団体・個人が、調達や契約なしに自分の環境で動かせることを目指しています。

> Baisoku Kaigi ("double-speed meeting") collects and visualizes how participants see an issue, then uses an LLM to report agreements, disagreements and open questions. Licensed under AGPL-3.0. The setup guide below is in Japanese; the environment variables are documented in English in [`.env.example`](./.env.example).

## 主な機能

- **セッション作成**: 目的と背景情報から、LLM が問い(ステートメント)を作る
- **回答収集**: 参加者は 5 段階評価と自由記述で答える
- **管理画面**: 回答状況をリアルタイムで確認する
- **分析レポート**: 合意点・相違点・不明点を LLM がまとめる
- **個人レポート**: 参加者ごとの回答傾向を返す
- **ユーザーマップ**: PCA で参加者の立ち位置を可視化する
- **日本語 / 英語**: `messages/ja.json`・`messages/en.json`

## 技術スタック

| レイヤー | 技術 |
| --- | --- |
| Frontend / API | Next.js 15 (App Router) + React 19 + TypeScript |
| UI | Tailwind CSS 4 + Radix UI |
| Database | Supabase (PostgreSQL + Realtime) |
| LLM | OpenRouter API(既定モデルは `app/lib/llm.ts`) |
| 認証(任意) | WorkOS AuthKit |
| Backend(任意) | Haskell (Servant + Polysemy + Project:M36) |
| Build | npm / Nix Flakes |
| Test | Vitest / Playwright / Biome |

## 自分で立ち上げる

### 必要なもの

- Node.js 20 以上と npm
- Docker(ローカルの Supabase を動かすため)
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [OpenRouter](https://openrouter.ai/) の API キー
- (任意)Nix 2.18 以上(flakes 有効)— Haskell backend も含めた全体を起動する場合

### 1. 依存を入れる

```bash
git clone <this repository>
cd <repository>
npm ci
```

### 2. データベースを起動する

```bash
supabase start      # supabase/config.toml の設定で起動(API: 55321, DB: 55322)
supabase db reset   # supabase/migrations を適用
```

`supabase start` の出力に表示される `API URL`・`anon key`・`service_role key` を次の手順で使います。

### 3. 環境変数を設定する

```bash
cp .env.example .env.local
```

`.env.local` に最低限次の 4 つを入れます。

| 変数 | 値 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `supabase start` の API URL(既定 `http://127.0.0.1:55321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase start` の anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase start` の service_role key |
| `OPENROUTER_API_KEY` | OpenRouter の API キー |

### 4. 起動する

```bash
npm run dev         # http://localhost:3000
```

### Nix で全体を起動する(任意)

Supabase・Haskell backend・frontend・エージェントをまとめて起動します。

```bash
nix develop         # 開発シェル
nix run .#default   # process-compose でローカル開発トポロジーを起動
```

詳しくは [`local-dev.md`](./local-dev.md) と [`GUIDE_ja.md`](./GUIDE_ja.md) を参照してください。

### 本番相当で動かす

```bash
npm run build
npm run start
```

`nix build .#cartographer-frontend` は Next.js の standalone ビルドと、起動時に `env-contract.json` を検証するランチャーを作ります。必須の変数が欠けていると起動しません。

公開環境で動かすときは、少なくとも `PARTICIPANT_TOKEN_SECRET` を設定してください(参加者トークンの署名鍵)。多元現実が運用している本番環境のデプロイ設定(インフラ定義・サーバー設定)はこのリポジトリに含めていません。

## 環境変数

ランタイムの環境変数は [`env-contract.json`](./env-contract.json) が正本です。各変数の意味と既定値は [`.env.example`](./.env.example) に書いています。秘密情報(API キー・service role key・署名鍵)はすべて環境変数で渡し、リポジトリには置きません。

| 変数 | 必須 | 秘密 | 用途 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ○ | | Supabase の URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ○ | | Supabase の公開キー |
| `SUPABASE_SERVICE_ROLE_KEY` | ○ | ○ | サーバー側の特権アクセス |
| `OPENROUTER_API_KEY` | ○ | ○ | LLM 呼び出し |
| `OPENROUTER_API_URL` | | | LLM エンドポイントの差し替え |
| `PARTICIPANT_TOKEN_SECRET` | 推奨 | ○ | 参加者トークンの署名鍵 |
| `PARTICIPANT_TOKEN_ENFORCE` | | | `false` で旧形式トークンを受け付ける(移行用) |
| `PARTICIPANT_TOKEN_RATE_LIMIT_PER_MIN` | | | トークン発行の IP ごとの上限(既定 30/分) |
| `USER_ALIAS_SECRET` | | ○ | ユーザー ID 別名の HMAC 鍵 |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | | ○ | Server Action ID をビルド間で固定する鍵 |
| `NEXT_PUBLIC_SITE_URL` | | | 公開 URL(OGP など) |
| `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` / `WORKOS_COOKIE_PASSWORD` | 3 つ揃えるか全部空 | ○(後ろ 2 つ) | WorkOS AuthKit でのログイン |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | | | WorkOS の callback URL |
| `WORKOS_LEGACY_CLAIM` | | | 旧アカウント移行用 |
| `NEXT_PUBLIC_AUTH_SUPABASE_URL` / `NEXT_PUBLIC_AUTH_SUPABASE_ANON_KEY` / `AUTH_SUPABASE_SERVICE_ROLE_KEY` | | ○(最後) | 旧 Supabase Auth からの移行期間のみ |
| `HASKELL_BACKEND_URL` | | | Haskell backend の URL(既定 `http://localhost:8080`) |
| `DATABASE_URL` / `M36_DATA_PATH` | | ○(前者) | Haskell backend の接続先とデータ保存先 |
| `ALLOWED_IPS` | | | IP 許可リスト(カンマ区切り) |
| `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` / `BASIC_AUTH_REALM` | | ○(パスワード) | Basic 認証 |
| `CSP_MODE` | | | `report-only` で CSP を観察モードにする |
| `EMBED_FRAME_ANCESTORS` | | | `/embed/*` を埋め込める origin(空白区切り) |
| `NEXT_PUBLIC_SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | | | エラー監視(Sentry) |
| `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` | | ○(トークン) | ビルド時のソースマップ送信 |
| `NEXT_PUBLIC_UMAMI_URL` / `NEXT_PUBLIC_UMAMI_WEBSITE_ID` | | | アクセス解析(Umami) |
| `LLM_PROVIDER` / `SURVEY_STATEMENTS_MODEL` | | | ローカル開発専用。本番では設定しない |

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド |
| `npm run agent` | Ptolemy エージェント(生成処理)を起動 |
| `npm run lint` | Biome と文言チェック |
| `npm run test:unit` | Vitest |
| `npm run test:e2e` | Playwright |
| `nix flake check` | Nix のチェック |

## ディレクトリ構成

```
├── app/          # Next.js(ページ・API ルート・コンポーネント・ライブラリ)
├── agents/       # Ptolemy エージェント(問いとレポートの生成)
├── backend/      # Haskell backend(Servant + Polysemy + Project:M36)
├── messages/     # 日本語・英語の文言
├── supabase/     # マイグレーションとスキーマ
├── tests/        # E2E・結合・スモークテスト
├── middleware.ts # Basic 認証・IP 制限
├── env-contract.json
└── flake.nix
```

## ライセンス

Copyright (C) 2025-2026 合同会社多元現実 (Plural Reality LLC)

このプログラムは [GNU Affero General Public License v3.0](./LICENSE) のもとで配布しています。改変したものをネットワーク越しに利用者へ提供する場合は、AGPL 第 13 条に従い、その利用者に対応するソースコードを提供してください。

「倍速会議」の名称とロゴは多元現実の表示です。改変版を提供するときは、多元現実が提供するサービスと誤認されない名称を使ってください。

## 連絡先

合同会社多元現実 — https://www.plural-reality.com/ / info@plural-reality.com
