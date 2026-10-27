/**
 * 훑기 결과 두 벌 비교: npm run sweep:compare -- <전 결과 폴더> <후 결과 폴더> [--top N] [--json <파일>] [--fail-on-change]
 * 같은 내용 해시끼리 견주어 분류가 바뀐 파일 수, 지표·경고가 바뀐 해시(상위 N), 새 예외를 찍는다.
 * --fail-on-change면 바뀐 것이 있을 때 1로 끝난다(인자·파일 오류는 2).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compareRuns, formatCompare } from './lib.mjs';

const USAGE = '쓰는 법: npm run sweep:compare -- <전 결과 폴더> <후 결과 폴더> [--top N] [--json <파일>] [--fail-on-change]';

function readRecords(dir) {
  const file = join(resolve(dir), 'records.jsonl');
  if (!existsSync(file)) throw new Error(`records.jsonl이 없습니다: ${file}`);
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function main() {
  const args = process.argv.slice(2);
  const dirs = [];
  let top = 20;
  let json = null;
  let failOnChange = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--top') top = Number(args[++i]);
    else if (a === '--json') json = args[++i] ?? null;
    else if (a === '--fail-on-change') failOnChange = true;
    else if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return 0;
    } else if (a.startsWith('--')) {
      console.error(`모르는 인자: ${a}\n${USAGE}`);
      return 2;
    } else dirs.push(a);
  }
  if (dirs.length !== 2 || !(top >= 0) || (json !== null && !json)) {
    console.error(USAGE);
    return 2;
  }
  let before;
  let after;
  try {
    before = readRecords(dirs[0]);
    after = readRecords(dirs[1]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 2;
  }
  const result = compareRuns(before, after, { top });
  console.log(formatCompare(result));
  if (json) writeFileSync(resolve(json), JSON.stringify({ done: true, before: resolve(dirs[0]), after: resolve(dirs[1]), ...result }, null, 2) + '\n');
  return failOnChange && result.changed ? 1 : 0;
}

process.exitCode = main();
