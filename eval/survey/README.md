# 日本語賛否文のオフライン評価

Gemini候補PR #378 の合成入力3件と比較手順を拡張する。同じ本番prompt builderと
モデル設定関数から現行3.5 / 候補3.8の40レコードを準備する。別のpromptは作らない。
`validate` / `prepare` / `score` はモデルAPIや外部judgeを呼ばない。
有料の生成は `run.ts`、人手の判定は `review/` のGUIで別に行う。自動のLLM judgeはない。

## 無課金の入口

repoルートで実行する。prepareはJSONを標準出力へ返す。
scoreは保存応答のJSON配列をファイルまたは標準入力から読み、標準出力へ返す。

```sh
npx tsx eval/survey/cli.ts validate
npx tsx eval/survey/cli.ts prepare
npx tsx eval/survey/cli.ts score responses.json
# または responses.json の内容を stdin で渡す
npx tsx eval/survey/cli.ts score -
# 生成runのディレクトリを判定ごと採点する（後述）
npx tsx eval/survey/cli.ts score --run eval/survey/results/<run>
npx vitest run agents/__tests__ eval/survey/__tests__ --maxWorkers=2
```

prepareの各entryは、本番の `surveyStatementsMessages` と `surveyStatementsCallOptions` から
`openRouterRequestBody` で組んだリクエスト本体 `request` をそのまま持つ。
system guard、temperature、reasoning、strictなJSON schemaの `response_format`
（`{"statements": [...]}`）まで本番と同じ。`options` に `responseFormat` が入るため、
optionsHashもresponse_formatの変更を検出する。`requestHash` は監査用に記録する。

入力0件なら40件すべて `unmeasured`。これを合格率0%の実測として使わない。
再現には同じcheckoutを使う。sourceにはGit HEADと関連ソースの内容hashを記録するため、
未コミットの変更があると同じHEADでもhashが変わる。

## データと判定

`dataset.ts` は版 `ja-survey-v1` の20合成ケース。先頭3件は候補PRのJSONを参照する。
否定、訂正、少数意見、誘導、二重否定、条件付き意見、時間軸、個人と公共、
二重質問、発言帰属、不確実性、因果、指示語、アクセス、費用対便益、意味重複、
入力内の命令を含む。caseごとに必要/禁止条件、根拠、許容文の例、失敗文と違反条件がある。
例文は説明用の1文であり、唯一の正解や15件バッチの品質保証ではない。
テストは例への合成判定を処理する能力を調べるもので、意味を自動理解している証拠ではない。

機械判定はHTTP成否、parser受理、本番で保存可能な構造、要求した15件への適合を別々に出す。
parserは本番の `parseStatementList` と同じで、構造化された `{"statements": [...]}` と
素の配列を先に読み、どちらでもなければ `extractJsonArray` の緩い解釈へ落ちる。
`structuredAccepted` は前者で読めたか（strict出力が守られたか）を示す。
本番は従来どおり1〜14件も受け付け、上限15件で保存する。評価では15件への適合を別条件にする。
コードフェンスや箇条書きは既存parserが解釈する。この判定器は生JSONの厳密形式を採点しない。

意味判定は共通rubricとcase固有rubricのすべてについて、異なるIDの判定者を2名以上必要とする。
各判定者は `pass / fail / unrated` と、生成文の該当箇所および根拠を記録する。
判定者IDの相違は人の独立性を証明しないため、運用側で独立に判定する。
未入力・条件欠落・根拠欠落・同じ判定者IDは `unreviewed`、判定の不一致は `disagreement`。
全判定者が全条件をpassとし、構造とHTTPも合格したときだけ `pass`。
機械的なtrim後の一意性は、意味の一意性の証拠にはしない。

## 生成（有料）: run.ts

```sh
set -a; . ./.env.local; set +a   # OPENROUTER_API_KEY を読む
npx tsx eval/survey/run.ts --out eval/survey/results/$(date +%Y-%m-%d)-baseline
#   [--max-calls 40] [--max-usd 2] [--concurrency 2] [--allow-dirty]
```

40 entry（20 case × 2設定）を1回ずつ、manifestの `request` のままOpenRouterへ送る。
送信は本番の `sendOpenRouterRequest`（同じheader、45秒timeout、`withRetry` と
`withLLMLimit`）を通す。`LLM_PROVIDER` のローカルCLI経路は使わない。
`<dir>/manifest.json` と `<dir>/responses.json` を書く。応答ごとにresponses.jsonを
原子的に書き直すため、中断しても完了分は残る。既存のresponses.jsonは上書きしない。

- 費用: Flash 2設定×40回で1ドルを大きく下回る見込み。実額は各レコードの `costUsd`
  （`usage.cost`、無ければ `/generation` の `total_cost`）と終了時の集計で確認する。
- 予算ガード: 各entryの前に `/api/v1/credits` を読み、残高が1ドル未満か、
  支出が `--max-usd`（既定2ドル）以上なら以降を送らない。支出は「開始時からの残高の減り」と
  「終わった呼出しの `usage.cost` の合計」の大きい方（残高の反映は遅れるため）。
  同時実行中の呼出し分だけ上限を超えうる。残高を読めない場合も止める。
- `--max-calls` はentry数の上限。本番の `withRetry` で1 entryは最大5回の課金対象の試行になるため、
  費用の上限は `--max-usd` で決める。試行回数は各レコードの `attempts` と集計の `totalAttempts` に残る。
- 失敗: 非2xxやtimeoutは本番の再試行の後、`httpStatus`（応答が無ければnull）と
  `errorCode` を持つレコードとして残す。無限に再試行しない。
- 再現: 未コミットの変更があると拒否する（`--allow-dirty` で解除）。sourceHashは
  `source.ts` の `SOURCES` の内容hash。`score --run` はrunの `manifest.json` を基準に照合するので、
  生成後のコミットでrunが無効にはならない（差分は `liveSourceDrift` に出る）。
- APIキーはログにもファイルにも書かない。顧客情報は扱わない。
- 試行の繰返しは1組ずつ別の `--out` に分けて採点する。
  同じcase/modelを1ファイルに重複させると `invalid_record` になる。

各応答レコードは次の形（run.tsはこれに `requestHash`, `generationId`, `servedModel`,
`finishReason`, `usage`, `costUsd`, `latencyMs`, `createdAt` を足す）。
hashはprepareから転記する。判定者は応答とrubricを読んだ時点で
outputHashに `digest(rawContent)`、rubricHashに `digest(entry.criteria)` を記録する。
digestはJSON.stringifyした値のSHA-256である。判定後に応答やrubricが変わると
意味評価はunreviewedへ戻る。

```json
{
  "caseId": "library",
  "model": "google/gemini-3.5-flash",
  "caseHash": "prepareのcaseHash",
  "promptHash": "prepareのpromptHash",
  "datasetHash": "prepareのdatasetHash",
  "sourceRevision": "prepareのsource.revision",
  "sourceHash": "prepareのsource.hash",
  "optionsHash": "prepareのoptionsHash",
  "httpStatus": 200,
  "rawContent": "モデルの生テキスト",
  "judgments": [
    {
      "judgeId": "独立した判定者のID",
      "outputHash": "digest(rawContent)",
      "rubricHash": "digest(entry.criteria)",
      "criteria": [
        { "id": "yes-no", "verdict": "pass", "evidence": "該当文と判断根拠" }
      ]
    }
  ]
}
```

上の短縮例は判定者も条件も不足しているため合格しない。
全条件IDはprepareの各entry.criteriaに含まれる。
版が違う応答は `invalid_record`、HTTP失敗や不正構造は `fail`。
未知case/modelはunknownRecordsに計上し、捨てて成功率を上げない。
料金や速度の集計はこのCLIの対象外。元の計測記録で別途比較する。

## 人手判定のGUI: review/

```sh
npx tsx eval/survey/review/server.ts --run eval/survey/results/<run> --judge <id>
#   [--port 4310] [--host 127.0.0.1] [--allow-host <name>]
# → http://127.0.0.1:4310/
```

依存追加なしのNode `http` と1枚のHTML。既定で127.0.0.1だけにbindし、Host/Originを検査する。
読むのはrunディレクトリのmanifest.json・responses.jsonと `review/index.html` だけ。
書くのは `<run>/judgments/<id>.json`、`<run>/preferences/<id>.json`、
`<run>/blinding/<id>.json`（盲検の乱数seed）だけで、tmpファイルとrenameで原子的に書く。
judge IDは `[a-z0-9_-]+`。モデルの出力はtextContentで描画し、CSPで外部通信を禁じる。

1ケース1画面（20画面）。判定は「例外だけを記録する」流れにしている。問題のない出力に
観点ごとのクリックは要らない。上から、ケースの入力（イベントスレッド原文は折畳み）、
「このケースで特に見る点：」（case固有の条件）と較正用の許容例・失敗例、
観点の説明（最初のケースだけ開き、以後は折畳み）、2つの出力の文を左右に並べた表、出力ごとの確認欄。
画面下に固定のバーがあり、特に見る点・好み・「確定して次へ」を置く。

左右は「出力A」「出力B」とだけ表示する。左右はjudgeごとの乱数seedで決め、
各モデルがちょうど半数（20件なら10件ずつ、奇数なら差1）で左になるよう割り当てる。
最初の起動時にケースごとの左右を `blinding/<id>.json` に保存し、以後はそれを使う。
同じjudgeには毎回同じ順、別のjudgeには独立な順になる。モデル名と対応表はサーバー外へ出さない。
解析できない・実行時検証に落ちる・15件でない出力には「構造エラー」と各チェックを出し、生の出力も見られる。
もう一方の出力にほぼ同じ文があれば「AとBで共通」と小さく示し、文字を薄くする。
条件は、記号・空白・全半角を除いた文字bigramのDice係数が0.9以上で、否定・賛否の語
（ない・ず・反対・不・非・無・禁止・廃止・やめ・賛成・推進・支持）の組と数字が一致すること。
「すべきである」と「すべきではない」は0.88前後まで似るため、語の組で必ず区別する。
共通の文も隠さない。隠した行が確認でまとめて合格になるのを避けるため、薄く表示するだけにした。

上部でモードを選ぶ（ブラウザごとに記憶）。完了と進捗はモードごとに数える。

- かんたん（どちらが良いかだけ）: 好みを選べば完了。1ケース約20秒。気になる文の指摘は任意。
  このモードだけでは合否（pass/fail）の採点に使う判定は揃わない。
- しっかり（問題の文を指摘）:
  - 文ごとの指摘: 問題のある文をクリック（またはJ/Kで選んでF、数字キーで文番号）すると、
    理由のチップが開く。共通の観点は「賛否で答えにくい」(yes-no)・「意味があいまい」(standalone)・
    「入力にない事実を前提」(grounded)・「誘導・決めつけ」(neutral)・「重複」(novelty)。
    これにcase固有の禁止条件（例:「未調査を確定扱い」）が加わる。チップを選ぶと
    その観点がその出力で不合格になり、根拠は `#n`（複数なら追記、ひとことメモ付き）。
    もう一度開いてチップを外すか「指摘を外す」で取り消せる。
  - 15文全体の質問: diverseとcase固有の必須条件。既定は「満たす」で、違うときだけ「満たさない」を押す。
    押すと理由欄が開く。理由欄にカーソルがある状態で文をクリックすると、1回だけ `#n` が入る
    （理由は任意）。次のクリックは通常どおり指摘の選択肢を開く。「保留」も選べる。
  - 確認: 「この出力は確認済み」または「確定して次へ」（両方の出力をまとめて確認）で、
    指摘していない観点をすべて合格にする。根拠は従来の既定文
    （「15文を確認し該当なし」／「15文を確認し満たす」。文数は実際の数）。確認していない出力は未完了のまま。
    保留（「保留」ボタン、または観点ごとの保留）は確認しても合格にならず、根拠（「判断保留」など）も残る。
    保留がある出力は「保留あり」と表示し、そのケースは未完了のまま。解除すれば確認で合格になる。
  - 「観点ごとに細かく見る」（折畳み）で、観点ごとの合格・不合格・保留を直接上書きできる。
    優先順は「文の指摘・全体の回答」＞「直接の指定（保留を含む）」＞「確認による合格」。

保存形式は変えていない。judgmentsの `criteria` には上の操作から導いた観点ごとの合否が入り、
`score` はそれだけを読む。操作そのもの（指摘、全体の回答、確認、上書き）は同じレコードの
`review` に残す。`review` の無い以前の判定（観点ごとに押した形式）は、各観点の合否と根拠を
そのまま直接の指定として読む。根拠つきの保留（「判断保留」）は保留のまま表示し、根拠の無い未判定だけを
「未確認」とする。読み込んだだけでは何も書き換えない。
ページは、サーバーにある内容から変わったときだけ判定・好みを保存する（判定と好みは別々に比べる）。
ケースを開いて移動しただけでは保存しないので、以前の判定の根拠や更新時刻は、その観点を変えない限り元のまま。
判定の集計（観点ごとの合格率）と判定者間の一致率には、確認した判定と以前の形式の判定だけを使う。
かんたんモードで付けた指摘のように確認していない判定は、「確認していない判定」として件数だけ数える。

判定は2種類あり、目的が違う。

- 条件ごとの合否（judgments）: 上のしっかりモードの結果。#379の形式そのもので、
  `score` の `pass/fail/disagreement` になる。版をまたいだ絶対的な回帰確認と、
  将来のLLM judgeの較正データに使う。出力ごとの「気づいたこと」は、後で失敗の型を分類するための自由記述。
- 一対比較（preferences）: 「参加者に出すなら、どちらの15文を使いたいか」を A / B / 同等で選ぶ。
  任意の理由チップ（論点が広い・表現が中立・重複が少ない・具体的）は `reasonTags`、
  自由記述は `reason` に入る。モデルやpromptの選択に使う。保存時にサーバーがモデルIDへ戻し、
  比較した2出力のhashと共に記録する。どちらかの出力が変わると数えない。

操作: ←→ ケース、J/K 文、H/L 出力A・B、数字 文番号（チップが開いているときはチップ）、
F 指摘、Esc 閉じる、A/B/T 好み、C 確認済み、⌘/Ctrl+Enter 確定して次へ。入力欄にいる間はキー操作を止める。
操作のたびに自動保存する。何も入力していない出力にはレコードを作らない。
画面上部に、このブラウザで完了したケースの所要時間の中央値から見積もった残り時間を出す。
保存は判定ごとに1件ずつ順に送り、各保存は直前に読んだ版（`baseUpdatedAt`）を添える。
別のタブで先に保存されていれば409になり、画面は最新を読み込んで
「別のタブで更新されました。最新を読み込みました」と出す。自分の変更は捨てずに残し、
「自分の未保存の変更を再適用」で上書きできる。入力中の下書きはブラウザ（localStorage）にも残り、
ページを閉じるときは保留中の保存をkeepaliveで送る。
「未完了のみ」で残りだけを巡回できる。
「好みの集計だけ見る」はモデル名を伏せたまま、ケースごとに選んだ側（出力A＝左／B＝右／同等）と
その合計を出す。ページの状態を読むだけで、盲検を解かずロックもしない。
「集計（モデル名を表示）」は、選んでいるモードで全20ケースが完了したときだけ開ける
（判定中の先入観を避けるため）。開くと `POST /api/unblind` を送る。モデル名を出す状態変更はこの1つだけで、
Origin・Host・JSONを検査するため、別サイトのページや先読みからは起こせない。`GET /api/summary` は
読むだけで、盲検を解く前は403を返す。かんたんモードで開くときは、この後しっかり判定も保存できなくなる
ことを示し、「ロックする」と入力しないと進まない。
集計を最初に開いた時刻を `blinding/<id>.json` の `unblindedAt` に記録し、以後そのjudgeの
判定と好みの保存は409で拒否する（画面もロック表示になる）。盲検が解けた後の修正を混ぜないため。
解除の手段は用意していない。

### 2人で分担する

`semantic` が `pass` になるには、異なるjudge ID 2名以上の全条件の判定が要る。
各自が別のIDで同じrunの全20ケースを判定する（同じrunディレクトリを共有するか、
各自のjudgments/・preferences/ を後で1つのrunへ集める）。互いのファイルは読まない。
judge IDの違いは人の独立性を証明しないので、判定中に相談しない運用で担保する。

### 採点

```sh
npx tsx eval/survey/cli.ts score --run eval/survey/results/<run>
```

runの `manifest.json`・responses.json・全judgeの判定ファイルを読み、各判定を対応する応答に付けて
#379 の採点を行う。由来の照合はrunの `manifest.json` が基準で、今のcheckoutが組むmanifestとの違い
（revision、sourceHash、datasetHash、entryごとのcaseHash・promptHash・optionsHash・requestHash・rubric）は
拒否せず `liveSourceDrift` に警告として出す。`score responses.json` の従来の形は今のcheckoutで照合する。
outputHash・rubricHashが出力・rubricと合わない判定は `unreviewed` のまま。
`summary.byStatus` に状態ごと（pass / fail / disagreement / unreviewed / invalid_record / unmeasured）の件数を出す。
加えて `review` に次を出す。

- `agreement.common`: 共通6条件ごと・judgeの組ごとの一致率とCohenのκ。両者が合格/不合格を付けた項目
  だけを数え、保留は除く。全員が同じ値しか付けていない場合、κは定義できないのでnull。
- `agreement.caseSpecific`: case固有条件は同じID（`case:context` など）でもcaseごとにルールが違うので
  合算せず、`<caseId>:<criterionId>` ごとに出す。各nは最大でモデル数（2）なので目安にとどめる。
- `preferences.byModel`: モデルごとの勝ち・負け・同等と勝率（同等は0.5勝）。
- `preferences.positionBias`: 左（出力A）に表示した側の勝率。0.5から大きくずれるなら位置の偏りを疑う。
- `preferences.interJudge`: 同じcaseを複数judgeが比べたときの、judgeの組ごとの勝者の一致率。

## 保存前の保証と範囲

`validateSurveyStatements` は空配列、空白だけの要素、文字列以外、trim後の完全重複を
バッチ全体で拒否する。選別して一部だけ保存することはしない。
PtolemyAgentは生成失敗時に新しいeventだけを失敗表示にし、append RPCも
COLLECTING_SURVEYへの遷移も行わない。前回のstatementsとstate_payloadは保持する。
transport再試行は従来の有限回数のまま。内容不正では再試行せずidleを返し、
AgentManagerはtransitionedだけを即時再投入する。後日の外部イベントや再起動による再実行は従来どおり。

既存previewの再利用、過去に保存済みの無効データの清掃、Web側の独立生成経路、
意味重複の完全自動検出、DB・認証変更は対象外。
