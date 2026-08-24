# dsh-bilingual-reader — 设计说明 (DESIGN)

> 在 **dsh-better-sidebar** 里读论文原文 + 全文/划词**双语翻译** + **完全隔离主对话上下文**的 DSH 插件。
> 设计版本: v0.1 (MVP 设计) · 目标: 先出设计 + 骨架，评审后再写功能代码。

---

## 1. 目标与需求映射

| # | 用户需求 | 落地方式 |
|---|---|---|
| 1a | 全文翻译：原文/译文**上下并排** | 插件自带"双语阅读"视图：按段落渲染原文，每段正下方紧跟译文；标题/公式/参考文献原样保留；每节可折叠。 |
| 1b | 划词翻译（不用悬浮窗，用固定小空间） | **右侧固定翻译面板**：在阅读视图选中文字 → 固定"译"按钮 → 面板显示译文 + 上下文摘要。 |
| 2 | **隔离主对话框上下文** | 所有翻译走 `ctx.llm` 的**独立一次性调用**（`prepareCall`/`stream`），插件自建 `messages`；绝不向主会话写消息。测试断言"主会话历史长度不变"。 |
| 3 | 划词翻译**依赖文档上下文** | 默认上下文窗口 = **选中片段 + 所在自然段 + 前后各一段**，并注入**论文术语表**；窗口可调（±0 / ±1 / 整节）。 |

**附加不变量：**
- 对文档**只读**；所有输出只到插件自己的 UI / 缓存（`.zh` 侧文件）。
- 可选**按模式分模型**：全文用强模型、划词用快模型。
- 术语一致性：先抽取论文术语表，全文与划词共用。

---

## 2. 技术底座（已核实）

- **better-sidebar** (`dsh-better-sidebar` ≥0.4 版) 暴露 `ctx.betterSidebar` (仅 client 侧)，提供
  `registerTab(...)` 与 `registerFileViewer(...)`；内置 viewer 为 image/pdf/markdown/html/code/binary-download。
  → 我们**注册一个自己的 PDF 阅读/翻译视图**（不走内置 pdf viewer 的覆盖），以便叠加翻译与选中。
- **`@deepseek-ai/dsh-llm`** 暴露 `LlmRuntime` 服务（注入键 `llm`）。关键 API：
  - `ctx.llm.stream(options): AsyncIterable<chunk>` — 一次独立模型调用，`options.messages` 由调用方构造。
  - `ctx.llm.prepareCall(config)` → `{ stream(options) }` — 预绑定 provider/model 的一次性调用。
  - `options` 含 `provider` / `model` / `messages` / `signal`。
  → **这天然隔离**：调用与主对话线程无关，复用 DSH 已配置的 adapter/provider（即"复用现有模型、无额外 key"）。

---

## 3. 架构

```
┌─────────────────────────────── DSH (Cordis plugin bundle) ───────────────────────────────┐
│  HOST (Node)                              │  CLIENT (React/wasm, browser-side)            │
│  ───────────────────────────             │  ──────────────────────────────────           │
│  inject: ['llm', 'fs']                     │  inject: ['betterSidebar', 'slots']          │
│  pdf.ts      PDF 取文 (pdfjs + 双栏/标题)   │  register.ts   registerFileViewer/tab 注册     │
│  chunk.ts    章节感知切块                    │  ReaderView    原文/译文 上下堆叠阅读视图       │
│  glossary.ts 术语表抽取                     │  TranslationPane 右侧固定划词翻译面板          │
│  translate.ts ctx.llm.stream 全文/划词调用  │  hooks.ts     SSE 流式刷新、选中上下文构建       │
│  cache.ts    .zh 侧文件缓存/增量            │                                                │
└──────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

数据流：

- **全文翻译**：`打开 PDF` → host `pdf.ts` 取文 → `chunk.ts` 按节切块
  （可先尝试 arXiv 的 HTML/文本版提高取文质量，见 §5）→ `glossary.ts` 抽术语表
  → `translate.ts` 逐节 `ctx.llm.stream(...)`（SSE 流式）→ client 渲染成"原文上/译文下"
  → `cache.ts` 落 `.zh` 侧缓存。
- **划词翻译**：在阅读视图 `选中文字` → client 构建上下文窗（选中+所在段+相邻段+术语表）
  → host `translate.ts` 一次 `ctx.llm.stream(...)` → 右侧 `TranslationPane` 显示。

---

## 4. 隔离机制的硬性保证

- host 只在 `ctx.llm.stream / prepareCall` 上发起调用，**不调用**任何"追加到会话历史"的 API。
- 结果只用于渲染与缓存；**不生成主对话消息**。
- 单元/集成测试：mock 会话历史，断言翻译调用前后**主会话 `messages` 长度/内容不变**；
  再断言插件只读（不写回 PDF）。

---

## 5. 取文策略（"PDF 优先，兼用 arXiv 文本"）

1. 有网络时，先尝试按 arXiv id 抓 HTML/文本版（`arxiv.org/html/<id>` 或 `abs` 页），
   文本质量远高于 PDF 双栏 → 优先用于上下文与划词。
2. 无网络/取不到时，回退到本地 PDF 的 pdfjs 文本层：
   - 用行宽/坐标启发式判断**双栏**，按栏重排；识别标题层级用于切块。
   - 公式、图表、引用编号尽量保留占位（`[eq]`、`[fig]`），不硬翻。
3. 用 `#`/`##`/`###` 标题 + 段落边界做**章节感知切块**；每块独立翻译并缓存。

---

## 6. 模型路由

```ts
config.translation = {
  fullText:   { provider: 'deepseek', model: 'deepseek-ai/DeepSeek-V3.2' },   // 强、保质
  selection:  { provider: 'deepseek', model: 'deepseek-ai/DeepSeek-V4-Flash' } // 快、省
}
```
- 通过插件设置（`ctx.settings` / better-sidebar 插件设置）覆写 provider/model，默认跟随 DSH 现有模型。

---

## 7. 状态与 UI

- **全文视图**：`原文 / 译文 / 原文+译文` 三态切换（默认双栏叠加=上下）；每节折叠；显示生成进度。
- **划词面板**：右侧固定，显示"选中文本 / 取用上下文 / 译文"，带"复制译文"。
- **术语表**：可查看/编辑，作用于全文与划词。

---

## 8. 缓存与增量

- 每节译文存到 `<pdf 同目录>.<basename>.zh.json`（或插件工作区），记录"源哈希→译文"。
- 再次打开：hash 未变则直接显示缓存，增量只译新增/变化的节。

---

## 9. MITIGations / 风险

| 风险 | 缓解 |
|---|---|
| **双栏学术 PDF 取文质量**（主要风险） | arXiv 文本优先；pdfjs 双栏/标题启发式；允许划线时手动微调选区；保存取文结果便于人工纠错。 |
| 全文翻译 token 成本 | 只译可见/所需部分；切块+缓存+增量；按模式分模型。 |
| 隔离失效 | 只走 `ctx.llm`；专用测试断言主会话历史不变。 |
| 隐私 | 复用 DSH 现有模型（数据发送到 DSH 配置的 provider，与主对话同档）；不写第三方 key。 |
| 长文超上下文 | 每节上下文+术语表足以覆盖；可调"整节"窗口，避免超限。 |

---

## 10. 目录骨架

```
dsh-bilingual-reader/
├── package.json          # dsh 插件清单（bundle/client inject、deps）
├── tsconfig.json
├── README.md             # 安装/使用
├── DESIGN.md             # 本文件
├── lib/                  # 构建产物（git 安装时提交，供 dsh plugin add）
└── src/
    ├── index.ts          # host 入口
    ├── client.tsx        # client 入口
    ├── host/{pdf,chunk,glossary,translate,cache,model}.ts
    └── client/{register,ReaderView,TranslationPane,hooks}.tsx
```

## 11. 里程碑

- **v0.1 MVP**：注册 PDF 双语视图；全文翻译（上下并排、术语表、分节缓存、SSE）；划词→右侧面板（带上下文窗）；隔离断言。
- **v0.2**：arXiv 文本优先取文；双栏 PDF 启发式增强；术语表 UI；增量翻译。
- **v0.3**：多文档、导出译文、模型路由更多 provider。

## 12. 待确认

- 插件源码仓库地址（安装用 `dsh plugin add github:<user>/<repo>`）。
- 全文翻译"原文+译文"默认是否自动全量翻译，还是"按需逐节"。
