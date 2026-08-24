//#region src/client/context.ts
/**
* Minimal context window around the selection: a short strip of nearby text
* (default ±200 chars). This is ENOUGH to disambiguate the word's meaning without
* burning tokens on the whole doc or paragraph. The context is used INTERNALLY for
* translation — it is NOT shown to the user.
*/
function buildSelectionContext(selection, docText, windowChars = 200) {
	if (!selection || !docText) return {
		selection,
		context: ""
	};
	const idx = docText.indexOf(selection);
	if (idx < 0) return {
		selection,
		context: ""
	};
	const start = Math.max(0, idx - windowChars);
	const end = Math.min(docText.length, idx + selection.length + windowChars);
	return {
		selection,
		context: docText.slice(start, end).trim().replace(/\s+/g, " ")
	};
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
				try {
					await controller.translateChunk(chunks[0].id, glossary, new AbortController().signal, (e) => {
						push(e);
						if (e.type === "done" || e.type === "error") setBusy((b) => ({
							...b,
							[chunks[0].id]: false
						}));
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					push({
						type: "error",
						requestId: chunks[0].id,
						message: msg
					});
					setBusy((b) => ({
						...b,
						[chunks[0].id]: false
					}));
				}
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
			const ctx = buildSelectionContext(text, doc.fullText);
			setSel(ctx);
			setSelResult("");
			if (!controller) return;
			try {
				const res = await controller.translateSelection({
					kind: "selection",
					selection: ctx.selection,
					context: ctx.context,
					glossary,
					target: "中文"
				}, new AbortController().signal, push);
				setSelResult(res);
			} catch (err) {
				setSelResult(err instanceof Error ? err.message : String(err));
			}
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
		}, "复制译文")), sel ? h("p", { style: {
			color: "#718096",
			marginTop: 8
		} }, "译文（已用上下文理解词义）：") : h("p", { style: {
			color: "#a0aec0",
			marginTop: 8
		} }, "选中文字后，译文会显示在这里。"), h("div", { style: {
			marginTop: 8,
			lineHeight: 1.7
		} }, selResult || ""));
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
async function post(path, body) {
	return (await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {})
	})).json();
}
function makeClientFactory() {
	return (require$1) => {
		const react = require$1("react");
		const { useState } = react;
		const h = react.createElement;
		const BilingualReader = makeReader({
			h,
			useState,
			useEffect: react.useEffect,
			useCallback: react.useCallback
		});
		const controller = {
			loadDocument: (file) => post("/bilingual-reader/extract", { path: file }),
			translateChunk: async (chunkId, _glossary, _signal, emit) => {
				emit({
					type: "start",
					requestId: chunkId
				});
				const r = await post("/bilingual-reader/translate-chunk", { chunkId });
				if (r && typeof r.text === "string") {
					emit({
						type: "done",
						requestId: chunkId,
						full: r.text
					});
					return r.text;
				}
				throw new Error(r && r.error || "translate-chunk failed");
			},
			translateSelection: async (req, _signal, _emit) => {
				const r = await post("/bilingual-reader/translate-selection", req);
				if (r && typeof r.text === "string") return r.text;
				throw new Error(r && r.error || "translate-selection failed: " + JSON.stringify(r));
			}
		};
		function ReaderTab(props) {
			const cwd = (props?.scope)?.cwd ?? "";
			const [path, setPath] = useState(cwd ? `${cwd}\\` : "");
			const [chosen, setChosen] = useState("");
			return h("div", { style: {
				padding: 12,
				display: "flex",
				flexDirection: "column",
				gap: 8,
				height: "100%"
			} }, h("div", { style: {
				display: "flex",
				gap: 8
			} }, h("input", {
				value: path,
				onChange: (e) => setPath(e.target.value),
				style: { flex: 1 }
			}), h("button", { onClick: () => setChosen(path) }, "加载")), chosen ? h(BilingualReader, {
				file: chosen,
				controller
			}) : h("p", { style: { color: "#a0aec0" } }, "输入一个 PDF 路径（默认工作区目录），点「加载」开始双语阅读。"));
		}
		const inject = ["betterSidebar", "slots"];
		const apply = (ctx) => {
			const c = ctx;
			const bs = c.betterSidebar;
			if (!bs) return;
			c.effect(() => bs.registerTab({
				id: "bilingual-reader",
				title: "双语阅读",
				component: ReaderTab
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
