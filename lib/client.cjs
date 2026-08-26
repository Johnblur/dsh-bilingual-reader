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
//#region src/client/styles.ts
const BTN_CLS = "dsh-bl-btn";
function ensurePluginStyles() {
	if (typeof document === "undefined") return;
	if (document.getElementById("dsh-bl-plugin-styles")) return;
	const s = document.createElement("style");
	s.id = "dsh-bl-plugin-styles";
	s.textContent = ".dsh-bl-btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:13px;cursor:pointer}.dsh-bl-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}";
	document.head.appendChild(s);
}
ensurePluginStyles();
const inputBase = {
	height: "28px",
	padding: "0 10px",
	border: "1px solid var(--dsw-alias-border-l2)",
	borderRadius: "6px",
	background: "var(--dsw-alias-bg-layer-1)",
	color: "var(--dsw-alias-label-primary)",
	fontSize: "13px",
	outline: "none"
};
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
		const [topPct, setTopPct] = useState(75);
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
			className: BTN_CLS
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
			className: BTN_CLS
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
function languageIcon(h, size) {
	return h("svg", {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 2,
		strokeLinecap: "round",
		strokeLinejoin: "round"
	}, h("path", { d: "M5 8l6 6" }), h("path", { d: "M4 14l6-6 2-3" }), h("path", { d: "M2 5h12" }), h("path", { d: "M7 2h1" }), h("path", { d: "m22 22-5-10-5 10" }), h("path", { d: "M14 18h6" }));
}
function makeClientFactory() {
	return (require$1) => {
		const react = require$1("react");
		const { useState, useEffect } = react;
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
			listPdfs: (dir, limit = 200) => post("/bilingual-reader/list-pdfs", {
				dir,
				limit
			}),
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
			const [path, setPath] = useState("");
			const [chosen, setChosen] = useState("");
			const [browsing, setBrowsing] = useState(false);
			const [pdfs, setPdfs] = useState([]);
			const [browseErr, setBrowseErr] = useState("");
			const [loading, setLoading] = useState(false);
			useEffect(() => {
				if (!browsing || !cwd) return;
				let cancelled = false;
				setLoading(true);
				setBrowseErr("");
				controller.listPdfs(cwd, 200).then((r) => {
					if (!cancelled) setPdfs(Array.isArray(r?.files) ? r.files : []);
				}).catch((e) => {
					if (!cancelled) {
						setPdfs([]);
						setBrowseErr("列出 PDF 失败：" + (e instanceof Error ? e.message : String(e)));
					}
				}).finally(() => {
					if (!cancelled) setLoading(false);
				});
				return () => {
					cancelled = true;
				};
			}, [browsing, cwd]);
			const pick = (p) => {
				setPath(p);
				setChosen(p);
				setBrowsing(false);
			};
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
				placeholder: "粘贴或输入 PDF 路径…",
				onChange: (e) => setPath(e.target.value),
				style: {
					...inputBase,
					flex: 1
				}
			}), h("button", {
				onClick: () => setChosen(path),
				className: BTN_CLS
			}, "加载"), h("button", {
				onClick: () => setBrowsing((v) => !v),
				className: BTN_CLS
			}, "浏览…")), browsing ? h("div", { style: {
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 6,
				maxHeight: 300,
				overflow: "auto",
				padding: 8,
				display: "flex",
				flexDirection: "column",
				gap: 4
			} }, loading ? h("p", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 13,
				padding: "6px 8px"
			} }, "正在扫描 PDF…") : browseErr ? h("p", { style: {
				color: "var(--dsw-alias-state-error-primary)",
				fontSize: 13,
				padding: "6px 8px"
			} }, browseErr) : pdfs.length === 0 ? h("p", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 13,
				padding: "6px 8px"
			} }, cwd ? "未找到 PDF：" + cwd : "未提供工作区目录。") : pdfs.map((p) => {
				const idx = p.path.lastIndexOf("\\");
				const dir = idx >= 0 ? p.path.slice(0, idx) : "";
				const file = idx >= 0 ? p.path.slice(idx + 1) : p.path;
				return h("button", {
					key: p.path,
					onClick: () => pick(p.path),
					style: {
						textAlign: "left",
						border: "none",
						background: "transparent",
						color: "var(--dsw-alias-label-primary)",
						borderRadius: 4,
						padding: "6px 8px",
						cursor: "pointer",
						display: "flex",
						flexDirection: "column",
						gap: 2,
						width: "100%"
					}
				}, h("span", { style: {
					fontSize: 13,
					fontWeight: 500,
					wordBreak: "break-all"
				} }, file), dir ? h("span", { style: {
					fontSize: 11,
					color: "var(--dsw-alias-label-tertiary)",
					wordBreak: "break-all",
					lineHeight: 1.4
				} }, dir) : void 0);
			})) : void 0, chosen ? h(BilingualReader, {
				file: chosen,
				controller
			}) : h("p", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				fontSize: 13
			} }, "输入一个 PDF 路径，点「加载」开始双语阅读；或点「浏览…」从工作区选择。"));
		}
		const inject = [
			"betterSidebar",
			"slots",
			"locale"
		];
		const apply = (ctx) => {
			const c = ctx;
			const bs = c.betterSidebar;
			if (!bs) return;
			const isZh = () => (c.locale?.getSnapshot?.().active ?? (typeof navigator !== "undefined" ? navigator.language : "")).toLowerCase().startsWith("zh");
			c.effect(() => bs.registerTab({
				id: "bilingual-reader",
				title: () => isZh() ? "翻译" : "translator",
				icon: (size) => languageIcon(h, size),
				single: true,
				createTab: () => ({ tab: {
					id: "bilingual-reader",
					type: "bilingual-reader",
					title: "translator"
				} }),
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
