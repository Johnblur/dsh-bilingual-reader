import * as React from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/client/ReaderView.tsx
function ReaderView(props) {
	const { chunks, translations, show, busy, onSelect } = props;
	return /* @__PURE__ */ jsx("div", {
		className: "br-reader",
		style: {
			display: "flex",
			flexDirection: "column",
			gap: 12,
			padding: 16
		},
		children: chunks.map((c) => /* @__PURE__ */ jsxs("section", {
			style: { marginBottom: 8 },
			children: [
				c.heading && /* @__PURE__ */ jsx("h3", {
					style: { fontWeight: 600 },
					children: c.heading
				}),
				show !== "translation" && /* @__PURE__ */ jsx("div", {
					className: "br-source",
					"data-selectable": true,
					onMouseUp: (e) => onSelect?.(selectionText(e)),
					children: /* @__PURE__ */ jsx(Paragraphs, { text: c.text })
				}),
				show !== "original" && /* @__PURE__ */ jsx("div", {
					className: "br-translation",
					style: { color: "#2b6cb0" },
					children: translations[c.id] || (busy?.[c.id] ? "翻译中…" : "—")
				})
			]
		}, c.id))
	});
}
function selectionText(e) {
	const sel = window.getSelection();
	return (sel ? sel.toString() : "").trim();
}
function Paragraphs({ text }) {
	return /* @__PURE__ */ jsx(Fragment, { children: text.split(/\n{2,}/).map((p, i) => /* @__PURE__ */ jsx("p", {
		style: { lineHeight: 1.6 },
		children: p
	}, i)) });
}
//#endregion
//#region src/client/TranslationPane.tsx
function TranslationPane(props) {
	const { last, result, busy, error, onCopy } = props;
	return /* @__PURE__ */ jsxs("aside", {
		className: "br-pane",
		style: {
			width: 360,
			borderLeft: "1px solid #e2e8f0",
			padding: 12
		},
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "br-pane-head",
				style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center"
				},
				children: [/* @__PURE__ */ jsx("strong", { children: "划词翻译" }), /* @__PURE__ */ jsx("button", {
					onClick: onCopy,
					disabled: !result,
					children: "复制译文"
				})]
			}),
			!last && /* @__PURE__ */ jsx("p", {
				style: { color: "#a0aec0" },
				children: "在阅读视图里选中文字后，译文会显示在这里。"
			}),
			last && /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("div", {
				className: "br-selection",
				style: { marginTop: 8 },
				children: [/* @__PURE__ */ jsx("small", { children: "选中：" }), /* @__PURE__ */ jsx("blockquote", {
					style: {
						borderLeft: "2px solid #cbd5e0",
						paddingLeft: 8,
						margin: "4px 0"
					},
					children: last.selection
				})]
			}), /* @__PURE__ */ jsxs("div", {
				className: "br-context",
				style: { marginTop: 8 },
				children: [/* @__PURE__ */ jsx("small", { children: "取用上下文（前后各若干段）：" }), /* @__PURE__ */ jsx("pre", {
					style: {
						whiteSpace: "pre-wrap",
						fontSize: 12,
						color: "#718096"
					},
					children: last.context
				})]
			})] }),
			/* @__PURE__ */ jsxs("div", {
				className: "br-result",
				style: { marginTop: 12 },
				children: [
					busy && /* @__PURE__ */ jsx("span", { children: "翻译中…" }),
					!busy && error && /* @__PURE__ */ jsx("span", {
						style: { color: "#e53e3e" },
						children: error
					}),
					!busy && !error && result && /* @__PURE__ */ jsx("div", {
						style: { lineHeight: 1.7 },
						children: result
					})
				]
			})
		]
	});
}
//#endregion
//#region src/client/hooks.ts
/**
* Build the context window for a highlighted selection.
* context = the paragraph containing the selection ± `windowSize` neighboring
* paragraphs (default 1). This is what satisfies "translation must use document
* context, not just the bare selection."
*/
function buildSelectionContext(selection, docText, paragraphs, windowSize = 1) {
	if (!selection || !docText) return {
		selection,
		context: ""
	};
	const idx = docText.indexOf(selection);
	const lines = docText.split(/\r?\n/);
	const startLine = idx >= 0 ? directionCount(docText, idx, "\n") : 0;
	let pIdx = paragraphs.findIndex((p) => startLine >= p.start && startLine < p.end);
	if (pIdx < 0) pIdx = paragraphs.length ? 0 : -1;
	if (pIdx < 0) return {
		selection,
		context: selection
	};
	const lo = Math.max(0, pIdx - windowSize);
	const hi = Math.min(paragraphs.length - 1, pIdx + windowSize);
	const parts = [];
	for (let i = lo; i <= hi; i++) {
		const p = paragraphs[i];
		parts.push(lines.slice(p.start, p.end).join("\n"));
	}
	return {
		selection,
		context: parts.join("\n\n")
	};
}
function directionCount(s, upto, char) {
	let n = 0;
	for (let i = 0; i < upto; i++) if (s[i] === char) n++;
	return n;
}
/** Subscribe to host-driven translation events and accumulate the streamed text. */
function useTranslationStream() {
	const [state, setState] = React.useState({});
	return {
		state,
		start: React.useCallback((requestId) => {
			setState((s) => ({
				...s,
				[requestId]: ""
			}));
		}, []),
		push: React.useCallback((e) => {
			if (e.type === "delta") setState((s) => ({
				...s,
				[e.requestId]: (s[e.requestId] ?? "") + e.text
			}));
			else if (e.type === "done") setState((s) => ({
				...s,
				[e.requestId]: e.full
			}));
			else if (e.type === "error") setState((s) => ({
				...s,
				[e.requestId]: `[error] ${e.message}`
			}));
		}, [])
	};
}
//#endregion
//#region src/client/BilingualReader.tsx
function BilingualReader(props) {
	const { file = "", controller } = props;
	const [chunks, setChunks] = React.useState([]);
	const [doc, setDoc] = React.useState(null);
	const [glossary, setGlossary] = React.useState({});
	const [mode, setMode] = React.useState("both");
	const [busy, setBusy] = React.useState({});
	const [sel, setSel] = React.useState(null);
	const [selResult, setSelResult] = React.useState("");
	const { state: translations, push } = useTranslationStream();
	const load = React.useCallback(async () => {
		if (!controller || !file) return;
		const { text, chunks, glossary } = await controller.loadDocument(file);
		setDoc(text);
		setChunks(chunks);
		setGlossary(glossary);
		if (chunks[0]) {
			setBusy((b) => ({
				...b,
				[chunks[0].id]: true
			}));
			const sig = new AbortController().signal;
			await controller.translateChunk(chunks[0].id, glossary, sig, (e) => {
				push(e);
				if (e.type === "done" || e.type === "error") setBusy((b) => ({
					...b,
					[chunks[0].id]: false
				}));
			});
		}
	}, [
		controller,
		file,
		push
	]);
	React.useEffect(() => {
		load();
	}, [load]);
	async function onSelect(text) {
		if (!text || !doc) return;
		const ctx = buildSelectionContext(text, doc.fullText, doc.paragraphs, 1);
		setSel(ctx);
		setSelResult("");
		if (!controller) return;
		const signal = new AbortController().signal;
		const res = await controller.translateSelection({
			kind: "selection",
			selection: ctx.selection,
			context: ctx.context,
			glossary,
			target: "中文"
		}, signal, push);
		setSelResult(res);
	}
	return /* @__PURE__ */ jsxs("div", {
		style: {
			display: "flex",
			height: "100%"
		},
		children: [/* @__PURE__ */ jsxs("div", {
			style: {
				flex: 1,
				overflow: "auto"
			},
			children: [/* @__PURE__ */ jsxs("div", {
				style: { padding: 8 },
				children: [/* @__PURE__ */ jsx("span", { children: "显示：" }), [
					"original",
					"both",
					"translation"
				].map((m) => /* @__PURE__ */ jsx("button", {
					onClick: () => setMode(m),
					style: { marginLeft: 4 },
					children: m
				}, m))]
			}), /* @__PURE__ */ jsx(ReaderView, {
				chunks,
				translations,
				show: mode,
				busy,
				onSelect
			})]
		}), /* @__PURE__ */ jsx(TranslationPane, {
			last: sel ?? void 0,
			result: selResult
		})]
	});
}
//#endregion
//#region src/client/register.ts
const inject = ["betterSidebar"];
function apply(ctx) {
	const bs = ctx.betterSidebar;
	if (!bs) return;
	ctx.effect(() => bs.registerFileViewer({
		name: "bilingual-reader",
		title: "双语阅读",
		fileTypes: ["pdf"],
		component: BilingualReader
	}));
}
//#endregion
export { BilingualReader, apply, inject };
