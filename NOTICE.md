# 第三方组件署名（Notices）

本产品的 22 个分析维度之方法论与 prompt 知识，提炼、改编自以下开源项目：

- **chinese-webnovel-skills（网文工坊 WebNovel Studio）**
  - 仓库：https://github.com/tance-mang/chinese-webnovel-skills
  - 许可证：MIT License，Copyright (c) 2026 tance-mang
  - 完整许可证原文见：`third-party-licenses/chinese-webnovel-skills-LICENSE.txt`
  - 本产品对其 SKILL.md 与 references 知识库中的方法论进行了提炼与重组，未直接分发其原文；遵循其"学结构不抄字"的原创底线，本产品输出的是分析报告而非小说成稿。

## 热梗库数据（用户自备，不随仓库分发）

- 自 v0.1.3 起，本仓库与安装包**不包含、不分发任何热梗数据文件**。热梗库功能需要使用者自行导入符合 `{ "tropes": [...] }` 结构的 `tropes.json`（在「🔥 热梗库」页签点击或拖拽导入）。
- 早期 v0.1.2 版本曾随包提供过一份 240 条网络热梗卡片数据（含弧线/机制/题材/设定四个分面，其中 33 条为含四件套、情绪引擎、虐点与高光的富卡片），该数据内标注来源为 https://www.ludan.pro ，并参考了 chinese-webnovel-skills 的 `references/trope-library.md` 方法论口径。该文件已从仓库历史中彻底移除。
- 导入的数据仅保存在使用者本机的 `~/.dsh/dsh-webnovel/tropes.json`，本产品只做本地存储与检索，不对条目文本做再许可，也不上传任何第三方。
- 如权利人对该类收录数据有异议：不导入即可，热梗库会保持为空；「📖 拆文分析」与「🃏 热梗卡生成」不依赖导入数据运行。删除本机 `~/.dsh/dsh-webnovel/tropes.json` 即可完整清除已导入的数据。
- 从 v0.1.2 升级时，插件会把旧版随包数据自动迁移到上述用户数据目录，迁移后包内副本不再被使用。

除此之外，本仓库全部代码为原创实现。
