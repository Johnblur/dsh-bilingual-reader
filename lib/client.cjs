//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let react = require("react");
react = __toESM(react, 1);
let react_jsx_runtime = require("react/jsx-runtime");
//#region src/client/ReaderView.tsx
function ReaderView(props) {
	const { chunks, translations, show, busy, onSelect } = props;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "br-reader",
		style: {
			display: "flex",
			flexDirection: "column",
			gap: 12,
			padding: 16
		},
		children: chunks.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
			style: { marginBottom: 8 },
			children: [
				c.heading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					style: { fontWeight: 600 },
					children: c.heading
				}),
				show !== "translation" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "br-source",
					"data-selectable": true,
					onMouseUp: (e) => onSelect?.(selectionText(e)),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Paragraphs, { text: c.text })
				}),
				show !== "original" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: text.split(/\n{2,}/).map((p, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		style: { lineHeight: 1.6 },
		children: p
	}, i)) });
}
//#endregion
//#region src/client/TranslationPane.tsx
function TranslationPane(props) {
	const { last, result, busy, error, onCopy } = props;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
		className: "br-pane",
		style: {
			width: 360,
			borderLeft: "1px solid #e2e8f0",
			padding: 12
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "br-pane-head",
				style: {
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "划词翻译" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					onClick: onCopy,
					disabled: !result,
					children: "复制译文"
				})]
			}),
			!last && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				style: { color: "#a0aec0" },
				children: "在阅读视图里选中文字后，译文会显示在这里。"
			}),
			last && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "br-selection",
				style: { marginTop: 8 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "选中：" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", {
					style: {
						borderLeft: "2px solid #cbd5e0",
						paddingLeft: 8,
						margin: "4px 0"
					},
					children: last.selection
				})]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "br-context",
				style: { marginTop: 8 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "取用上下文（前后各若干段）：" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					style: {
						whiteSpace: "pre-wrap",
						fontSize: 12,
						color: "#718096"
					},
					children: last.context
				})]
			})] }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "br-result",
				style: { marginTop: 12 },
				children: [
					busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "翻译中…" }),
					!busy && error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { color: "#e53e3e" },
						children: error
					}),
					!busy && !error && result && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
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
	const [state, setState] = react.useState({});
	return {
		state,
		start: react.useCallback((requestId) => {
			setState((s) => ({
				...s,
				[requestId]: ""
			}));
		}, []),
		push: react.useCallback((e) => {
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
	const [chunks, setChunks] = react.useState([]);
	const [doc, setDoc] = react.useState(null);
	const [glossary, setGlossary] = react.useState({});
	const [mode, setMode] = react.useState("both");
	const [busy, setBusy] = react.useState({});
	const [sel, setSel] = react.useState(null);
	const [selResult, setSelResult] = react.useState("");
	const { state: translations, push } = useTranslationStream();
	const load = react.useCallback(async () => {
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
	react.useEffect(() => {
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
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			height: "100%"
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: {
				flex: 1,
				overflow: "auto"
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: 8 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "显示：" }), [
					"original",
					"both",
					"translation"
				].map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					onClick: () => setMode(m),
					style: { marginLeft: 4 },
					children: m
				}, m))]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReaderView, {
				chunks,
				translations,
				show: mode,
				busy,
				onSelect
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TranslationPane, {
			last: sel ?? void 0,
			result: selResult
		})]
	});
}
//#endregion
//#region src/client/app.ts
function makeClientFactory() {
	return (require$1) => {
		const inject = ["betterSidebar", "slots"];
		const apply = (ctx) => {
			const c = ctx;
			const bs = c.betterSidebar;
			if (!bs) return;
			c.effect(() => bs.registerFileViewer({
				name: "bilingual-reader",
				title: "双语阅读",
				fileTypes: ["pdf"],
				component: BilingualReader
			}));
		};
		return {
			inject,
			apply
		};
	};
}
//#endregion
//#region src/client/index.ts
window.__ModuleLoader__.load({
	id: "dsh-bilingual-reader",
	factory: makeClientFactory()
});
//#endregion
