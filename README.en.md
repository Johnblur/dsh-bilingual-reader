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
- **Selection translation**: copy the selected text → on Desktop it **auto-translates**; when auto is unavailable, click the "**Translate**" button, or press **Ctrl+V** inside the plugin to paste-and-translate (needs no permission, so it always works).
- **Multi-language mutual translation**: separate Source / Target dropdowns. Ships with **Chinese / English / Japanese / Korean**, and you can **add any language** via "＋语言…". The default target follows the UI language.
- **Language auto-detect**: with Source set to "**Auto-detect**", a zero-cost character-class heuristic classifies the text (Chinese / Japanese / Korean are unambiguous). Only when the active set has **multiple same-script languages** (e.g. English + French + German) or the heuristic read is unclear does it run one LLM classify; the result **pre-fills** the Source dropdown and is always editable.
- **Context-aware**: finds the **unique position** of the copied text in the full document and uses the surrounding text as context. A unique match gives the best result; multiple/no match falls back to **context-free translation** (to avoid feeding a possibly-wrong context).
- **Adjustable context length**: a slider controls how much surrounding text is used as context.
- **Persistent settings**: source, target, context length, and custom languages are remembered across reopens.
- **Original + translation side by side**: shows the copied original and the translation below, plus a one-click **copy translation**.
- **Isolated from the main conversation**: translation runs as a one-off `ctx.llm` call and is **never written back** to the main session.

> **Small languages**: translation quality is bounded by the underlying LLM. The plugin pins the source/target language names (and lets you add a custom name) to steer the model, but the ceiling for low-resource languages is the model's own capability.

## Install

```sh
dsh plugin add github:Johnblur/dsh-bilingual-reader
```

Then **fully quit the DSH Desktop** from the tray and relaunch.

## Usage

1. In the better-sidebar, open `+` → the "**Bilingual Reader**" tab (the tab strip shows `translator`; the + menu shows `翻译` / `translator` per UI language).
2. Click "**Browse…**" to pick a PDF from the workspace, or enter/paste a path and click "**Load**".
3. In the PDF above, **select some text and copy it**:
   - Desktop: the host watches the system clipboard → **auto-translates**.
   - When auto is unavailable: click the "**Translate**" button, or press **Ctrl+V** in the tab (the paste event carries the clipboard text itself and needs no permission).
4. The **original + translation** appear below; use the dropdowns to pick the mutual-translation languages (Source set to "Auto-detect" lets the plugin judge it), the **context** slider to tune the context length, and the **domain** dropdown to pin a field or let the plugin detect it.

## Dependencies & notes

- Depends on DSH runtime services (`dsh-better-sidebar`, `@deepseek-ai/dsh-llm`) and `pdfjs-dist` (host-side text extraction).
- **Compatible DSH version**: `@deepseek-ai/dsh-llm` **≥ 0.1.2-rc.1** (`deepFreeze` was dropped from `dsh-llm`'s public exports; v1.0.2 no longer needs it). `dsh-better-sidebar` **≥ 0.17.1**. If the plugin reports `does not provide an export named 'deepFreeze'` after a DSH update, upgrade the plugin to v1.0.2+.
- **DSH Desktop 2.0.9+**: from that version the host runs inside an Electron `utilityProcess`, where `electron.clipboard` is gone. Since v1.1.1 the plugin ships its own OS clipboard watcher, and it fixes pdfjs being mistaken for a browser under `utilityProcess`, which had broken PDF text extraction. If copying stops triggering translation after a DSH update, upgrade the plugin to v1.1.1+.
- **Reuses DSH's configured model & API key** (no extra key). Override with env vars:
  - `DSH_BILINGUAL_PROVIDER` (default `deepseek-official`)
  - `DSH_BILINGUAL_MODEL` (default `deepseek-v4-flash-vision-exp`)
- "Auto-translate" relies on the host reading the system clipboard; where that is unavailable (e.g. a pure web build) use the "Translate" button or **Ctrl+V**.

## Build from source (developers)

```sh
pnpm i
pnpm build      # tsdown -> lib/ + tsc -> lib/types
pnpm typecheck  # tsc --noEmit, covers src/ and test/
pnpm test       # vitest: pure logic + isolation tests
pnpm selfcheck  # pure-logic self-check; use it when vitest cannot spawn in the DSH sandbox
```

## FAQ

- **Copying doesn't auto-translate**: make sure you're on the Desktop build, or click the "Translate" button, or press **Ctrl+V** in the tab.
- **No domain detected / "no text extracted from this PDF"**: check the diagnostic line in the tab first — it states the actual reason (load failure, scanned PDF, or a domain-classification failure).
- **No context used**: the selected word appears multiple times / has no unique match → the plugin intentionally translates without context to avoid a wrong context.
- **Best accuracy**: select a **full sentence** instead of a single word — it usually matches uniquely.
- **The tab still shows an old title after reopening**: an open tab froze its title when it was opened; close it and reopen via `+` to display `translator`.

## License

MIT
