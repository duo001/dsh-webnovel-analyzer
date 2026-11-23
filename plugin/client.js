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
    const BUILD_TAG = 'v0.1.1';

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

    // ---------------- 主面板 ----------------
    function Panel() {
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
.wn-panel { display:flex; flex-direction:column; flex:1 1 auto; min-height:0; height:auto; overflow-y:auto; box-sizing:border-box; padding: 20px 28px 60px; max-width: 1080px; width:100%; margin: 0 auto; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.6; }
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
