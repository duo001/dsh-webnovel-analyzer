// @local/webnovel-analyzer — Client 半
// 注册 sidebar.panellist 图标 + main 面板（同 PANEL_ID 联动）。
// 取数走同源 fetch /webnovel/*（Host 半的 webServer 路由）。无 JSX，全用 React.createElement。

window.__ModuleLoader__.load({
  id: '@local/webnovel-analyzer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef, useCallback } = React;

    const PANEL_ID = 'webnovel-analyzer';
    const API = '/webnovel';
    // 构建标记：白屏/缓存排查用，硬刷新后标题处应显示该标记
    const BUILD_TAG = 'v0.1.2';

    // ---------------- 基础工具 ----------------
    function api(path, options) {
      return fetch(API + path, Object.assign({
        headers: { 'content-type': 'application/json' }
      }, options)).then(async (res) => {
        let data = null;
        try { data = await res.json(); } catch { /* ignore */ }
        if (!data) throw new Error(`HTTP ${res.status}：服务返回异常`);
        if (!data.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.code });
        return data;
      });
    }

    function escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ---------------- 轻量 Markdown 渲染（先转义后标记，天然防 XSS） ----------------
    function renderInline(text) {
      let s = escapeHtml(text);
      // 行内代码（先处理，内部不再转换）
      s = s.replace(/`([^`]+)`/g, (m, c) => `<code class="wn-md-code">${c}</code>`);
      // 粗体、斜体
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      // 链接（只允许 http/https/mailto）
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
        (m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      return s;
    }

    function markdownToHtml(md) {
      const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
      const html = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];

        // 围栏代码块
        const fence = line.match(/^```(\w*)\s*$/);
        if (fence) {
          const buf = [];
          i++;
          while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
          i++; // 跳过结束围栏
          html.push(`<pre class="wn-md-pre"><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
          continue;
        }

        // 表格
        if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
          const parseRow = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
          const header = parseRow(line);
          i += 2;
          const rows = [];
          while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
          html.push('<table class="wn-md-table"><thead><tr>' +
            header.map((c) => `<th>${renderInline(c)}</th>`).join('') + '</tr></thead><tbody>' +
            rows.map((r) => '<tr>' + header.map((_, k) => `<td>${renderInline(r[k] || '')}</td>`).join('') + '</tr>').join('') +
            '</tbody></table>');
          continue;
        }

        // 标题
        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
          const level = heading[1].length + 2; // ## -> h4，### -> h5
          html.push(`<h${level} class="wn-md-h">${renderInline(heading[2])}</h${level}>`);
          i++; continue;
        }

        // 引用
        if (/^>\s?/.test(line)) {
          const buf = [];
          while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
          html.push(`<blockquote class="wn-md-quote">${buf.map(renderInline).join('<br>')}</blockquote>`);
          continue;
        }

        // 列表（有序/无序，支持一层缩进）
        if (/^\s*([-*]|\d+[.、])\s+/.test(line)) {
          const ordered = /^\s*\d+[.、]/.test(line);
          const items = [];
          while (i < lines.length && /^\s*([-*]|\d+[.、])\s+/.test(lines[i])) {
            const indent = /^\s{2,}/.test(lines[i]);
            const content = lines[i].replace(/^\s*([-*]|\d+[.、])\s+/, '');
            items.push(`<li class="${indent ? 'wn-md-sub' : ''}">${renderInline(content)}</li>`);
            i++;
          }
          html.push(ordered ? `<ol class="wn-md-list">${items.join('')}</ol>` : `<ul class="wn-md-list">${items.join('')}</ul>`);
          continue;
        }

        // 空行
        if (!line.trim()) { i++; continue; }

        // 普通段落（合并连续非空行）
        const buf = [];
        while (i < lines.length && lines[i].trim() &&
          !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*]|\d+[.、])\s+/.test(lines[i]) &&
          !/^```/.test(lines[i]) && !/^>/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) {
          buf.push(lines[i]); i++;
        }
        html.push(`<p class="wn-md-p">${buf.map(renderInline).join('<br>')}</p>`);
      }
      return html.join('\n');
    }

    // ---------------- 子组件 ----------------
    function Spinner() {
      return h('span', { className: 'wn-spinner', 'aria-label': '分析中' });
    }

    function ErrorBoundary(props) {
      const [error, setError] = useState(null);
      if (error) {
        return h('div', { className: 'wn-boundary' },
          h('p', null, '面板渲染出错：' + (error?.message || error)),
          h('button', { className: 'wn-btn wn-btn-ghost', onClick: () => setError(null) }, '重试渲染'),
          h('button', { className: 'wn-btn wn-btn-ghost', onClick: () => location.reload() }, '刷新页面'));
      }
      return h(ErrorCatcher, { onError: setError }, props.children);
    }
    class ErrorCatcher extends React.Component {
      componentDidCatch(err) { this.props.onError(err); }
      render() { return this.props.children; }
    }

    function SettingsModal(props) {
      const { providers, activeProviderId, timeoutMs, onClose, onSaved } = props;
      const [activeId, setActiveId] = useState(activeProviderId);
      const [forms, setForms] = useState({});
      const [keyInputs, setKeyInputs] = useState({});
      const [timeout, setTimeoutValue] = useState(timeoutMs);
      const [busy, setBusy] = useState(false);
      const [message, setMessage] = useState(null);

      const active = providers.find((p) => p.id === activeId) || providers[0];

      const formValue = (p, field) => {
        if (forms[p.id] && forms[p.id][field] !== undefined) return forms[p.id][field];
        return p[field] || '';
      };
      const setForm = (id, field, value) => setForms((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));

      async function saveAll() {
        setBusy(true); setMessage(null);
        try {
          const overrides = {};
          for (const p of providers) {
            const f = forms[p.id];
            if (!f) continue;
            const entry = {};
            if ((f.baseURL ?? p.baseURL) !== p.baseURL) entry.baseURL = (f.baseURL || '').trim();
            if ((f.model ?? p.model) !== p.model) entry.model = (f.model || '').trim();
            if (Object.keys(entry).length) overrides[p.id] = entry;
          }
          // 先保存各家被改过的 key
          for (const [id, value] of Object.entries(keyInputs)) {
            if (!value || !value.trim()) continue;
            const p = providers.find((x) => x.id === id);
            if (!p || !p.credentialRef) continue;
            await api('/credential', { method: 'POST', body: JSON.stringify({ providerId: id, action: 'set', value: value.trim() }) });
          }
          await api('/config', {
            method: 'POST',
            body: JSON.stringify({ activeProviderId: activeId, overrides, timeoutMs: Number(timeout) || 180000 })
          });
          setMessage({ type: 'ok', text: '已保存。Key 以密文形式存入 DSH 凭证库，不会写入配置文件。' });
          onSaved && onSaved();
        } catch (err) {
          setMessage({ type: 'err', text: '保存失败：' + err.message });
        } finally {
          setBusy(false);
        }
      }

      async function clearKey(providerId) {
        setBusy(true); setMessage(null);
        try {
          await api('/credential', { method: 'POST', body: JSON.stringify({ providerId, action: 'unset' }) });
          setKeyInputs((prev) => { const n = { ...prev }; delete n[providerId]; return n; });
          setMessage({ type: 'ok', text: '已清除该供应商凭证。' });
          onSaved && onSaved();
        } catch (err) {
          setMessage({ type: 'err', text: '清除失败：' + err.message });
        } finally {
          setBusy(false);
        }
      }

      return h('div', { className: 'wn-modal-mask', onClick: onClose },
        h('div', { className: 'wn-modal', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'wn-modal-head' },
            h('strong', null, '模型供应商设置'),
            h('button', { className: 'wn-modal-x', onClick: onClose, 'aria-label': '关闭' }, '×')),
          h('div', { className: 'wn-modal-body' },
            h('p', { className: 'wn-modal-tip' }, '所有供应商均为 OpenAI 兼容接口（/chat/completions）。Key 存于 DSH 凭证库（~/.dsh/.credentials.yaml），也可用同名环境变量提供。'),
            h('div', { className: 'wn-provider-tabs' },
              providers.map((p) => h('button', {
                key: p.id,
                className: 'wn-provider-tab' + (p.id === activeId ? ' active' : ''),
                onClick: () => setActiveId(p.id)
              }, p.label, p.configured ? h('em', { className: 'wn-key-ok' }, '●已配') : (p.auth === 'none' ? h('em', { className: 'wn-key-none' }, '免Key') : h('em', { className: 'wn-key-miss' }, '○未配'))))),
            active && h('div', { className: 'wn-provider-form', key: active.id },
              h('label', { className: 'wn-field' },
                h('span', null, 'Base URL'),
                h('input', {
                  type: 'text', value: formValue(active, 'baseURL'),
                  placeholder: 'https://api.example.com/v1',
                  disabled: active.auth === 'none' ? false : false,
                  onChange: (e) => setForm(active.id, 'baseURL', e.target.value)
                })),
              h('label', { className: 'wn-field' },
                h('span', null, '模型名 / 推理接入点'),
                h('input', {
                  type: 'text', value: formValue(active, 'model'),
                  placeholder: active.modelPlaceholder || 'model name',
                  onChange: (e) => setForm(active.id, 'model', e.target.value)
                })),
              active.auth === 'header' && h('div', { className: 'wn-field' },
                h('span', null, 'API Key' + (active.credentialRef ? `（凭证名 ${active.credentialRef}）` : '')),
                h('div', { className: 'wn-key-row' },
                  h('input', {
                    type: 'password',
                    value: keyInputs[active.id] || '',
                    placeholder: active.configured ? '已配置，留空保存则保持不变' : '粘贴 API Key',
                    onChange: (e) => setKeyInputs((prev) => ({ ...prev, [active.id]: e.target.value }))
                  }),
                  active.configured && h('button', {
                    className: 'wn-btn wn-btn-ghost wn-btn-sm',
                    disabled: busy,
                    onClick: () => clearKey(active.id)
                  }, '清除')))),
            h('label', { className: 'wn-field' },
              h('span', null, '单维度请求超时（毫秒，20000–600000）'),
              h('input', {
                type: 'number', min: 20000, max: 600000, step: 5000,
                value: timeout, onChange: (e) => setTimeoutValue(e.target.value)
              }))),
          h('div', { className: 'wn-modal-foot' },
            message && h('span', { className: 'wn-modal-msg ' + message.type }, message.text),
            h('button', { className: 'wn-btn wn-btn-ghost', onClick: onClose }, '取消'),
            h('button', { className: 'wn-btn wn-btn-primary', disabled: busy, onClick: saveAll }, busy ? '保存中…' : '保存设置'))));
    }

    function ResultCard(props) {
      const { item, dimension } = props;
      const header = h('div', { className: 'wn-result-head' },
        h('span', { className: 'wn-dim-emoji' }, dimension.emoji),
        h('strong', null, dimension.name),
        item.status === 'running' && h('span', { className: 'wn-result-meta' }, Spinner(), ' 分析中…'),
        item.status === 'done' && h('span', { className: 'wn-result-meta wn-ok' },
          `${(item.elapsedMs / 1000).toFixed(1)}s` + (item.model ? ` · ${item.model}` : '')),
        item.status === 'error' && h('span', { className: 'wn-result-meta wn-err' }, '失败'));

      if (item.status === 'running') {
        return h('section', { className: 'wn-result-card wn-running' }, header,
          h('div', { className: 'wn-skeleton' },
            h('div', { className: 'wn-sk-line w3' }), h('div', { className: 'wn-sk-line w2' }),
            h('div', { className: 'wn-sk-line w3' }), h('div', { className: 'wn-sk-line w1' })));
      }
      if (item.status === 'error') {
        return h('section', { className: 'wn-result-card wn-error-card' }, header,
          h('p', { className: 'wn-error-text' }, item.error || '分析失败'),
          h('button', { className: 'wn-btn wn-btn-ghost wn-btn-sm', onClick: props.onRetry }, '重试此维度'));
      }
      return h('section', { className: 'wn-result-card' }, header,
        h('div', {
          className: 'wn-md',
          dangerouslySetInnerHTML: { __html: markdownToHtml(item.markdown) }
        }));
    }

    // ---------------- 热梗库 ----------------
    function Chip(props) {
      const { active, onClick, children, title } = props;
      return h('button', {
        type: 'button',
        className: 'wn-chip' + (active ? ' active' : ''),
        onClick, title
      }, children);
    }

    function TagList(props) {
      const items = props.items || [];
      if (!items.length) return null;
      return h('span', { className: 'wn-tag-row' },
        items.map((t, i) => h('span', { key: i, className: 'wn-tag' }, t)));
    }

    function TropeDetailModal(props) {
      const { trope, onClose } = props;
      if (!trope) return null;
      const fk = trope.fourKit || {};
      const rich = trope.rich;
      const kit = [
        ['🎯 动机', fk.motive], ['🚧 底线', fk.bottomline],
        ['🔀 反差', fk.contrast], ['⚔️ 动作部署', fk.move]
      ].filter(([, v]) => v);

      return h('div', { className: 'wn-modal-mask', onClick: onClose },
        h('div', { className: 'wn-modal wn-trope-modal', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'wn-modal-head' },
            h('strong', null, trope.title),
            h('button', { className: 'wn-modal-x', onClick: onClose, 'aria-label': '关闭' }, '×')),
          h('div', { className: 'wn-modal-body' },
            h('div', { className: 'wn-trope-tags' },
              trope.arc && h('span', { className: 'wn-tag wn-tag-arc' }, trope.arc),
              h(TagList, { items: trope.mechanisms }),
              h(TagList, { items: trope.genres }),
              h(TagList, { items: trope.settings })),
            h('div', { className: 'wn-kv' },
              h('span', { className: 'wn-kv-k' }, '一句话梗概'),
              h('p', { className: 'wn-kv-v' }, trope.oneLine || '—')),
            h('div', { className: 'wn-kv' },
              h('span', { className: 'wn-kv-k' }, '卖点'),
              h('p', { className: 'wn-kv-v' }, trope.sellingPoint || '—')),
            kit.length > 0 && h('div', { className: 'wn-kit-grid' },
              kit.map(([label, v]) => h('div', { key: label, className: 'wn-kit-cell' },
                h('strong', null, label), h('p', null, v)))),
            rich && trope.emotionEngine && h('div', { className: 'wn-kv' },
              h('span', { className: 'wn-kv-k' }, '🎢 情绪引擎'),
              h('p', { className: 'wn-kv-v' }, trope.emotionEngine)),
            rich && trope.painPoints && trope.painPoints.length > 0 && h('div', { className: 'wn-kv' },
              h('span', { className: 'wn-kv-k' }, '💔 虐点'),
              h('ul', { className: 'wn-bullet' }, trope.painPoints.map((p, i) => h('li', { key: i }, p)))),
            rich && trope.highlights && trope.highlights.length > 0 && h('div', { className: 'wn-kv' },
              h('span', { className: 'wn-kv-k' }, '✨ 高光名场面'),
              h('ul', { className: 'wn-bullet' }, trope.highlights.map((p, i) => h('li', { key: i }, p)))),
            !rich && h('p', { className: 'wn-modal-tip' }, '该条目为精简卡片，暂无四件套/情绪引擎等深度字段；可在上方筛选「仅看富卡片」。'))));
    }

    function TropeLibrary() {
      const [facets, setFacets] = useState(null);
      const [meta, setMeta] = useState({ total: 0, source: '' });
      const [filters, setFilters] = useState({ arc: '', mechanism: '', genre: '', setting: '', q: '', richOnly: false });
      const [page, setPage] = useState(1);
      const [items, setItems] = useState([]);
      const [total, setTotal] = useState(0);
      const [hasMore, setHasMore] = useState(false);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState(null);
      const [detail, setDetail] = useState(null);
      const [detailLoading, setDetailLoading] = useState(false);
      const searchRef = useRef(null);

      async function loadFacets() {
        try {
          const data = await api('/tropes/facets');
          setFacets(data.facets);
          setMeta({ total: data.total, source: data.source });
        } catch (err) {
          setError('加载热梗分面失败：' + err.message);
        }
      }
      useEffect(() => { loadFacets(); }, []);

      async function loadList(nextPage, reset) {
        setLoading(true); setError(null);
        try {
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(filters)) {
            if (v) params.set(k, v === true ? '1' : v);
          }
          params.set('page', nextPage);
          params.set('pageSize', '24');
          const data = await api('/tropes?' + params.toString());
          setItems((prev) => reset ? data.items : prev.concat(data.items));
          setTotal(data.total);
          setHasMore(data.hasMore);
          setPage(data.page);
        } catch (err) {
          setError('加载热梗列表失败：' + err.message);
        } finally {
          setLoading(false);
        }
      }
      useEffect(() => { loadList(1, true); /* eslint-disable-line */ }, [filters]);

      function pickFacet(key, value) {
        setFilters((prev) => ({ ...prev, [key]: prev[key] === value ? '' : value }));
      }
      function submitSearch(e) {
        e.preventDefault();
        setFilters((prev) => ({ ...prev, q: (searchRef.current?.value || '').trim() }));
      }
      function resetFilters() {
        if (searchRef.current) searchRef.current.value = '';
        setFilters({ arc: '', mechanism: '', genre: '', setting: '', q: '', richOnly: false });
      }
      async function openDetail(id) {
        setDetailLoading(true); setDetail(null);
        try {
          const data = await api('/tropes/' + encodeURIComponent(id));
          setDetail(data.trope);
        } catch (err) {
          setError('加载卡片详情失败：' + err.message);
        } finally {
          setDetailLoading(false);
        }
      }

      const facetBlock = (key) => facets && facets[key] && h('div', { className: 'wn-facet-row' },
        h('span', { className: 'wn-facet-label' }, facets[key].label),
        h('div', { className: 'wn-facet-chips' },
          facets[key].values.map((v) => h(Chip, {
            key: v.name,
            active: filters[key] === v.name,
            title: `${v.count} 条`,
            onClick: () => pickFacet(key, v.name)
          }, v.name, h('em', { className: 'wn-chip-count' }, v.count)))));

      const activeCount = Object.values(filters).filter((v) => v).length;

      return h('div', { className: 'wn-trope-lib' },
        h('div', { className: 'wn-section' },
          h('div', { className: 'wn-dim-head' },
            h('h2', { className: 'wn-h2' }, `🔥 热梗库（${meta.total || 240} 条）`),
            h('label', { className: 'wn-rich-toggle' },
              h('input', {
                type: 'checkbox',
                checked: filters.richOnly,
                onChange: (e) => setFilters((prev) => ({ ...prev, richOnly: e.target.checked }))
              }), '仅看富卡片')),
          h('p', { className: 'wn-tip' },
            '数据来源：', meta.source || 'ludan.pro 公开收录', '。富卡片含四件套（动机/底线/反差/动作）、情绪引擎、虐点与高光名场面；点卡片查看详情。'),
          h('form', { className: 'wn-search-row', onSubmit: submitSearch },
            h('input', {
              ref: searchRef, type: 'search', className: 'wn-search-input',
              placeholder: '搜索标题 / 梗概 / 卖点关键词，如「孟婆」「圣旨」',
              defaultValue: filters.q
            }),
            h('button', { type: 'submit', className: 'wn-btn wn-btn-primary wn-btn-sm' }, '搜索'),
            h('button', { type: 'button', className: 'wn-btn wn-btn-ghost wn-btn-sm', onClick: resetFilters }, '重置')),
          facetBlock('arc'),
          facetBlock('mechanism'),
          facetBlock('genre'),
          facetBlock('setting')),

        error && h('p', { className: 'wn-notice err' }, error),
        h('p', { className: 'wn-selected-count' },
          `命中 ${total} 条${activeCount ? ` · ${activeCount} 个筛选生效中` : ''}`),

        h('div', { className: 'wn-trope-grid' },
          items.map((t) => h('button', {
            key: t.id, type: 'button', className: 'wn-trope-card',
            onClick: () => openDetail(t.id)
          },
            h('div', { className: 'wn-trope-card-head' },
              h('strong', { className: 'wn-trope-title' }, t.title),
              t.rich && h('span', { className: 'wn-rich-badge', title: '含四件套/情绪引擎/虐点/高光' }, '富')),
            h('p', { className: 'wn-trope-oneline' }, t.oneLine),
            h('div', { className: 'wn-trope-tags' },
              t.arc && h('span', { className: 'wn-tag wn-tag-arc' }, t.arc),
              h(TagList, { items: (t.mechanisms || []).slice(0, 2) }),
              h(TagList, { items: (t.genres || []).slice(0, 3) }))))),

        loading && h('div', { className: 'wn-loadmore' }, Spinner(), ' 加载中…'),
        !loading && detailLoading && h('div', { className: 'wn-loadmore' }, Spinner(), ' 打开详情…'),
        !loading && hasMore && h('div', { className: 'wn-loadmore' },
          h('button', { className: 'wn-btn wn-btn-ghost', onClick: () => loadList(page + 1, false) }, '加载更多')),
        !loading && !hasMore && items.length > 0 && h('p', { className: 'wn-selected-count' }, '— 已到底 —'),
        !loading && items.length === 0 && h('div', { className: 'wn-boundary' }, '没有命中的热梗，试试调整筛选或关键词。'),

        h(TropeDetailModal, { trope: detail, onClose: () => setDetail(null) }));
    }

    // ---------------- 拆文分析面板（原主面板） ----------------
    function AnalyzePanel() {
      const [dimensions, setDimensions] = useState([]);
      const [limits, setLimits] = useState({ maxChars: 30000, recommendedMin: 8000, recommendedMax: 20000 });
      const [providers, setProviders] = useState([]);
      const [activeProviderId, setActiveProviderId] = useState('');
      const [timeoutMs, setTimeoutMs] = useState(180000);
      const [loadError, setLoadError] = useState(null);

      const [text, setText] = useState('');
      const [fileName, setFileName] = useState('');
      const [selected, setSelected] = useState(() => new Set());
      const [results, setResults] = useState({}); // dimensionId -> {status, markdown, error, elapsedMs, model}
      const [running, setRunning] = useState(false);
      const [showSettings, setShowSettings] = useState(false);
      const [notice, setNotice] = useState(null);
      const fileRef = useRef(null);
      const runSeq = useRef(0);

      async function refreshProviders() {
        try {
          const data = await api('/providers');
          setProviders(data.providers);
          setActiveProviderId(data.activeProviderId);
          setTimeoutMs(data.timeoutMs);
        } catch (err) {
          setLoadError('加载供应商失败：' + err.message);
        }
      }

      useEffect(() => {
        api('/dimensions').then((data) => {
          setDimensions(data.dimensions);
          setLimits(data.limits);
        }).catch((err) => setLoadError('加载维度失败：' + err.message));
        refreshProviders();
      }, []);

      const charCount = useMemo(() => [...text].length, [text]);
      const overLimit = charCount > limits.maxChars;
      const activeProvider = providers.find((p) => p.id === activeProviderId);
      const keyReady = !activeProvider || activeProvider.auth === 'none' || activeProvider.configured;
      const basics = dimensions.filter((d) => d.group === 'basic');
      const extras = dimensions.filter((d) => d.group === 'extra');

      function toggle(id) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        });
      }
      function selectAll() { setSelected(new Set(dimensions.map((d) => d.id))); }
      function clearAll() { setSelected(new Set()); }

      function handleFile(file) {
        if (!file) return;
        if (!/\.txt$/i.test(file.name) && file.type && !file.type.startsWith('text/')) {
          setNotice({ type: 'err', text: '请选择 .txt 文本文件。' });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const content = String(reader.result || '');
          const len = [...content].length;
          if (len > limits.maxChars) {
            setNotice({ type: 'err', text: `文件 ${len} 字，超过 ${limits.maxChars} 字上限，请拆分后再分析。` });
          } else {
            setNotice(null);
          }
          setText(content);
          setFileName(file.name);
        };
        reader.onerror = () => setNotice({ type: 'err', text: '文件读取失败。' });
        reader.readAsText(file, 'utf-8');
      }

      async function loadSample() {
        try {
          const data = await api('/sample');
          setText(data.text);
          setFileName('内置范文：婚礼请柬.txt');
          setNotice(null);
        } catch (err) {
          setNotice({ type: 'err', text: '范文加载失败：' + err.message });
        }
      }

      async function runOne(dimensionId, providerId, seq, sourceText) {
        setResults((prev) => ({ ...prev, [dimensionId]: { status: 'running' } }));
        try {
          const data = await api('/analyze', {
            method: 'POST',
            body: JSON.stringify({ text: sourceText, dimensionId, providerId })
          });
          if (seq !== runSeq.current) return; // 已有更新的一次运行
          setResults((prev) => ({
            ...prev,
            [dimensionId]: {
              status: 'done', markdown: data.markdown,
              elapsedMs: data.elapsedMs, model: data.model
            }
          }));
        } catch (err) {
          if (seq !== runSeq.current) return;
          setResults((prev) => ({ ...prev, [dimensionId]: { status: 'error', error: err.message } }));
        }
      }

      async function startAnalysis(retryIds) {
        if (!text.trim()) { setNotice({ type: 'err', text: '请先上传或粘贴原文。' }); return; }
        if (overLimit) { setNotice({ type: 'err', text: `原文超过 ${limits.maxChars} 字上限。` }); return; }
        const ids = retryIds && retryIds.length ? retryIds : [...selected];
        if (!ids.length) { setNotice({ type: 'err', text: '请至少勾选一个分析维度。' }); return; }
        if (!keyReady) {
          setNotice({ type: 'err', text: `当前供应商「${activeProvider?.label || ''}」未配置 API Key，请先打开设置填写。` });
          setShowSettings(true);
          return;
        }
        setNotice(null);
        setRunning(true);
        const seq = ++runSeq.current;
        const sourceText = text;
        const pid = activeProviderId;
        // 全部勾选维度同时发起，谁先返回谁先渲染；单维失败互不影响
        await Promise.allSettled(ids.map((id) => runOne(id, pid, seq, sourceText)));
        if (seq === runSeq.current) setRunning(false);
      }

      function retryOne(id) {
        if (running) return;
        startAnalysis([id]);
      }

      // ---------- 渲染 ----------
      if (loadError) {
        return h('div', { className: 'wn-panel' },
          h('div', { className: 'wn-boundary' },
            h('p', null, loadError),
            h('button', { className: 'wn-btn wn-btn-ghost', onClick: () => location.reload() }, '刷新重试')));
      }

      const doneCount = Object.values(results).filter((r) => r.status === 'done').length;
      const errorCount = Object.values(results).filter((r) => r.status === 'error').length;
      const resultIds = dimensions.filter((d) => results[d.id]).map((d) => d.id);

      function dimCard(d) {
        const checked = selected.has(d.id);
        return h('button', {
          key: d.id,
          type: 'button',
          className: 'wn-dim-card' + (checked ? ' checked' : ''),
          onClick: () => toggle(d.id),
          title: d.source ? '方法论来源：' + d.source : undefined
        },
          h('span', { className: 'wn-dim-emoji' }, d.emoji),
          h('span', { className: 'wn-dim-name' }, d.name),
          h('span', { className: 'wn-dim-check' }, checked ? '✓' : ''));
      }

      return h('div', { className: 'wn-panel' },
        h('div', { className: 'wn-header' },
          h('div', null,
            h('h1', { className: 'wn-title' }, '短篇网文拆文'),
            h('span', { className: 'wn-build' }, BUILD_TAG)),
          h('div', { className: 'wn-header-actions' },
            h('span', { className: 'wn-provider-label' },
              '模型：', activeProvider ? activeProvider.label : '加载中…',
              activeProvider && activeProvider.auth === 'header' &&
                h('em', { className: keyReady ? 'wn-key-ok' : 'wn-key-miss' }, keyReady ? ' ●已配' : ' ○未配')),
            h('button', { className: 'wn-btn wn-btn-ghost', onClick: () => setShowSettings(true) }, '⚙ 设置'))),

        h('div', { className: 'wn-section' },
          h('h2', { className: 'wn-h2' }, '第一步 · 上传原文'),
          h('div', {
            className: 'wn-uploader' + (fileName ? ' has-file' : ''),
            onClick: () => fileRef.current && fileRef.current.click(),
            onDragOver: (e) => { e.preventDefault(); },
            onDrop: (e) => { e.preventDefault(); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); }
          },
            h('input', {
              ref: fileRef, type: 'file', accept: '.txt,text/plain',
              style: { display: 'none' },
              onChange: (e) => handleFile(e.target.files && e.target.files[0])
            }),
            h('div', { className: 'wn-upload-icon' }, '📄'),
            fileName
              ? h('div', { className: 'wn-upload-main' },
                h('strong', null, fileName),
                h('span', { className: 'wn-upload-sub' }, '点击重新选择文件'))
              : h('div', { className: 'wn-upload-main' },
                h('strong', null, '选择一个 .txt 短篇原文'),
                h('span', { className: 'wn-upload-sub' },
                  `建议 ${limits.recommendedMin}-${limits.recommendedMax} 字，最多 ${limits.maxChars} 字`)),
            h('div', { className: 'wn-upload-link', onClick: (e) => { e.stopPropagation(); loadSample(); } },
              '没现成稿子？👉 填入范文试一下'))),

        h('div', { className: 'wn-section' },
          h('div', { className: 'wn-textarea-head' },
            h('span', null, '原文内容（也可直接粘贴）'),
            h('span', { className: overLimit ? 'wn-count wn-bad' : 'wn-count' },
              `${charCount} / ${limits.maxChars} 字`)),
          h('textarea', {
            className: 'wn-textarea' + (overLimit ? ' bad' : ''),
            value: text,
            placeholder: '粘贴小说原文，或在上方选择 .txt 文件…',
            onChange: (e) => { setText(e.target.value); setFileName(''); }
          })),

        h('div', { className: 'wn-section' },
          h('div', { className: 'wn-dim-head' },
            h('h2', { className: 'wn-h2' }, '第二步 · 选择分析维度'),
            h('div', null,
              h('button', { className: 'wn-btn wn-btn-ghost wn-btn-sm', onClick: selectAll }, '全选'),
              h('button', { className: 'wn-btn wn-btn-ghost wn-btn-sm', onClick: clearAll }, '清空'))),
          h('p', { className: 'wn-tip' }, '💡 建议先选 1-3 个维度，分析更快、结果更聚焦；题材由 AI 自动识别。'),
          h('div', { className: 'wn-dim-grid' }, basics.map(dimCard)),
          h('h3', { className: 'wn-h3' }, '补充维度（来自网文 skill 知识库）'),
          h('div', { className: 'wn-dim-grid' }, extras.map(dimCard)),
          h('p', { className: 'wn-selected-count' }, `已选 ${selected.size} 个 · 共 ${dimensions.length} 个维度`)),

        h('div', { className: 'wn-action-bar' },
          notice && h('span', { className: 'wn-notice ' + notice.type }, notice.text),
          h('button', {
            className: 'wn-btn wn-btn-gold wn-btn-start',
            disabled: running || !dimensions.length,
            onClick: () => startAnalysis()
          }, running ? `拆文中…（${doneCount} 完成${errorCount ? ` · ${errorCount} 失败` : ''}）` : '开始拆文')),

        resultIds.length > 0 && h('div', { className: 'wn-results' },
          h('h2', { className: 'wn-h2' }, '拆文报告（完成一个渲染一个）'),
          resultIds.map((id) => h(ResultCard, {
            key: id,
            item: results[id],
            dimension: dimensions.find((d) => d.id === id),
            onRetry: () => retryOne(id)
          }))),

        showSettings && h(SettingsModal, {
          providers, activeProviderId, timeoutMs,
          onClose: () => setShowSettings(false),
          onSaved: () => refreshProviders()
        }));
    }

    // ---------------- AI 热梗卡片生成 ----------------
    function cardToMarkdown(card) {
      const L = [];
      L.push(`# ${card.title}`);
      if (card.arc || card.mechanisms.length || card.genres.length) {
        L.push('');
        L.push('> ' + [card.arc, ...card.mechanisms, ...card.genres, ...card.settings].filter(Boolean).join(' / '));
      }
      L.push('', '## 一句话梗概', card.oneLine || '—');
      L.push('', '## 卖点', card.sellingPoint || '—');
      L.push('', '## 四件套');
      L.push(`- **动机**：${card.fourKit.motive || '—'}`);
      L.push(`- **底线**：${card.fourKit.bottomline || '—'}`);
      L.push(`- **反差**：${card.fourKit.contrast || '—'}`);
      L.push(`- **动作部署**：${card.fourKit.move || '—'}`);
      if (card.emotionEngine) L.push('', '## 情绪引擎', card.emotionEngine);
      if (card.painPoints.length) L.push('', '## 虐点', ...card.painPoints.map((p) => `- ${p}`));
      if (card.highlights.length) L.push('', '## 高光名场面', ...card.highlights.map((p) => `- ${p}`));
      if (card.playbook.length) {
        L.push('', '## 各维度可用网文写法');
        for (const p of card.playbook) L.push(`### ${p.dimensionName || p.dimensionId}`, p.play);
      }
      return L.join('\n');
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return true;
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }

    function GeneratedCard(props) {
      const { card, dimensionMap } = props;
      const [copied, setCopied] = useState(false);
      const fk = card.fourKit || {};
      const kit = [
        ['🎯 动机', fk.motive], ['🚧 底线', fk.bottomline],
        ['🔀 反差', fk.contrast], ['⚔️ 动作部署', fk.move]
      ].filter(([, v]) => v);

      async function onCopy() {
        const enriched = {
          ...card,
          playbook: card.playbook.map((p) => ({ ...p, dimensionName: dimensionMap[p.dimensionId]?.name || p.dimensionId }))
        };
        const ok = await copyText(cardToMarkdown(enriched));
        if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
      }

      return h('div', { className: 'wn-gen-card' },
        h('div', { className: 'wn-gen-head' },
          h('h2', { className: 'wn-h2' }, '🃏 ' + card.title),
          h('button', { className: 'wn-btn wn-btn-ghost wn-btn-sm', onClick: onCopy }, copied ? '✓ 已复制' : '复制 Markdown')),
        h('div', { className: 'wn-trope-tags' },
          card.arc && h('span', { className: 'wn-tag wn-tag-arc' }, card.arc),
          h(TagList, { items: card.mechanisms }),
          h(TagList, { items: card.genres }),
          h(TagList, { items: card.settings })),
        h('div', { className: 'wn-kv' },
          h('span', { className: 'wn-kv-k' }, '一句话梗概'), h('p', { className: 'wn-kv-v' }, card.oneLine || '—')),
        h('div', { className: 'wn-kv' },
          h('span', { className: 'wn-kv-k' }, '卖点'), h('p', { className: 'wn-kv-v' }, card.sellingPoint || '—')),
        kit.length > 0 && h('div', { className: 'wn-kit-grid' },
          kit.map(([label, v]) => h('div', { key: label, className: 'wn-kit-cell' },
            h('strong', null, label), h('p', null, v)))),
        card.emotionEngine && h('div', { className: 'wn-kv' },
          h('span', { className: 'wn-kv-k' }, '🎢 情绪引擎'), h('p', { className: 'wn-kv-v' }, card.emotionEngine)),
        card.painPoints.length > 0 && h('div', { className: 'wn-kv' },
          h('span', { className: 'wn-kv-k' }, '💔 虐点'),
          h('ul', { className: 'wn-bullet' }, card.painPoints.map((p, i) => h('li', { key: i }, p)))),
        card.highlights.length > 0 && h('div', { className: 'wn-kv' },
          h('span', { className: 'wn-kv-k' }, '✨ 高光名场面'),
          h('ul', { className: 'wn-bullet' }, card.highlights.map((p, i) => h('li', { key: i }, p)))),
        card.playbook.length > 0 && h('div', { className: 'wn-kv' },
          h('span', { className: 'wn-kv-k' }, '📐 各维度可用网文写法'),
          h('div', { className: 'wn-playbook' },
            card.playbook.map((p, i) => {
              const meta = dimensionMap[p.dimensionId];
              return h('div', { key: i, className: 'wn-play-cell' },
                h('div', { className: 'wn-play-dim' },
                  h('span', { className: 'wn-dim-emoji' }, meta?.emoji || '📝'),
                  h('strong', null, meta?.name || p.dimensionId)),
                h('p', null, p.play));
            }))));
    }

    function TropeCardGenerator() {
      const [text, setText] = useState('');
      const [limits, setLimits] = useState({ maxChars: 30000 });
      const [providers, setProviders] = useState([]);
      const [activeProviderId, setActiveProviderId] = useState('');
      const [generating, setGenerating] = useState(false);
      const [card, setCard] = useState(null);
      const [error, setError] = useState(null);
      const [elapsed, setElapsed] = useState(null);
      const [notice, setNotice] = useState(null);
      const [showSettings, setShowSettings] = useState(false);
      const [dimensionMap, setDimensionMap] = useState({});

      useEffect(() => {
        api('/dimensions').then((data) => {
          setLimits(data.limits);
          const map = {};
          for (const d of data.dimensions) map[d.id] = d;
          setDimensionMap(map);
        }).catch((err) => setNotice('加载维度失败：' + err.message));
        api('/providers').then((data) => {
          setProviders(data.providers);
          setActiveProviderId(data.activeProviderId);
        }).catch((err) => setNotice('加载供应商失败：' + err.message));
      }, []);

      const charCount = useMemo(() => [...text].length, [text]);
      const overLimit = charCount > limits.maxChars;
      const activeProvider = providers.find((p) => p.id === activeProviderId);
      const keyReady = !activeProvider || activeProvider.auth === 'none' || activeProvider.configured;

      async function generate() {
        if (!text.trim()) { setError(null); setNotice('请先粘贴故事点子、梗概或小说原文。'); return; }
        if (overLimit) { setError(null); setNotice(`素材超过 ${limits.maxChars} 字上限。`); return; }
        if (!keyReady) { setShowSettings(true); return; }
        setNotice(null); setError(null); setCard(null); setGenerating(true);
        try {
          const data = await api('/trope-card', {
            method: 'POST',
            body: JSON.stringify({ text, providerId: activeProviderId })
          });
          setCard(data.card);
          setElapsed({ ms: data.elapsedMs, model: data.model });
        } catch (err) {
          setError(err.message || '生成失败');
        } finally {
          setGenerating(false);
        }
      }

      return h('div', { className: 'wn-trope-gen' },
        h('div', { className: 'wn-section' },
          h('div', { className: 'wn-dim-head' },
            h('h2', { className: 'wn-h2' }, '🃏 AI 热梗卡片生成'),
            h('span', { className: 'wn-provider-label' },
              '模型：', activeProvider ? activeProvider.label : '加载中…',
              activeProvider && activeProvider.auth === 'header' &&
                h('em', { className: keyReady ? 'wn-key-ok' : 'wn-key-miss' }, keyReady ? ' ●已配' : ' ○未配'),
              h('button', { className: 'wn-btn wn-btn-ghost wn-btn-sm', style: { marginLeft: 8 }, onClick: () => setShowSettings(true) }, '⚙ 设置'))),
          h('p', { className: 'wn-tip' },
            '粘贴一个故事点子、梗概或原文，AI 按热梗库同构 schema 提炼四件套（动机/底线/反差/动作）、情绪引擎、虐点与高光名场面，并给出 6-8 个分析维度下可直接落笔的网文写法。'),
          h('div', { className: 'wn-textarea-head' },
            h('span', null, '素材内容'),
            h('span', { className: overLimit ? 'wn-count wn-bad' : 'wn-count' }, `${charCount} / ${limits.maxChars} 字`)),
          h('textarea', {
            className: 'wn-textarea' + (overLimit ? ' bad' : ''),
            style: { minHeight: 200 },
            value: text,
            placeholder: '例：婚礼上，交往八年的男友把捧花送给了实习生，说她更需要被照顾。我当场脱下戒指转身离开，三年后嫁给了别人，他却带着车队堵在我公司楼下…',
            onChange: (e) => setText(e.target.value)
          })),

        h('div', { className: 'wn-action-bar' },
          notice && h('span', { className: 'wn-notice err' }, notice),
          h('button', {
            className: 'wn-btn wn-btn-gold wn-btn-start',
            disabled: generating,
            onClick: generate
          }, generating ? '生成中，通常 10-20 秒…' : '✨ 生成热梗卡片')),

        generating && h('div', { className: 'wn-result-card wn-running' },
          h('div', { className: 'wn-result-head' }, h('strong', null, '🃏 热梗卡片'), h('span', { className: 'wn-result-meta' }, Spinner(), ' AI 提炼中…')),
          h('div', { className: 'wn-skeleton' },
            h('div', { className: 'wn-sk-line w3' }), h('div', { className: 'wn-sk-line w2' }),
            h('div', { className: 'wn-sk-line w3' }), h('div', { className: 'wn-sk-line w1' }))),

        error && h('div', { className: 'wn-result-card wn-error-card' },
          h('div', { className: 'wn-result-head' }, h('strong', null, '生成失败')),
          h('p', { className: 'wn-error-text' }, error),
          h('button', { className: 'wn-btn wn-btn-ghost wn-btn-sm', onClick: generate }, '重试')),

        card && h(GeneratedCard, { card, dimensionMap }),
        card && elapsed && h('p', { className: 'wn-selected-count' },
          `生成耗时 ${(elapsed.ms / 1000).toFixed(1)}s · 模型 ${elapsed.model || '-'}`),

        showSettings && h(SettingsModal, {
          providers, activeProviderId, timeoutMs: 180000,
          onClose: () => setShowSettings(false),
          onSaved: () => api('/providers').then((data) => {
            setProviders(data.providers);
            setActiveProviderId(data.activeProviderId);
          })
        }));
    }

    // ---------------- 主面板：Tab 外壳 ----------------
    function Panel() {
      const [tab, setTab] = useState('analyze'); // analyze | library | generator
      return h('div', { className: 'wn-shell' },
        h('div', { className: 'wn-tabbar' },
          h('button', {
            type: 'button',
            className: 'wn-tab' + (tab === 'analyze' ? ' active' : ''),
            onClick: () => setTab('analyze')
          }, '📖 拆文分析'),
          h('button', {
            type: 'button',
            className: 'wn-tab' + (tab === 'library' ? ' active' : ''),
            onClick: () => setTab('library')
          }, '🔥 热梗库'),
          h('button', {
            type: 'button',
            className: 'wn-tab' + (tab === 'generator' ? ' active' : ''),
            onClick: () => setTab('generator')
          }, '🃏 热梗卡生成'),
          h('span', { className: 'wn-build' }, BUILD_TAG)),
        h('div', { className: 'wn-tab-body' },
          tab === 'analyze' && h(AnalyzePanel),
          tab === 'library' && h(TropeLibrary),
          tab === 'generator' && h(TropeCardGenerator)));
    }

    // 侧边栏图标（ownerProps 提供 size/active）
    function PanelIcon(props) {
      const size = (props && props.size) || 20;
      const active = !!(props && props.active);
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
        strokeLinejoin: 'round', style: { opacity: active ? 1 : 0.75 },
        'aria-label': '短篇网文拆文'
      },
        h('path', { d: 'M5 3h10l4 4v14H5z' }),
        h('path', { d: 'M8 9h8M8 13h8M8 17h5' }),
        h('path', { d: 'M15.5 14.5l1.5 1.5 3-3.4', stroke: '#f0a020', strokeWidth: 1.9 }));
    }

    const CSS = `
.wn-shell { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; width:100%; overflow:hidden; }
.wn-tabbar { display:flex; align-items:center; gap: 4px; padding: 10px 28px 0; max-width: 1080px; width:100%; margin: 0 auto; box-sizing:border-box; border-bottom: 1px solid var(--dsw-alias-border-l1); flex-shrink: 0; }
.wn-tab { border: none; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 14px; font-weight: 600; padding: 9px 16px; cursor: pointer; border-bottom: 2px solid transparent; border-radius: 8px 8px 0 0; font-family: inherit; }
.wn-tab:hover { color: var(--dsw-alias-label-primary); }
.wn-tab.active { color: var(--dsw-alias-brand-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.wn-tab-body { flex:1 1 auto; min-height:0; overflow-y:auto; }
.wn-panel { display:flex; flex-direction:column; box-sizing:border-box; padding: 20px 28px 60px; max-width: 1080px; width:100%; margin: 0 auto; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.6; }
.wn-trope-lib, .wn-trope-gen { display:flex; flex-direction:column; box-sizing:border-box; padding: 20px 28px 60px; max-width: 1080px; width:100%; margin: 0 auto; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.6; }
.wn-header { display:flex; align-items:center; justify-content:space-between; margin-bottom: 18px; }
.wn-title { font-size: 20px; font-weight: 700; margin: 0; display: inline; }
.wn-build { font-size: 10px; color: var(--dsw-alias-label-secondary); margin-left: 8px; vertical-align: middle; }
.wn-header-actions { display:flex; align-items:center; gap: 12px; }
.wn-provider-label { font-size: 12.5px; color: var(--dsw-alias-label-secondary); }
.wn-key-ok { color: #3da664; font-style: normal; margin-left: 4px; font-size: 11px; }
.wn-key-miss { color: #d4694f; font-style: normal; margin-left: 4px; font-size: 11px; }
.wn-key-none { color: var(--dsw-alias-label-secondary); font-style: normal; margin-left: 4px; font-size: 11px; }
.wn-section { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 16px 18px; margin-bottom: 14px; }
.wn-h2 { font-size: 15px; font-weight: 700; margin: 0 0 10px; }
.wn-h3 { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 16px 0 8px; }
.wn-dim-head { display:flex; align-items:center; justify-content:space-between; }
.wn-tip { font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin: 0 0 12px; }
.wn-uploader { border: 1.5px dashed var(--dsw-alias-border-l2); border-radius: 12px; padding: 22px; text-align: center; cursor: pointer; transition: border-color .15s, background .15s; position: relative; }
.wn-uploader:hover, .wn-uploader.has-file { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); }
.wn-upload-icon { font-size: 26px; margin-bottom: 6px; }
.wn-upload-main strong { display: block; font-size: 14px; }
.wn-upload-sub { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.wn-upload-link { color: var(--dsw-alias-brand-primary); font-size: 12.5px; margin-top: 8px; display: inline-block; }
.wn-textarea-head { display:flex; justify-content:space-between; font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; }
.wn-count { font-variant-numeric: tabular-nums; }
.wn-count.wn-bad { color: #d4694f; font-weight: 700; }
.wn-textarea { width: 100%; min-height: 180px; resize: vertical; box-sizing: border-box; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); padding: 10px 12px; font-size: 13px; line-height: 1.7; font-family: inherit; outline: none; }
.wn-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.wn-textarea.bad { border-color: #d4694f; }
.wn-dim-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.wn-dim-card { display:flex; align-items:center; gap: 8px; text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 13px; transition: all .15s; position: relative; }
.wn-dim-card:hover { border-color: var(--dsw-alias-brand-primary); }
.wn-dim-card.checked { background: rgba(240,160,32,.14); border-color: #f0a020; }
.wn-dim-emoji { font-size: 16px; flex-shrink: 0; }
.wn-dim-name { flex: 1; }
.wn-dim-check { color: #d98a12; font-weight: 800; width: 14px; }
.wn-selected-count { font-size: 12.5px; color: var(--dsw-alias-label-secondary); margin: 12px 0 0; }
.wn-action-bar { display:flex; align-items:center; gap: 14px; margin: 18px 0 0; flex-wrap: wrap; position: sticky; bottom: 0; z-index: 20; background: var(--dsw-alias-bg-base); padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l1); border-radius: 0 0 10px 10px; }
.wn-notice { font-size: 12.5px; }
.wn-notice.err { color: #d4694f; }
.wn-notice.ok { color: #3da664; }
.wn-btn { border-radius: 9px; padding: 8px 14px; font-size: 13px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); transition: opacity .15s, filter .15s; }
.wn-btn:hover:not(:disabled) { filter: brightness(1.06); }
.wn-btn:disabled { opacity: .55; cursor: not-allowed; }
.wn-btn-sm { padding: 4px 10px; font-size: 12px; }
.wn-btn-ghost { background: transparent; }
.wn-btn-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-color-primary-foreground, #fff); font-weight: 600; }
.wn-btn-gold { background: linear-gradient(135deg, #f6b73c, #ef9f1c); border: none; color: #3a2700; font-weight: 700; }
.wn-btn-start { padding: 11px 34px; font-size: 15px; border-radius: 10px; }
.wn-results { margin-top: 22px; display: flex; flex-direction: column; gap: 14px; }
.wn-result-card { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 16px 18px; }
.wn-result-card.wn-running { border-style: dashed; }
.wn-result-card.wn-error-card { border-color: #d4694f; }
.wn-result-head { display:flex; align-items:center; gap: 8px; margin-bottom: 10px; }
.wn-result-meta { font-size: 12px; color: var(--dsw-alias-label-secondary); font-weight: 400; display:inline-flex; align-items:center; gap:5px; }
.wn-result-meta.wn-ok { color: #3da664; }
.wn-result-meta.wn-err { color: #d4694f; }
.wn-error-text { color: #d4694f; font-size: 13px; margin: 6px 0 10px; white-space: pre-wrap; }
.wn-spinner { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); border-radius: 50%; animation: wn-spin .8s linear infinite; }
@keyframes wn-spin { to { transform: rotate(360deg); } }
.wn-sk-line { height: 10px; border-radius: 5px; background: var(--dsw-alias-border-l1); margin: 8px 0; animation: wn-pulse 1.2s ease-in-out infinite; }
.wn-sk-line.w1 { width: 40%; } .wn-sk-line.w2 { width: 65%; } .wn-sk-line.w3 { width: 90%; }
@keyframes wn-pulse { 50% { opacity: .45; } }
.wn-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.42); display:flex; align-items:center; justify-content:center; z-index: 1000; }
.wn-modal { width: min(640px, 92vw); max-height: 86vh; overflow:auto; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.28); }
.wn-modal-head { display:flex; align-items:center; justify-content:space-between; padding: 16px 20px; border-bottom: 1px solid var(--dsw-alias-border-l1); position: sticky; top: 0; background: var(--dsw-alias-bg-base); }
.wn-modal-x { border: none; background: none; font-size: 22px; cursor: pointer; color: var(--dsw-alias-label-secondary); line-height: 1; }
.wn-modal-body { padding: 16px 20px; display:flex; flex-direction: column; gap: 14px; }
.wn-modal-tip { font-size: 12px; color: var(--dsw-alias-label-secondary); margin: 0; background: var(--dsw-alias-bg-layer-1); padding: 8px 10px; border-radius: 8px; }
.wn-provider-tabs { display:flex; flex-wrap: wrap; gap: 6px; }
.wn-provider-tab { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.wn-provider-tab.active { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 1px var(--dsw-alias-brand-primary) inset; }
.wn-field { display:flex; flex-direction: column; gap: 5px; font-size: 12.5px; }
.wn-field > span { color: var(--dsw-alias-label-secondary); }
.wn-field input { border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); padding: 8px 10px; font-size: 13px; outline: none; font-family: inherit; }
.wn-field input:focus { border-color: var(--dsw-alias-brand-primary); }
.wn-key-row { display:flex; gap: 8px; }
.wn-key-row input { flex: 1; }
.wn-modal-foot { padding: 14px 20px; border-top: 1px solid var(--dsw-alias-border-l1); display:flex; justify-content: flex-end; gap: 10px; align-items: center; position: sticky; bottom: 0; background: var(--dsw-alias-bg-base); }
.wn-modal-msg { font-size: 12px; margin-right: auto; }
.wn-modal-msg.ok { color: #3da664; }
.wn-modal-msg.err { color: #d4694f; }
.wn-boundary { padding: 40px; text-align: center; color: var(--dsw-alias-label-primary); display:flex; flex-direction: column; gap: 10px; align-items: center; }
/* markdown 渲染区 */
.wn-md { font-size: 13.5px; line-height: 1.75; color: var(--dsw-alias-label-primary); word-break: break-word; }
.wn-md .wn-md-h { font-size: 14.5px; font-weight: 700; margin: 14px 0 8px; }
.wn-md .wn-md-p { margin: 7px 0; }
.wn-md .wn-md-list { margin: 7px 0; padding-left: 22px; }
.wn-md .wn-md-list li { margin: 3px 0; }
.wn-md .wn-md-list li.wn-md-sub { list-style: circle; margin-left: 16px; }
.wn-md .wn-md-quote { margin: 8px 0; padding: 6px 12px; border-left: 3px solid var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); border-radius: 0 8px 8px 0; }
.wn-md .wn-md-code { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
.wn-md .wn-md-pre { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 10px 12px; overflow:auto; }
.wn-md .wn-md-pre code { font-size: 12px; white-space: pre-wrap; }
.wn-md .wn-md-table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12.5px; display: block; overflow-x: auto; }
.wn-md .wn-md-table th, .wn-md .wn-md-table td { border: 1px solid var(--dsw-alias-border-l2); padding: 6px 9px; text-align: left; }
.wn-md .wn-md-table th { background: var(--dsw-alias-bg-layer-1); font-weight: 700; }
.wn-md a { color: var(--dsw-alias-brand-primary); }
.wn-md strong { font-weight: 700; }
/* 热梗库 */
.wn-search-row { display:flex; gap: 8px; margin-bottom: 12px; }
.wn-search-input { flex:1; border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); padding: 8px 12px; font-size: 13px; outline: none; font-family: inherit; }
.wn-search-input:focus { border-color: var(--dsw-alias-brand-primary); }
.wn-rich-toggle { display:inline-flex; align-items:center; gap: 5px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); cursor: pointer; font-weight: 400; }
.wn-rich-toggle input { accent-color: #f0a020; }
.wn-facet-row { display:flex; gap: 10px; align-items: flex-start; margin: 10px 0; }
.wn-facet-label { flex-shrink: 0; width: 42px; font-size: 12.5px; color: var(--dsw-alias-label-secondary); padding-top: 5px; }
.wn-facet-chips { display:flex; flex-wrap: wrap; gap: 6px; }
.wn-chip { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); border-radius: 999px; padding: 4px 11px; font-size: 12px; cursor: pointer; font-family: inherit; display:inline-flex; align-items:center; gap:5px; transition: all .15s; }
.wn-chip:hover { border-color: var(--dsw-alias-brand-primary); }
.wn-chip.active { background: rgba(240,160,32,.16); border-color: #f0a020; color: #b9760a; font-weight: 600; }
.wn-chip-count { font-style: normal; font-size: 10.5px; opacity: .65; font-variant-numeric: tabular-nums; }
.wn-trope-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin-top: 12px; }
.wn-trope-card { display:flex; flex-direction:column; gap: 8px; text-align: left; padding: 14px 15px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); cursor: pointer; transition: all .15s; font-family: inherit; }
.wn-trope-card:hover { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 4px 16px rgba(0,0,0,.08); transform: translateY(-1px); }
.wn-trope-card-head { display:flex; align-items:flex-start; justify-content:space-between; gap: 8px; }
.wn-trope-title { font-size: 14px; font-weight: 700; line-height: 1.4; }
.wn-rich-badge { flex-shrink: 0; font-size: 10.5px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #f6b73c, #ef9f1c); border-radius: 6px; padding: 1px 6px; }
.wn-trope-oneline { font-size: 12.5px; color: var(--dsw-alias-label-secondary); line-height: 1.65; margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.wn-trope-tags { display:flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.wn-tag-row { display:inline-flex; flex-wrap: wrap; gap: 5px; }
.wn-tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.wn-tag-arc { background: rgba(240,160,32,.12); border-color: rgba(240,160,32,.45); color: #b9760a; font-weight: 600; }
.wn-loadmore { text-align: center; padding: 18px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; display:flex; align-items:center; justify-content:center; gap: 7px; }
.wn-trope-modal { width: min(720px, 94vw); }
.wn-kv { margin: 12px 0; }
.wn-kv-k { display:block; font-size: 12.5px; font-weight: 700; color: var(--dsw-alias-brand-primary); margin-bottom: 4px; }
.wn-kv-v { margin: 0; font-size: 13.5px; line-height: 1.7; color: var(--dsw-alias-label-primary); white-space: pre-wrap; }
.wn-kit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 12px 0; }
.wn-kit-cell { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; }
.wn-kit-cell strong { display:block; font-size: 12.5px; margin-bottom: 5px; color: var(--dsw-alias-label-primary); }
.wn-kit-cell p { margin: 0; font-size: 12.5px; line-height: 1.65; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; }
.wn-bullet { margin: 4px 0 0; padding-left: 20px; font-size: 13px; line-height: 1.75; }
.wn-bullet li { margin: 3px 0; }
/* AI 生成卡片 */
.wn-gen-card { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 20px 22px; margin-top: 16px; }
.wn-gen-head { display:flex; align-items:center; justify-content:space-between; gap: 10px; margin-bottom: 12px; }
.wn-gen-head .wn-h2 { margin: 0; }
.wn-playbook { display:flex; flex-direction:column; gap: 10px; margin-top: 6px; }
.wn-play-cell { border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-brand-primary); border-radius: 8px; padding: 10px 13px; background: var(--dsw-alias-bg-layer-1); }
.wn-play-dim { display:flex; align-items:center; gap: 6px; margin-bottom: 5px; font-size: 13px; }
.wn-play-cell p { margin: 0; font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
@media (max-width: 720px) { .wn-kit-grid { grid-template-columns: 1fr; } .wn-trope-grid { grid-template-columns: 1fr; } }
`;

    function safeStyles(ctx) {
      try {
        const styles = ctx.get('styles');
        if (styles && typeof styles.insert === 'function') return styles.insert(CSS);
      } catch { /* fall through */ }
      const el = document.createElement('style');
      el.textContent = CSS;
      document.head.appendChild(el);
      return () => el.remove();
    }

    function BoundaryPanel() {
      return h(ErrorBoundary, null, h(Panel));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposeCss = safeStyles(ctx);
        const d1 = ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID
        }, BoundaryPanel));
        const d2 = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 5,
          label: '网文拆文'
        }, PanelIcon));
        ctx.effect(() => () => { d1(); d2(); disposeCss(); }, 'webnovel-analyzer: slots');
      }
    };
  }
});
