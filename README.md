# dsh-bilingual-reader

在 **dsh-better-sidebar** 里读论文原文 + 全文/划词**双语翻译**的 DSH 插件。翻译由大模型完成、占位并**完全隔离主对话上下文**。

- 全文翻译：原文/译文**上下并排**。
- 划词翻译：右侧固定面板，且带**文档上下文**（选中 + 所在段 + 相邻段 + 术语表）。
- 取文：PDF 为主，优先尝试 arXiv 文本/HTML 版。
- 隔离：所有翻译走 `ctx.llm` 的独立一次性调用，不写主会话。

详见 [DESIGN.md](./DESIGN.md)。

## 安装（仓库: github.com/Johnblur/dsh-bilingual-reader）

```sh
dsh plugin add github:Johnblur/dsh-bilingual-reader
```
（仓库推送到 GitHub 后即可安装；`lib/` 会提交构建产物，支持免编译安装。）

## 状态（v0.1 已实现，待构建验证）

设计文档 + 源码骨架 + 核心逻辑（全文/划词翻译、上下文窗、术语表、分节缓存、隔离网关）已实现；
含纯逻辑与"隔离"单元测试（`test/*.test.ts`）。

> 依赖说明：
> - DSH 运行时提供的 peer 包（`dsh-better-sidebar`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-client-runtime`、`cordis`、`react`）
>   **不由 npm 安装**，由运行中的 DSH 注入；`.npmrc` 已设 `auto-install-peers=false` + `strict-peer-dependencies=false` 以跳过这些。
> - 需从 npm 安装的是 `pdfjs-dist`（dependency）与构建/测试用 devDependencies。
> - 两处 `VERIFY`：`src/host/llmClient.ts`（`ctx.llm.prepareCall/stream` 的 messages 与 chunk 形状）、
>   `src/client/register.ts`（`registerFileViewer` 描述符字段），按你本地 DSH 类型校准。

本地验证/构建：
```sh
pnpm i          # 只装 pdfjs-dist + 构建/测试依赖
pnpm test       # vitest：纯逻辑 + 隔离测试（不需 DSH 内部类型）
pnpm build      # tsdown -> lib/ (host+client ESM) && tsc -> lib/types
pnpm selfcheck  # Node ≥22.6：快速跑纯逻辑断言（绕过沙箱禁子进程）
```
