# dsh-bilingual-reader

[中文](./README.md) | English

A **DeepSeek Harness (DSH)** plugin that lets you read academic PDFs in the `dsh-better-sidebar` and translate a selection with an LLM.

> Open a PDF in the sidebar → select and copy a sentence → the plugin translates it with the LLM **using context**. Translation uses DSH's existing model and is **fully isolated from the main conversation** — a reading aid only.

## Use case

- You open a paper PDF in DSH's sidebar (better-sidebar) to read it.
- You want to quickly understand a sentence or term: **select + copy**, and the plugin translates it.
- You don't want to spam the main conversation — translation happens entirely in the plugin and **never touches the main conversation context**.

## Features

- **Native PDF rendering**: shown with the browser / Electron PDF engine — **pixel-perfect layout**, pageable, copyable, identical to the built-in viewer.
- **Selection translation**: copy the selected text → on Desktop (Electron) it **auto-translates**; when auto is unavailable, click the "Translate selection" button.
- **Context-aware**: finds the **unique position** of the copied text in the full document and uses the surrounding text as context. A unique match gives the best result; multiple/no match falls back to **context-free translation** (to avoid feeding a possibly-wrong context).
- **Adjustable context length**: a slider controls how much surrounding text is used as context.
- **Original + translation side by side**: shows the copied original and the translation below, plus a one-click **copy translation**.
- **Isolated from the main conversation**: translation runs as a one-off `ctx.llm` call and is **never written back** to the main session.

## Install

```sh
dsh plugin add github:Johnblur/dsh-bilingual-reader
```

Then **fully quit the DSH Desktop** from the tray and relaunch.

## Usage

1. In the better-sidebar, open `+` → the "**Bilingual Reader**" tab (the tab strip shows `translator`; the + menu shows `翻译` / `translator` per UI language).
2. Enter or paste a PDF path → click "**Load**".
3. In the PDF above, **select some text and copy it**:
   - Desktop (Electron): detected via clipboard change → **auto-translates**.
   - Web / when auto is unavailable: click the "**Translate selection**" button.
4. The **original + translation** appear below; use the context slider to tune the context length.

## Dependencies & notes

- Depends on DSH runtime services (`dsh-better-sidebar`, `@deepseek-ai/dsh-llm`) and `pdfjs-dist` (host-side text extraction).
- **Reuses DSH's configured model & API key** (no extra key). Override with env vars:
  - `DSH_BILINGUAL_PROVIDER` (default `deepseek-official`)
  - `DSH_BILINGUAL_MODEL` (default `deepseek-v4-flash-vision-exp`)
- "Auto-translate" relies on the host reading the system clipboard (Electron desktop); a pure web build lacks that and uses the button.

## Build from source (developers)

```sh
pnpm i
pnpm build      # tsdown -> lib/ + tsc -> lib/types
pnpm test       # vitest: pure logic + isolation tests
```

## FAQ

- **Copying doesn't auto-translate**: make sure you're on the Desktop (Electron) build, or click the "Translate selection" button.
- **No context used**: the selected word appears multiple times / has no unique match → the plugin intentionally translates without context to avoid a wrong context.
- **Best accuracy**: select a **full sentence** instead of a single word — it usually matches uniquely.
- **The tab still shows an old title after reopening**: an open tab froze its title when it was opened; close it and reopen via `+` to display `translator`.

## License

MIT
