// 소형 CSV 유틸 (따옴표/줄바꿈 포함 필드 지원). 대용량은 iterateCsv 사용.
const fs = require('fs');
const readline = require('readline');

/** CSV 한 줄 파싱 (RFC4180 따옴표 규칙) */
function parseLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = false;
      } else cur += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** BOM 제거 */
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * 대용량 CSV를 행 객체 배치로 순회한다.
 * 따옴표 안 줄바꿈이 있는 행도 이어붙여 처리한다.
 * @param {string} filePath
 * @param {(rows: object[]) => Promise<void>} onBatch
 * @param {number} batchSize
 */
async function iterateCsv(filePath, onBatch, batchSize = 2000) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, 'utf8'),
    crlfDelay: Infinity,
  });
  let header = null;
  let batch = [];
  let pending = '';

  const flush = async () => {
    if (batch.length) {
      const b = batch;
      batch = [];
      await onBatch(b);
    }
  };

  for await (const rawLine of rl) {
    let line = pending ? pending + '\n' + rawLine : rawLine;
    // 홀수 개의 따옴표 = 아직 필드가 닫히지 않음 -> 다음 줄과 병합
    if ((line.match(/"/g) || []).length % 2 === 1) {
      pending = line;
      continue;
    }
    pending = '';
    if (!header) {
      header = parseLine(stripBom(line)).map((h) => h.trim());
      continue;
    }
    if (!line.trim()) continue;
    const cells = parseLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] === undefined ? '' : cells[i]; });
    batch.push(row);
    if (batch.length >= batchSize) await flush();
  }
  await flush();
}

/** 소형 CSV 전체 로드 */
async function readCsv(filePath) {
  const rows = [];
  await iterateCsv(filePath, async (batch) => { rows.push(...batch); });
  return rows;
}

module.exports = { iterateCsv, readCsv, parseLine };
