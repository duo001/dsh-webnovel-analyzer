// 热梗库：加载随包分发的 tropes.json，提供分面筛选 / 搜索 / 详情。
// 数据来源与版权见 NOTICE.md（ludan.pro 公开收录数据，随用户提供的 tropes.json 分发）。
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TROPES_FILE = join(HERE, 'data', 'tropes.json');

let cache = null;

// 列表页不下发长文本字段，控制响应体积
const LIST_FIELDS = ['id', 'title', 'oneLine', 'arc', 'mechanisms', 'genres', 'settings', 'sellingPoint'];

export async function loadTropes() {
  if (cache) return cache;
  const raw = await readFile(TROPES_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.tropes)) throw new Error('tropes.json 结构异常：缺少 tropes 数组');
  cache = {
    source: parsed.source || '',
    syncedAt: parsed.syncedAt || '',
    facets: parsed.facets || {},
    total: parsed.total || parsed.tropes.length,
    tropes: parsed.tropes
  };
  return cache;
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

// filters: { arc, mechanism, genre, setting, q, richOnly }
export function filterTropes(tropes, filters = {}) {
  const arc = normalize(filters.arc);
  const mechanism = normalize(filters.mechanism);
  const genre = normalize(filters.genre);
  const setting = normalize(filters.setting);
  const q = normalize(filters.q);
  const richOnly = !!filters.richOnly;

  return tropes.filter((t) => {
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
  return item;
}

export function queryTropes(filters, { page = 1, pageSize = 24 } = {}) {
  const all = filterTropes(cache.tropes, filters);
  const size = Math.min(60, Math.max(1, Number(pageSize) || 24));
  const p = Math.max(1, Number(page) || 1);
  const start = (p - 1) * size;
  const items = all.slice(start, start + size).map(toListItem);
  return {
    items,
    page: p,
    pageSize: size,
    total: all.length,
    hasMore: start + size < all.length
  };
}

export function getTropeById(id) {
  const t = cache.tropes.find((x) => x.id === id);
  if (!t) return null;
  return { ...t, rich: isRichCard(t) };
}

export function facetVocabulary() {
  // 只返回允许筛选的四个分面（含 label 与带计数的值）
  const out = {};
  for (const key of ['arc', 'mechanism', 'genre', 'setting']) {
    const f = cache.facets[key];
    if (!f) continue;
    out[key] = { label: f.label || key, values: (f.values || []).map((v) => ({ name: v.name, count: v.count })) };
  }
  return out;
}
