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
//#region src/client/PdfView.ts
const PDFJS_URL = "/bilingual-reader/pdf.mjs";
const WORKER_URL = "/bilingual-reader/pdf.worker.mjs";
const dynImport = new Function("u", "return import(u)");
function makePdfView({ h, useState, useEffect }) {
	return function PdfView(props) {
		const { file, onSelect } = props;
		const [page, setPage] = useState(1);
		const [err, setErr] = useState("");
		const [hostNode, setHostNode] = useState(null);
		useEffect(() => {
			if (!hostNode) return;
			let alive = true;
			(async () => {
				try {
					const pdfjsLib = await dynImport(PDFJS_URL);
					pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
					const bytes = await (await fetch("/bilingual-reader/file?path=" + encodeURIComponent(file))).arrayBuffer();
					const pg = await (await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise).getPage(page);
					const viewport = pg.getViewport({ scale: 1.6 });
					if (!alive) return;
					hostNode.innerHTML = "";
					const canvas = document.createElement("canvas");
					canvas.width = viewport.width;
					canvas.height = viewport.height;
					const cctx = canvas.getContext("2d");
					await pg.render({
						canvasContext: cctx,
						viewport
					}).promise;
					const textDiv = document.createElement("div");
					textDiv.style.cssText = `position:absolute;top:0;left:0;width:${viewport.width}px;height:${viewport.height}px;`;
					textDiv.style.setProperty("--scale-factor", String(viewport.scale));
					await new pdfjsLib.TextLayer({
						textContentSource: pg.streamTextContent(),
						container: textDiv,
						viewport
					}).render();
					const wrapper = document.createElement("div");
					wrapper.style.cssText = `position:relative;max-width:100%;overflow:auto;`;
					wrapper.appendChild(canvas);
					wrapper.appendChild(textDiv);
					hostNode.appendChild(wrapper);
					setErr("");
				} catch (e) {
					if (alive) setErr(e instanceof Error ? e.message : String(e));
				}
			})();
			return () => {
				alive = false;
			};
		}, [
			hostNode,
			page,
			file
		]);
		return h("div", { style: {
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			gap: 6
		} }, h("div", { style: {
			display: "flex",
			gap: 6,
			alignItems: "center"
		} }, h("button", {
			onClick: () => setPage(Math.max(1, page - 1)),
			disabled: page <= 1
		}, "上一页"), h("span", void 0, "第 " + page + " 页"), h("button", { onClick: () => setPage(page + 1) }, "下一页")), err ? h("p", { style: {
			color: "#e53e3e",
			padding: 12
		} }, "加载失败：" + err) : void 0, h("div", {
			ref: (n) => setHostNode(n),
			style: {
				minHeight: 200,
				width: "100%"
			},
			onMouseUp: (e) => {
				const s = window.getSelection();
				const t = s ? String(s) : "";
				if (t.trim()) onSelect(t.trim());
			}
		}));
	};
}
//#endregion
//#region src/client/reader.ts
function makeReader({ h, useState, useEffect, useCallback }) {
	const PdfView = makePdfView({
		h,
		useState,
		useEffect
	});
	return function BilingualReader(props) {
		const { file = "", controller } = props;
		const [chunks, setChunks] = useState([]);
		const [doc, setDoc] = useState(null);
		const [glossary, setGloss] = useState({});
		const [tr, setTr] = useState({});
		const [busy, setBusy] = useState({});
		const [sel, setSel] = useState(null);
		const [selResult, setSelResult] = useState("");
		const [topPct, setTopPct] = useState(45);
		const [view, setView] = useState("pdf");
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
		}, [controller, file]);
		useEffect(() => {
			load();
		}, [load]);
		async function translateAll() {
			if (!controller) return;
			for (const c of chunks) {
				if (tr[c.id]) continue;
				setBusy((b) => ({
					...b,
					[c.id]: true
				}));
				try {
					await controller.translateChunk(c.id, glossary, new AbortController().signal, (e) => {
						push(e);
						if (e.type === "done" || e.type === "error") setBusy((b) => ({
							...b,
							[c.id]: false
						}));
					});
				} catch (err) {
					push({
						type: "error",
						requestId: c.id,
						message: err instanceof Error ? err.message : String(err)
					});
					setBusy((b) => ({
						...b,
						[c.id]: false
					}));
				}
			}
		}
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
		function onDividerDown(e) {
			e.preventDefault();
			const rect = e.currentTarget.parentElement.getBoundingClientRect();
			const div = e.currentTarget;
			document.body.style.userSelect = "none";
			const startY = e.clientY;
			const startPct = topPct;
			const mm = (ev) => {
				ev.preventDefault();
				const dy = ev.clientY - startY;
				setTopPct(Math.max(8, Math.min(92, startPct + dy / rect.height * 100)));
			};
			const done = () => {
				document.body.style.userSelect = "";
				window.removeEventListener("mousemove", mm);
				window.removeEventListener("mouseup", done);
				try {
					div.releasePointerCapture(e.pointerId);
				} catch {}
				div.removeEventListener("pointermove", mm);
				div.removeEventListener("pointerup", done);
			};
			window.addEventListener("mousemove", mm);
			window.addEventListener("mouseup", done);
			try {
				div.setPointerCapture(e.pointerId);
			} catch {}
			div.addEventListener("pointermove", mm);
			div.addEventListener("pointerup", done);
		}
		return h("div", { style: {
			display: "flex",
			flexDirection: "column",
			height: "100%"
		} }, h("div", { style: {
			height: `${topPct}%`,
			overflow: "auto",
			padding: 16
		} }, h("div", { style: {
			position: "sticky",
			top: 0,
			paddingBottom: 8,
			background: "#fff",
			display: "flex",
			gap: 8,
			alignItems: "center"
		} }, h("span", void 0, "原文："), h("button", {
			onClick: () => setView("pdf"),
			style: { fontWeight: view === "pdf" ? 700 : 400 }
		}, "PDF"), h("button", {
			onClick: () => setView("text"),
			style: { fontWeight: view === "text" ? 700 : 400 }
		}, "文本"), h("button", {
			onClick: () => void translateAll(),
			disabled: !chunks.length
		}, "翻译全文")), view === "pdf" ? h(PdfView, {
			file,
			onSelect
		}) : chunks.map((c) => h("section", {
			key: c.id,
			style: { marginBottom: 10 }
		}, c.heading ? h("h3", { style: { fontWeight: 600 } }, c.heading) : void 0, h("div", { onMouseUp: (e) => {
			const s = window.getSelection();
			const t = s ? String(s) : "";
			if (t.trim()) onSelect(t.trim());
		} }, (c.text || "").split(/\n{2,}/).map((p, i) => h("p", {
			key: i,
			style: { lineHeight: 1.6 }
		}, p)))))), h("div", {
			onPointerDown: onDividerDown,
			style: {
				height: 8,
				cursor: "row-resize",
				background: "#e2e8f0",
				flex: "none",
				userSelect: "none",
				touchAction: "none"
			}
		}), h("div", { style: {
			flex: 1,
			overflow: "auto",
			padding: 16,
			borderTop: "1px solid #e2e8f0"
		} }, sel ? h("div", {}, h("div", { style: {
			display: "flex",
			alignItems: "center",
			gap: 8
		} }, h("strong", void 0, "译文"), h("button", {
			disabled: !selResult,
			onClick: () => {
				if (selResult) navigator.clipboard.writeText(selResult);
			}
		}, "复制译文")), h("div", { style: {
			marginTop: 6,
			lineHeight: 1.7
		} }, selResult || "翻译中…")) : h("div", {}, h("strong", void 0, "译文"), chunks.filter((c) => tr[c.id]).length ? chunks.filter((c) => tr[c.id]).map((c) => h("div", {
			key: c.id,
			style: { marginBottom: 8 }
		}, c.heading ? h("small", { style: { color: "#718096" } }, c.heading) : void 0, h("p", { style: { lineHeight: 1.7 } }, tr[c.id]))) : h("p", { style: { color: "#a0aec0" } }, "点「翻译全文」或选中原文里的词，译到这里。"))));
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
