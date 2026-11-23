# dsh-webnovel-analyzer

短篇网文「拆文」分析工具，以 **DeepSeek Harness（DSH）Web 插件** 形式常驻侧边栏，一个面板三个页签：

1. **📖 拆文分析**：上传 `.txt` 短篇原文 → 勾选分析维度 → 并发调用可切换的 OpenAI 兼容大模型 → **完成一个维度就先渲染一个维度**的分维度 Markdown 报告
2. **🔥 热梗库**：240 条网络热梗卡片本地检索，按弧线/机制/题材/设定四个分面筛选，富卡片含四件套、情绪引擎、虐点与高光名场面
3. **🃏 热梗卡生成**：输入故事点子/梗概/原文，AI 按热梗库同构 schema 提炼热梗卡片，并给出 6-8 个分析维度下可直接落笔的网文写法

当前版本 **v0.1.2**。

## 功能特性

- **22 个分析维度**：16 个常用拆文维度 + 6 个来自网文 skill 知识库的补充维度，题材由 AI 自动识别
- **240 条热梗库**：随包本地数据，支持四个分面组合筛选、关键词搜索、富卡片过滤、分页加载；富卡片字段为 动机 / 底线 / 反差 / 动作部署（四件套）+ 情绪引擎 + 虐点 + 高光名场面
- **AI 热梗卡片生成**：输出与热梗库同构的结构化 JSON（容错解析围栏/解释文字），并附 **playbook**——每个选中维度一条绑定本梗具体设定的可执行写法，覆盖开篇钩子、情绪、技法三类维度，一键复制 Markdown
- **多供应商可切换**：内置 DeepSeek / Kimi / 硅基流动 / 火山方舟 / OpenAI / Ollama（本地免 Key）/ 自定义 OpenAI 兼容端点，Base URL 与模型名均可改
- **并发 + 逐维呈现**：每个维度独立请求、`Promise.allSettled` 并发，谁先返回谁渲染；单维失败只在该卡片报错并可单独重试，不影响其他维度
- **方法论驱动**：维度 prompt 提炼自 [chinese-webnovel-skills](https://github.com/tance-mang/chinese-webnovel-skills)（网文工坊）的 39 个 SKILL 与知识库，如 AI 味 12 项量化指标、七类开篇钩、打脸四拍、show-don't-tell 六通道等
- **安全**：API Key 只写入 DSH credentials 托管存储，不进配置文件、不入库；原文请求带防注入护栏（声明原文仅作分析资料）；前端 Markdown 渲染先转义后标记，`javascript:` 链接不生成可点击锚点
- **零运行时依赖**：Host 端只用 Node 全局 `fetch`，无需 npm install 第三方包

## 分析维度

### 基础维度（16）

| 维度 | 方法论来源 |
|---|---|
| 🔥 虐点分析 | case-studies / trope-library |
| 🖍️ 文笔提取-技巧 | deslop / sentence-rhythm |
| 💭 文笔提取-情绪 | emotion / show-emotion |
| 🎯 核心梗总结 | deconstruct（一句话爆点） |
| 📋 大纲总结 | outline（三层结构） |
| 📈 情绪走向 | annotate（情绪曲线） |
| 💬 对话技巧提取 | dialogue |
| 🔄 情节转折点标记 | hook / annotate |
| 🎬 事件分析 | 剧情事件链方法 |
| 🤖 AI 味检测 | aidetect（12 项量化指标，输出 0-10 指数并定位句段） |
| 📝 改写指导 | deslop + human |
| 📚 仿写指导 | deconstruct（可复用模板，学结构不抄字） |
| 🎯 新手+AI 创作难度分析 | review + coach |
| 🦄 期待感分析 | hook + review（钩子维度） |
| 🔗 情绪拉扯分析 | shuangdian + emotion |
| 🎬 导语分析 | hook（七类开篇钩） |

### 补充维度（6）

| 维度 | 方法论来源 |
|---|---|
| 🪝 钩子/开篇诊断 | hook（全量钩子体系） |
| 🧵 伏笔追踪 | review（伏笔诊断）+ continuity（逻辑链核对） |
| 👤 人设分析 | character + dialogue（语言指纹） |
| ⚡ 金手指拆解 | goldfinger（获取门槛/成长曲线/使用代价/主线绑定） |
| 📊 追读留存诊断 | review（六维诊断 + 继续率预测） |
| 🧯 敏感词/校对 | proofread + sensitive-words（启发式，非平台确切词库） |

## 安装

### 方式一：本地目录安装（开发/自用）

在 DSH 会话中让 Agent 用插件管理器安装本目录：

```
plugin_manager install_bundle → target 指向本仓库的 plugin/ 绝对路径
```

安装后在 Web GUI 侧边栏点击「网文拆文」即可使用。

### 方式二：从 Git 仓库安装

支持 Git 地址的安装入口（或 clone 后按方式一安装本地路径）：

```
https://github.com/duo001/dsh-webnovel-analyzer
```

## 配置供应商与 API Key

1. 打开面板右上角「⚙ 设置」
2. 选择供应商，按需修改 Base URL / 模型名，填入 API Key 后保存
3. Key 通过 DSH credentials 服务托管（`~/.dsh/.credentials.yaml`，0600 权限），支持环境变量回退（如 `DEEPSEEK_API_KEY`）
4. 本地 Ollama 无需 Key，确认 `http://localhost:11434` 可达即可
5. 非密钥配置（当前供应商、Base URL/模型覆盖、超时）存于 `~/.dsh/dsh-webnovel/config.json`

## 使用

### 📖 拆文分析

1. 拖拽/点击选择 `.txt` 文件，或直接粘贴原文（建议 8000–20000 字，上限 30000 字；没有稿子可点「填入范文试一下」）
2. 勾选维度（建议先选 1–3 个，更快更聚焦），可全选/清空
3. 点「开始拆文」，报告卡片随各维度完成逐个出现；失败的维度可单独重试
4. 报告为结构化 Markdown：评分表、原文证据、可执行修改建议

### 🔥 热梗库

1. 打开「热梗库」页签，顶部按弧线/机制/题材/设定四个分面筛选，或输入关键词搜索（匹配标题、梗概、卖点、情绪引擎）
2. 勾选「只看富卡片」可过滤出含四件套与名场面的 33 条深度卡片
3. 点击任意卡片打开详情弹窗：四件套（动机/底线/反差/动作部署）、情绪引擎、虐点与高光名场面
4. 列表分页加载，每次 24 条，点「加载更多」翻页

### 🃏 热梗卡生成

1. 打开「热梗卡生成」页签，粘贴故事点子、梗概或一段原文（上限 30000 字）
2. 点「生成热梗卡」，AI 按热梗库同构 schema 输出：标题、一句话梗概、卖点、弧线、机制/题材/设定标签、四件套、情绪引擎、虐点、高光，以及 **6-8 条分维度写法 playbook**
3. 每条 playbook 绑定一个拆文维度（如导语分析、情绪拉扯、对话技巧），给出可直接落笔的具体写法
4. 点「复制 Markdown」可把整卡贴到自己的写作工具里

## 技术架构

```
plugin/
├── package.json        # bundle 清单（dsh.bundle.patch / dsh.client 声明）
├── cordis.patch.yml    # Loader 插入一个插件 entry
├── index.js            # Host 半：/webnovel/* 路由 + OpenAI 兼容客户端
├── dimensions.js       # 22 维元数据与 prompt、7 家供应商预设、字数限制
├── trope-store.js      # 热梗库本地检索：分面/搜索/分页/富卡片判定
├── trope-prompts.js    # AI 热梗卡 schema prompt、JSON 容错解析与规整
├── data/
│   └── tropes.json     # 240 条热梗数据（含 33 条富卡片）
├── client.js           # Client 半：React 面板（无 JSX）、三页签、自写 Markdown 渲染
├── sample.txt          # 原创范文《婚礼请柬》
├── icon.svg            # 侧边栏图标
└── locale/             # zh / en 元信息
```

- **Host 半**（`inject: ['webServer','credentials']`）：注册 prefix 路由 `/webnovel`
  - 拆文：`GET dimensions` / `GET providers` / `GET|POST config` / `POST credential` / `GET sample` / `POST analyze`
  - 热梗：`GET tropes/facets` / `GET tropes`（分面+搜索+分页）/ `GET tropes/:id` / `POST trope-card`（AI 生成）
  - 用 Node 全局 `fetch` 调 `{baseURL}/chat/completions`，`AbortSignal` 超时控制，网络/鉴权/限流错误统一中文化映射；供应商与凭证解析收敛到 `resolveProviderAndKey`，拆文与热梗卡共用
- **Client 半**：注册 `sidebar.panellist` 图标（order 5）与 `main` 面板（key `webnovel-analyzer`），三页签外壳（拆文分析/热梗库/热梗卡生成），全部样式使用 `--dsw-alias-*` 主题 token，自带 ErrorBoundary 防整面板崩溃
- **并发模型**：Client 对每个勾选维度发一个 `/analyze` 请求，天然隔离、免 SSE；运行序号（runSeq）防止过期运行回写
- **热梗卡容错**：模型输出的 JSON 允许包裹 ```json 围栏或夹带解释文字，解析器取首个 `{` 到末个 `}`；playbook 的维度 id 非法或写法为空的条目会被过滤，无法解析时返回 `card-parse-failed` 并提示重试

## 隐私与安全

- 原文仅在你主动发起分析/生成时发送给你配置的模型供应商，插件本身不收集、不留存原文；热梗库为随包本地数据，检索不产生任何网络请求
- API Key 不经过浏览器之外的任何第三方，不出现在仓库与普通配置文件中
- 用户原文在请求中包裹防注入声明，模型被要求把原文当资料而非指令
- 前端渲染对所有内容先做 HTML 转义再做 Markdown 标记，`dangerouslySetInnerHTML` 仅注入已转义后的 HTML，`javascript:` 链接不生成可点击锚点

## 致谢

本项目的分析方法论建立在 [tance-mang/chinese-webnovel-skills](https://github.com/tance-mang/chinese-webnovel-skills)（MIT License, Copyright © 2026 tance-mang）的知识体系之上，完整许可证见 [`third-party-licenses/chinese-webnovel-skills-LICENSE.txt`](third-party-licenses/chinese-webnovel-skills-LICENSE.txt)，署名说明见 [NOTICE.md](NOTICE.md)。

热梗库数据（`plugin/data/tropes.json`）的来源与移除方式亦见 [NOTICE.md](NOTICE.md)。

## 许可证

[MIT License](LICENSE) © 2026 dsh-webnovel-analyzer contributors
