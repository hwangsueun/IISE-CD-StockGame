// JSONL 로더 (NEWS_DATA_CONTRACT.md 공통 규칙: 한 줄 = 뉴스 한 건)
const fs = require('fs');
const readline = require('readline');

/**
 * @param {string} filePath
 * @param {(objs: object[]) => Promise<void>} onBatch
 */
async function iterateJsonl(filePath, onBatch, batchSize = 1000) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, 'utf8'),
    crlfDelay: Infinity,
  });
  let batch = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    batch.push(JSON.parse(line));
    if (batch.length >= batchSize) {
      const b = batch;
      batch = [];
      await onBatch(b);
    }
  }
  if (batch.length) await onBatch(batch);
}

module.exports = { iterateJsonl };
