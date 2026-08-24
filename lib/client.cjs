//#region src/client/context.ts
/**
* Build the context window for a highlighted selection: the paragraph containing
* the selection ± `windowSize` neighboring paragraphs (default 1). This satisfies
* "translation must use document context, not just the bare selection."
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
//#endregion
//#region src/client/reader.ts
function makeReader({ h, useState, useEffect, useCallback }) {
	return function BilingualReader(props) {
		const { file = "", controller } = props;
		const [chunks, setChunks] = useState([]);
		const [doc, setDoc] = useState(null);
		const [glossary, setGloss] = useState({});
		const [mode, setMode] = useState("both");
		const [tr, setTr] = useState({});
		const [busy, setBusy] = useState({});
		const [sel, setSel] = useState(null);
		const [selResult, setSelResult] = useState("");
		const push = useCallback((e) => {
			if (e.type === "delta") setTr((s) => ({
				...s,
				[e.requestId]: (s[e.requestId] ?? "") + e.text
			}));
			else if (e.type === "done") setTr((s) => ({
				...s,
				[e.requestId]: e.full
			}));
			else if (e.type === "error") setTr((s) => ({
				...s,
				[e.requestId]: `[error] ${e.message}`
			}));
		}, []);
		const load = useCallback(async () => {
			if (!controller || !file) return;
			const { text, chunks, glossary } = await controller.loadDocument(file);
			setDoc(text);
			setChunks(chunks);
			setGloss(glossary);
			if (chunks[0]) {
				setBusy((b) => ({
					...b,
					[chunks[0].id]: true
				}));
				await controller.translateChunk(chunks[0].id, glossary, new AbortController().signal, (e) => {
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
		useEffect(() => {
			load();
		}, [load]);
		async function onSelect(text) {
			if (!text || !doc) return;
			const ctx = buildSelectionContext(text, doc.fullText, doc.paragraphs, 1);
			setSel(ctx);
			setSelResult("");
			if (!controller) return;
			const res = await controller.translateSelection({
				kind: "selection",
				selection: ctx.selection,
				context: ctx.context,
				glossary,
				target: "中文"
			}, new AbortController().signal, push);
			setSelResult(res);
		}
		const modeButtons = [
			"original",
			"both",
			"translation"
		].map((m) => h("button", {
			key: m,
			onClick: () => setMode(m),
			style: { marginLeft: 4 }
		}, m));
		const sections = chunks.map((c) => h("section", {
			key: c.id,
			style: { marginBottom: 8 }
		}, c.heading ? h("h3", { style: { fontWeight: 600 } }, c.heading) : void 0, mode !== "translation" ? h("div", { onMouseUp: (e) => {
			const s = window.getSelection();
			const t = s ? String(s) : "";
			if (t.trim()) onSelect(t.trim());
		} }, (c.text || "").split(/\n{2,}/).map((p, i) => h("p", {
			key: i,
			style: { lineHeight: 1.6 }
		}, p))) : void 0, mode !== "original" ? h("div", { style: { color: "#2b6cb0" } }, tr[c.id] || (busy[c.id] ? "翻译中…" : "—")) : void 0));
		const pane = h("aside", { style: {
			width: 360,
			borderLeft: "1px solid #e2e8f0",
			padding: 12
		} }, h("div", { style: {
			display: "flex",
			justifyContent: "space-between",
			alignItems: "center"
		} }, h("strong", void 0, "划词翻译"), h("button", {
			disabled: !selResult,
			onClick: () => {
				if (selResult) navigator.clipboard.writeText(selResult);
			}
		}, "复制译文")), sel ? [h("div", { style: { marginTop: 8 } }, h("small", void 0, "选中："), h("blockquote", { style: {
			borderLeft: "2px solid #cbd5e0",
			paddingLeft: 8,
			margin: "4px 0"
		} }, sel.selection)), h("div", { style: { marginTop: 8 } }, h("small", void 0, "上下文："), h("pre", { style: {
			whiteSpace: "pre-wrap",
			fontSize: 12,
			color: "#718096"
		} }, sel.context))] : h("p", { style: { color: "#a0aec0" } }, "选中文字后译文显示在此。"), h("div", { style: { marginTop: 12 } }, selResult || ""));
		return h("div", { style: {
			display: "flex",
			height: "100%"
		} }, h("div", { style: {
			flex: 1,
			overflow: "auto"
		} }, h("div", { style: { padding: 8 } }, h("span", void 0, "显示："), ...modeButtons), h("div", { style: {
			display: "flex",
			flexDirection: "column",
			gap: 12,
			padding: 16
		} }, ...sections)), pane);
	};
}
//#endregion
//#region src/client/app.ts
function makeClientFactory() {
	return (require$1) => {
		const react = require$1("react");
		const BilingualReader = makeReader({
			h: react.createElement,
			useState: react.useState,
			useEffect: react.useEffect,
			useCallback: react.useCallback
		});
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
