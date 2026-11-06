#!/usr/bin/env node
// 製品の repo にある design-system の写しを検査する。正本は plural-reality/design-system。
// このファイル自体も写しで、製品の repo では scripts/check-design-system-copy.mjs に置く。直すときは正本を直す。
//
// 調べること:
//   1. 写しの各ファイルが design-system.lock.json に記録したハッシュと同じか（写し側で手直ししていないか）。
//      正本を読まないので、design-system を読めない CI でも回る。
//   2. 正本（design-system の checkout）があれば、写しが正本より古くないか。無ければ飛ばす。
//
// 使い方:
//   node scripts/check-design-system-copy.mjs [--self-only] [--design-system <dir>] [製品の repo ...]
//   製品の repo を省くと今いる場所。正本の場所の既定は $DESIGN_SYSTEM、無ければ ~/Developer/plural-reality/design-system。
//   --self-only を付けると 2 を飛ばす（CI 用）。
// 終了コード: 0 = 問題なし / 1 = 違いがある / 2 = 使い方の誤り・lock が読めない
// Node.js の標準ライブラリだけで動く。
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCK = "design-system.lock.json";

const parseArgs = (argv) => {
  const i = argv.indexOf("--design-system");
  const rest = argv.filter((a, k) => a !== "--self-only" && k !== i && k !== i + 1);
  return {
    selfOnly: argv.includes("--self-only"),
    designSystem: resolve(
      i === -1 ? process.env.DESIGN_SYSTEM || join(homedir(), "Developer/plural-reality/design-system") : argv[i + 1] ?? "",
    ),
    products: rest.length === 0 ? ["."] : rest,
  };
};

export const hashOf = (buf) => `sha256-${createHash("sha256").update(buf).digest("hex")}`;

// 部品の置き場所は既定で src/components/pr/。src/ を使わない製品（倍速会議は app/components/）は
// lock の componentsDir で変える。登録簿の target をその製品での場所に読み替える。
const DEFAULT_COMPONENTS_DIR = "src/components/pr";
export const targetIn = (lock, target) =>
  lock.componentsDir && target.startsWith(`${DEFAULT_COMPONENTS_DIR}/`)
    ? `${lock.componentsDir}${target.slice(DEFAULT_COMPONENTS_DIR.length)}`
    : target;

const hashFile = (path) => (existsSync(path) ? hashOf(readFileSync(path)) : null);

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`読めない: ${path}（${e.code ?? e.message}）`);
    process.exit(2);
  }
};

// 1. 写しが lock と同じか
const selfProblems = (product, lock) =>
  Object.entries(lock.items).flatMap(([name, item]) =>
    Object.entries(item.files).flatMap(([target, hash]) => {
      const actual = hashFile(join(product, target));
      return actual === null
        ? [`消えている: ${target}（${name}）`]
        : actual !== hash
          ? [`写し側で変わっている: ${target}（${name}）。写しは直さず、正本を直してから写し直す`]
          : [];
    }),
  );

// 2. 写しが正本より古くないか
const staleProblems = (designSystem, lock) => {
  const registry = readJson(join(designSystem, "registry.json"));
  const byName = new Map(registry.items.map((it) => [it.name, it]));
  return Object.entries(lock.items).flatMap(([name, item]) => {
    const canonical = byName.get(name);
    if (!canonical) return [`正本に無い項目: ${name}`];
    const files = canonical.files.map((f) => ({ ...f, target: targetIn(lock, f.target) }));
    const targets = new Set(files.map((f) => f.target));
    const added = files.filter((f) => !(f.target in item.files)).map((f) => `正本で増えたファイル: ${f.target}（${name}）`);
    const removed = Object.keys(item.files).filter((t) => !targets.has(t)).map((t) => `正本で消えたファイル: ${t}（${name}）`);
    const changed = files
      .filter((f) => f.target in item.files && hashFile(join(designSystem, f.path)) !== item.files[f.target])
      .map((f) => `正本が先に進んでいる: ${f.target}（${name}、写した版 ${item.commit.slice(0, 7)}）`);
    return [...added, ...removed, ...changed];
  });
};

const checkProduct = ({ selfOnly, designSystem }) => (product) => {
  const lock = readJson(join(product, LOCK));
  const self = selfProblems(product, lock);
  const canCompare = !selfOnly && existsSync(join(designSystem, "registry.json"));
  const stale = canCompare ? staleProblems(designSystem, lock) : [];
  const items = Object.keys(lock.items).join("、");
  const note = selfOnly ? "正本との比較は飛ばした（--self-only）" : canCompare ? `正本 ${designSystem} と比べた` : `正本 ${designSystem} が無いので、正本との比較は飛ばした`;
  const problems = [...self, ...stale];
  const hint = stale.length > 0 ? [`  写し直すには、製品の repo で npm run ds:pull（正本の checkout からなら pnpm ds:copy ${resolve(product)}）`] : [];
  console.log(
    problems.length === 0
      ? `OK: ${product} の写し（${items}）。${note}`
      : [`NG: ${product} の写し（${note}）`, ...problems.map((p) => `  ${p}`), ...hint].join("\n"),
  );
  return problems.length === 0;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const results = opts.products.map(checkProduct(opts));
  process.exit(results.every(Boolean) ? 0 : 1);
}
