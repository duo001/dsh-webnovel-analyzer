// 热梗库：本地数据检索（分面筛选 / 搜索 / 详情 / 分页）+ AI 生成卡持久化。
// 自 v0.1.3 起插件包不分发第三方 tropes.json：
//   - 导入库：用户通过界面导入，存于用户数据目录 tropes.json（v0.1.2 包内 data/ 会自动迁移）
//   - 生成卡：AI 热梗卡生成后可保存，存于 generated-tropes.json，与导入库合并检索，origin 标记来源
import { readFile, writeFile, mkdir, rename, access, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(homedir(), '.dsh', 'dsh-webnovel');
const TROPES_FILE = join(DATA_DIR, 'tropes.json');
const GENERATED_FILE = join(DATA_DIR, 'generated-tropes.json');
// v0.1.2 旧版把数据放在包内 data/ 下，仅用于一次性迁移
const LEGACY_BUNDLED_FILE = join(HERE, 'data', 'tropes.json');

let importedCache = null; // { source, syncedAt, facets, total, tropes }
let generatedCache = null; // 数组
let migrateChecked = false;

// 列表页不下发长文本字段，控制响应体积
const LIST_FIELDS = ['id', 'title', 'oneLine', 'arc', 'mechanisms', 'genres', 'settings', 'sellingPoint'];
const FACET_LABELS = { arc: '弧线', mechanism: '机制', genre: '题材', setting: '设定' };

function notImported() {
  const err = new Error('热梗库尚未导入数据');
  err.code = 'tropes-not-imported';
  return err;
}

function parseTropesJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error('文件不是合法 JSON，请确认选择的是 tropes.json 原文件。');
    err.code = 'bad-tropes-file';
    throw err;
  }
  if (!parsed || !Array.isArray(parsed.tropes) || parsed.tropes.length === 0) {
    const err = new Error('文件结构异常：需要包含非空 tropes 数组的热梗数据文件。');
    err.code = 'bad-tropes-file';
    throw err;
  }
  return parsed;
}

// 首次访问时，把 v0.1.2 包内数据迁移到用户数据目录（迁移后删除包内副本）
async function migrateBundledIfNeeded() {
  if (migrateChecked) return;
  migrateChecked = true;
  try {
    await access(TROPES_FILE);
    return; // 用户数据目录已有数据，无需迁移
  } catch { /* 继续检查旧位置 */ }
  try {
    await access(LEGACY_BUNDLED_FILE);
  } catch {
    return; // 新旧位置都没有，保持「未导入」态
  }
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await rename(LEGACY_BUNDLED_FILE, TROPES_FILE);
  } catch {
    // 跨设备 rename 失败时退回复制
    const raw = await readFile(LEGACY_BUNDLED_FILE, 'utf8');
    await writeFile(TROPES_FILE, raw, 'utf8');
  }
}

// ---------------- 导入库 ----------------
export async function loadImported({ force = false } = {}) {
  if (importedCache && !force) return importedCache;
  await migrateBundledIfNeeded();
  let raw;
  try {
    raw = await readFile(TROPES_FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') throw notImported();
    throw err;
  }
  const parsed = parseTropesJson(raw);
  importedCache = {
    source: parsed.source || '',
    syncedAt: parsed.syncedAt || '',
    facets: parsed.facets || {},
    total: parsed.total || parsed.tropes.length,
    tropes: parsed.tropes.map((t) => ({ ...t, origin: t.origin || 'imported' }))
  };
  return importedCache;
}

// 兼容旧导出名
export const loadTropes = loadImported;

export async function tropeStatus() {
  const gen = await loadGenerated();
  try {
    const store = await loadImported();
    return {
      imported: true,
      total: store.total,
      richCount: store.tropes.filter(isRichCard).length,
      source: store.source,
      syncedAt: store.syncedAt,
      generatedCount: gen.length
    };
  } catch (err) {
    if (err && err.code === 'tropes-not-imported') {
      return { imported: false, total: 0, richCount: 0, generatedCount: gen.length };
    }
    throw err;
  }
}

export async function importTropes(jsonText) {
  const parsed = parseTropesJson(jsonText);
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = join(DATA_DIR, `.tropes.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, jsonText, 'utf8');
  await rename(tmp, TROPES_FILE);
  importedCache = null;
  const store = await loadImported({ force: true });
  return {
    total: store.total,
    richCount: store.tropes.filter(isRichCard).length,
    source: store.source,
    syncedAt: store.syncedAt
  };
}

export async function exportTropesRaw() {
  await loadImported();
  const json = await readFile(TROPES_FILE, 'utf8');
  return { json, meta: { total: importedCache.total, source: importedCache.source, syncedAt: importedCache.syncedAt } };
}

// ---------------- AI 生成卡 ----------------
async function loadGenerated({ force = false } = {}) {
  if (generatedCache && !force) return generatedCache;
  let raw;
  try {
    raw = await readFile(GENERATED_FILE, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') { generatedCache = []; return generatedCache; }
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    generatedCache = Array.isArray(parsed?.tropes) ? parsed.tropes : [];
  } catch {
    generatedCache = [];
  }
  return generatedCache;
}

async function persistGenerated(list) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = join(DATA_DIR, `.generated.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, JSON.stringify({ version: 1, tropes: list }, null, 2), 'utf8');
  await rename(tmp, GENERATED_FILE);
  generatedCache = list;
}

export async function saveGeneratedCard(card) {
  const list = await loadGenerated();
  const record = {
    ...card,
    id: randomUUID(),
    origin: 'generated',
    createdAt: new Date().toISOString(),
    // 生成卡的分面字段对齐导入库结构
    mechanisms: card.mechanisms || [],
    genres: card.genres || [],
    settings: card.settings || [],
    painPoints: card.painPoints || [],
    highlights: card.highlights || [],
    fourKit: card.fourKit || {}
  };
  list.unshift(record);
  await persistGenerated(list.slice(0, 200)); // 本地生成卡上限 200，防止无限膨胀
  return record;
}

export async function deleteGeneratedCard(id) {
  const list = await loadGenerated();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  await persistGenerated(next);
  return true;
}

// ---------------- 合并视图 ----------------
// 合并导入库与生成卡；任一来源为空都不致命
async function allTropes() {
  const out = [];
  let importedMeta = { source: '', syncedAt: '', facets: {} };
  try {
    const store = await loadImported();
    out.push(...store.tropes);
    importedMeta = { source: store.source, syncedAt: store.syncedAt, facets: store.facets };
  } catch (err) {
    if (err?.code !== 'tropes-not-imported') throw err;
  }
  const gen = await loadGenerated();
  out.push(...gen);
  return { tropes: out, importedMeta, generatedCount: gen.length, hasImported: out.length > gen.length };
}

export function isRichCard(t) {
  const fk = t.fourKit;
  return !!(fk && typeof fk === 'object' && Object.keys(fk).length) ||
    !!t.emotionEngine ||
    (Array.isArray(t.painPoints) && t.painPoints.length) ||
    (Array.isArray(t.highlights) && t.highlights.length);
}

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

// filters: { arc, mechanism, genre, setting, q, richOnly, origin }
export function filterTropes(tropes, filters = {}) {
  const arc = normalize(filters.arc);
  const mechanism = normalize(filters.mechanism);
  const genre = normalize(filters.genre);
  const setting = normalize(filters.setting);
  const q = normalize(filters.q);
  const richOnly = !!filters.richOnly;
  const origin = filters.origin || '';

  return tropes.filter((t) => {
    if (origin && (t.origin || 'imported') !== origin) return false;
    if (arc && t.arc !== filters.arc) return false;
    if (mechanism && !(t.mechanisms || []).includes(filters.mechanism)) return false;
    if (genre && !(t.genres || []).includes(filters.genre)) return false;
    if (setting && !(t.settings || []).includes(filters.setting)) return false;
    if (richOnly && !isRichCard(t)) return false;
    if (q) {
      const hay = [t.title, t.oneLine, t.sellingPoint, t.emotionEngine,
        (t.mechanisms || []).join(' '), (t.genres || []).join(' '),
        (t.settings || []).join(' '), t.arc].map(normalize).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function toListItem(t) {
  const item = {};
  for (const f of LIST_FIELDS) item[f] = t[f] ?? (f === 'mechanisms' || f === 'genres' || f === 'settings' ? [] : '');
  item.rich = isRichCard(t);
  item.origin = t.origin || 'imported';
  item.createdAt = t.createdAt || null;
  return item;
}

// 从合并数据动态计算分面（导入库 facets 是静态快照，生成卡需要计入）
function computeFacets(tropes, staticFacets) {
  const buckets = {
    arc: new Map(), mechanism: new Map(), genre: new Map(), setting: new Map()
  };
  for (const t of tropes) {
    if (t.arc) buckets.arc.set(t.arc, (buckets.arc.get(t.arc) || 0) + 1);
    for (const m of t.mechanisms || []) buckets.mechanism.set(m, (buckets.mechanism.get(m) || 0) + 1);
    for (const g of t.genres || []) buckets.genre.set(g, (buckets.genre.get(g) || 0) + 1);
    for (const s of t.settings || []) buckets.setting.set(s, (buckets.setting.get(s) || 0) + 1);
  }
  const out = {};
  for (const key of Object.keys(buckets)) {
    const values = [...buckets[key].entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
    out[key] = { label: FACET_LABELS[key], values };
  }
  return out;
}

export async function queryTropes(filters, { page = 1, pageSize = 24 } = {}) {
  const { tropes } = await allTropes();
  if (tropes.length === 0) throw notImported();
  const all = filterTropes(tropes, filters);
  const size = Math.min(60, Math.max(1, Number(pageSize) || 24));
  const p = Math.max(1, Number(page) || 1);
  const start = (p - 1) * size;
  const items = all.slice(start, start + size).map(toListItem);
  return { items, page: p, pageSize: size, total: all.length, hasMore: start + size < all.length };
}

export async function getTropeById(id) {
  const { tropes } = await allTropes();
  const t = tropes.find((x) => x.id === id);
  if (!t) return null;
  return { ...t, rich: isRichCard(t) };
}

export async function facetVocabulary() {
  const { tropes, importedMeta } = await allTropes();
  if (tropes.length === 0) throw notImported();
  return computeFacets(tropes, importedMeta.facets);
}
