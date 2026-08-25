//#region src/client/PdfView.ts
function makePdfView({ h, useState, useEffect }) {
	return function PdfView(props) {
		const { file } = props;
		const [url, setUrl] = useState("");
		const [err, setErr] = useState("");
		useEffect(() => {
			let objectUrl;
			let alive = true;
			setErr("");
			setUrl("");
			(async () => {
				try {
					const res = await fetch("/bilingual-reader/file?path=" + encodeURIComponent(file));
					if (!res.ok) throw new Error("HTTP " + res.status);
					const bytes = await res.arrayBuffer();
					if (!alive) return;
					objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
					setUrl(objectUrl);
				} catch (e) {
					if (alive) setErr(e instanceof Error ? e.message : String(e));
				}
			})();
			return () => {
				alive = false;
				if (objectUrl) URL.revokeObjectURL(objectUrl);
			};
		}, [file]);
		return h("div", { style: {
			display: "flex",
			flexDirection: "column",
			height: "100%",
			width: "100%"
		} }, err ? h("div", { style: {
			color: "#e53e3e",
			padding: 12,
			fontSize: 13
		} }, "加载失败：" + err) : url ? h("iframe", {
			src: url,
			title: "PDF",
			style: {
				flex: 1,
				width: "100%",
				border: 0,
				background: "#fff"
			}
		}) : h("p", { style: {
			color: "#8a8a8a",
			padding: 12
		} }, "加载 PDF…"));
	};
}
//#endregion
//#region src/client/reader.ts
function makeReader({ h, useState, useEffect, useCallback, useRef }) {
	const PdfView = makePdfView({
		h,
		useState,
		useEffect
	});
	return function BilingualReader(props) {
		const { file = "", controller } = props;
		const [doc, setDoc] = useState(null);
		const [glossary, setGloss] = useState({});
		const [sel, setSel] = useState(null);
		const [selResult, setSelResult] = useState("");
		const [topPct, setTopPct] = useState(52);
		const [contextLen, setContextLen] = useState(250);
		const [clipAvailable, setClipAvailable] = useState(false);
		const [selError, setSelError] = useState(false);
		const reqSeq = useRef(0);
		const load = useCallback(async () => {
			if (!controller || !file) return;
			const { text, glossary } = await controller.loadDocument(file);
			setDoc(text);
			setGloss(glossary);
		}, [controller, file]);
		useEffect(() => {
			load();
		}, [load]);
		const normalize = (s) => s.replace(/\s+/g, " ").trim();
		async function doTranslate(copied) {
			const seq = ++reqSeq.current;
			if (!copied) {
				setSel({
					selection: "",
					context: ""
				});
				setSelError(true);
				setSelResult("（剪贴板为空：请先在 PDF 里选中并复制）");
				return;
			}
			if (!doc) {
				setSelError(true);
				setSelResult("（文档未加载）");
				return;
			}
			const selText = normalize(copied).slice(0, 1500);
			const normDoc = normalize(doc.fullText);
			let context = "";
			const hits = [];
			let i = normDoc.indexOf(selText);
			while (i >= 0) {
				hits.push(i);
				i = normDoc.indexOf(selText, i + 1);
			}
			if (hits.length === 1) {
				const idx = hits[0];
				context = normDoc.slice(Math.max(0, idx - contextLen), idx + selText.length + contextLen);
			}
			setSel({
				selection: selText,
				context
			});
			setSelResult("");
			if (!controller) {
				setSelError(true);
				return;
			}
			try {
				const res = await controller.translateSelection({
					kind: "selection",
					selection: selText,
					context,
					glossary,
					target: "中文"
				}, new AbortController().signal, () => {});
				if (seq === reqSeq.current) {
					setSelResult(res);
					setSelError(false);
				}
			} catch (err) {
				if (seq === reqSeq.current) {
					setSelResult("翻译失败：" + (err instanceof Error ? err.message : String(err)));
					setSelError(true);
				}
			}
		}
		async function onClipboardTranslate() {
			try {
				await doTranslate(await navigator.clipboard.readText());
			} catch (err) {
				setSelResult("读取剪贴板失败：" + (err instanceof Error ? err.message : String(err)));
				setSelError(true);
			}
		}
		useEffect(() => {
			let last = "";
			const poll = async () => {
				try {
					const j = await (await fetch("/bilingual-reader/clipboard")).json();
					setClipAvailable(!!j.available);
					const text = j && typeof j.text === "string" ? j.text : "";
					if (text && text !== last) {
						last = text;
						await doTranslate(text);
					} else if (!text) last = "";
				} catch {}
			};
			const id = setInterval(poll, 400);
			return () => clearInterval(id);
		}, [
			doc,
			glossary,
			controller,
			contextLen
		]);
		function onDividerDown(e) {
			e.preventDefault();
			const rect = e.currentTarget.parentElement.getBoundingClientRect();
			const div = e.currentTarget;
			document.body.style.userSelect = "none";
			const startY = e.clientY;
			const startPct = topPct;
			const mm = (ev) => {
				ev.preventDefault();
				setTopPct(Math.max(8, Math.min(92, startPct + (ev.clientY - startY) / rect.height * 100)));
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
		const btn = {
			border: "1px solid #d0d0d0",
			background: "#f5f5f5",
			color: "#1f2329",
			borderRadius: 6,
			padding: "4px 10px",
			fontSize: 13,
			cursor: "pointer"
		};
		return h("div", { style: {
			display: "flex",
			flexDirection: "column",
			height: "100%"
		} }, h("div", { style: {
			height: `${topPct}%`,
			overflow: "hidden",
			display: "flex",
			flexDirection: "column"
		} }, h(PdfView, { file })), h("div", {
			onPointerDown: onDividerDown,
			style: {
				height: 8,
				cursor: "row-resize",
				background: "#e2e2e2",
				flex: "none",
				userSelect: "none",
				touchAction: "none"
			}
		}), h("div", { style: {
			flex: 1,
			overflow: "auto",
			padding: 12,
			borderTop: "1px solid #e2e2e2",
			color: "#1f2329"
		} }, h("div", { style: {
			display: "flex",
			gap: 10,
			alignItems: "center",
			flexWrap: "wrap",
			color: "#555"
		} }, clipAvailable ? h("span", { style: { fontSize: 13 } }, "✓ 已启用自动翻译") : h("button", {
			onClick: () => void onClipboardTranslate(),
			style: btn
		}, "翻译选中"), h("label", { style: {
			fontSize: 13,
			color: "#555"
		} }, "上下文"), h("input", {
			type: "range",
			min: 0,
			max: 800,
			step: 50,
			value: contextLen,
			onChange: (e) => setContextLen(Number(e.target.value)),
			style: {
				width: 160,
				accentColor: "#555"
			}
		}), h("span", { style: {
			fontSize: 13,
			color: "#555"
		} }, contextLen + " 字")), h("div", { style: { marginTop: 10 } }, sel ? h("div", { style: {
			display: "flex",
			flexDirection: "column",
			gap: 6
		} }, h("div", { style: {
			color: "#666",
			fontSize: 13,
			maxHeight: 130,
			overflow: "auto"
		} }, "原文：" + sel.selection), h("div", { style: {
			display: "flex",
			gap: 8,
			alignItems: "flex-start"
		} }, h("div", { style: {
			flex: 1,
			lineHeight: 1.7,
			color: selError ? "#e53e3e" : "#1f2329"
		} }, selResult || "翻译中…"), selResult ? h("button", {
			onClick: () => void navigator.clipboard.writeText(selResult),
			style: btn
		}, "复制译文") : void 0)) : h("p", { style: {
			color: "#8a8a8a",
			marginTop: 4,
			fontSize: 13
		} }, "在 PDF 里选中一段文字并复制，即可自动翻译；无法自动时点「翻译选中」。"))));
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
			useCallback: react.useCallback,
			useRef: react.useRef
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
