# 第三方组件署名（Notices）

本产品的 22 个分析维度之方法论与 prompt 知识，提炼、改编自以下开源项目：

- **chinese-webnovel-skills（网文工坊 WebNovel Studio）**
  - 仓库：https://github.com/tance-mang/chinese-webnovel-skills
  - 许可证：MIT License，Copyright (c) 2026 tance-mang
  - 完整许可证原文见：`third-party-licenses/chinese-webnovel-skills-LICENSE.txt`
  - 本产品对其 SKILL.md 与 references 知识库中的方法论进行了提炼与重组，未直接分发其原文；遵循其"学结构不抄字"的原创底线，本产品输出的是分析报告而非小说成稿。

## 热梗库数据

- 文件：`plugin/data/tropes.json`（240 条网络热梗卡片，含弧线/机制/题材/设定四个分面，其中 33 条为含四件套、情绪引擎、虐点与高光的富卡片）
- 来源：随项目使用者提供的收录数据，数据内标注来源为 https://www.ludan.pro ，并参考了 chinese-webnovel-skills 的 `references/trope-library.md` 方法论口径
- 本产品仅在本地按原结构存储与检索该数据集，未对条目文本做再许可；如权利人对收录有异议，可通过删除 `plugin/data/tropes.json` 完整移除热梗库功能（拆文分析与 AI 热梗卡生成不依赖该文件运行）。

除此之外，本仓库全部代码为原创实现。
