// 拆文历史：把每次「拆文」运行（一次勾选多个维度的批量分析）持久化到用户数据目录。
// 只存报告与原文预览，不存全文原文（隐私 + 体积考虑）；上限 50 个 run，超出丢弃最早的。
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const DATA_DIR = join(homedir(), '.dsh', 'dsh-webnovel');
const HISTORY_FILE = join(DATA_DIR, 'history.json');
const MAX_RUNS = 50;
const PREVIEW_CHARS = 120;

let cache = null;

async function loadAll({ force = false } = {}) {
  if (cache && !force) return cache;
  let raw;
  try {
    raw = await readFile(HISTORY_FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') { cache = []; return cache; }
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed?.runs) ? parsed.runs : [];
  } catch {
    cache = [];
  }
  return cache;
}

async function persist(runs) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = join(DATA_DIR, `.history.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, JSON.stringify({ version: 1, runs }, null, 2), 'utf8');
  await rename(tmp, HISTORY_FILE);
  cache = runs;
}

// 列表元信息（不含 markdown 正文）
export async function listRuns({ page = 1, pageSize = 20 } = {}) {
  const runs = await loadAll();
  const size = Math.min(50, Math.max(1, Number(pageSize) || 20));
  const p = Math.max(1, Number(page) || 1);
  const start = (p - 1) * size;
  const items = runs.slice(start, start + size).map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    fileName: r.fileName || '',
    textPreview: r.textPreview || '',
    charCount: r.charCount || 0,
    providerId: r.providerId || '',
    model: r.model || '',
    totalDims: r.items.length,
    okCount: r.items.filter((i) => i.status === 'done').length,
    failCount: r.items.filter((i) => i.status === 'error').length
  }));
  return { items, page: p, pageSize: size, total: runs.length, hasMore: start + size < runs.length };
}

export async function getRun(id) {
  const runs = await loadAll();
  return runs.find((r) => r.id === id) || null;
}

// Client 在一次批量分析全部结束后提交完整 run
export async function saveRun(input) {
  const runs = await loadAll();
  const items = Array.isArray(input.items) ? input.items.slice(0, 30).map((i) => ({
    dimensionId: String(i.dimensionId || ''),
    dimensionName: String(i.dimensionName || i.dimensionId || ''),
    status: i.status === 'done' ? 'done' : 'error',
    markdown: typeof i.markdown === 'string' ? i.markdown : '',
    error: typeof i.error === 'string' ? i.error : '',
    elapsedMs: Number(i.elapsedMs) || 0,
    model: typeof i.model === 'string' ? i.model : ''
  })) : [];
  const text = typeof input.text === 'string' ? input.text : '';
  const run = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    fileName: String(input.fileName || '').slice(0, 200),
    textPreview: text.slice(0, PREVIEW_CHARS),
    charCount: Number(input.charCount) || [...text].length,
    providerId: String(input.providerId || '').slice(0, 60),
    model: String(input.model || '').slice(0, 120),
    items
  };
  runs.unshift(run);
  await persist(runs.slice(0, MAX_RUNS));
  return run;
}

export async function deleteRun(id) {
  const runs = await loadAll();
  const next = runs.filter((r) => r.id !== id);
  if (next.length === runs.length) return false;
  await persist(next);
  return true;
}

export async function clearRuns() {
  await persist([]);
}
