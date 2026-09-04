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
function injectPluginStyles() {
	if (typeof document === "undefined") return () => {};
	if (document.getElementById("dsh-bl-plugin-styles")) return () => {};
	const s = document.createElement("style");
	s.id = "dsh-bl-plugin-styles";
	s.textContent = ".dsh-bl-btn{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:13px;cursor:pointer}.dsh-bl-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}";
	document.head.appendChild(s);
	return () => {
		if (s.parentNode) s.parentNode.removeChild(s);
	};
}
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
//#region src/client/match.ts
/** Merge hyphen/line-break splits and collapse whitespace, lowercased (for the
*  display copy of the selection / "原文"). */
function normalizeForMatch(s) {
	return s.replace(/[-\u2010\u2011]\s*\n\s*/g, "").replace(/[-\u2010\u2011]\s+/g, "").replace(/\s+/g, " ").toLowerCase().trim();
}
/** Reduce to a lowercase contiguous letter/digit run, and return the map back
*  to original character offsets (one entry per kept letter). */
function lettersOf(s) {
	const letters = [];
	const map = [];
	const re = /[A-Za-z0-9]/g;
	let m;
	while ((m = re.exec(s)) !== null) {
		letters.push(m[0].toLowerCase());
		map.push(m.index);
	}
	return {
		letters: letters.join(""),
		map
	};
}
/**
* Find every occurrence of the selection's letter sequence in the document's.
* `count` = number of true letter-sequence matches; `start`/`end` = the first
* occurrence's original-text offsets. Only an exact contiguous letter match
* counts, so a long sentence matches once (or genuinely multiple times if it
* truly appears more than once), never at every sliding window.
*/
function matchLetters(doc, sel) {
	const selL = lettersOf(sel).letters;
	if (!selL) return null;
	const docL = lettersOf(doc);
	if (!docL.letters) return null;
	const starts = [];
	let i = docL.letters.indexOf(selL);
	while (i >= 0) {
		starts.push(i);
		i = docL.letters.indexOf(selL, i + 1);
	}
	if (starts.length === 0) return null;
	return {
		start: docL.map[starts[0]],
		end: docL.map[starts[0] + selL.length - 1] + 1,
		count: starts.length
	};
}
/** Compute the context slice around a matched run (in the ORIGINAL text). */
function contextRange(start, end, contextLen) {
	return {
		from: Math.max(0, start - contextLen),
		to: end + contextLen
	};
}
//#endregion
//#region src/client/lang.ts
/** Built-in preset (the four the user asked for). */
const LANGS = [
	{
		code: "zh",
		name: "中文",
		native: "中文（简体）",
		prompt: "Chinese (Simplified)",
		script: "cjk"
	},
	{
		code: "en",
		name: "英语",
		native: "English",
		prompt: "English",
		script: "latin"
	},
	{
		code: "ja",
		name: "日语",
		native: "日本語",
		prompt: "Japanese",
		script: "kana"
	},
	{
		code: "ko",
		name: "韩语",
		native: "한국어",
		prompt: "Korean",
		script: "hangul"
	}
];
/**
* The "auto" pseudo-entry shown as the source-language placeholder. Its code
* is never sent as a real source; it signals the pipeline to detect.
*/
const AUTO_DETECT = {
	code: "auto",
	name: "自动识别",
	native: "Auto-detect",
	prompt: "auto",
	script: "other"
};
/** LocalStorage keys (namespaced, one blob per concern). */
const LS_CUSTOM = "dsh-bl.customLangs";
const LS_SOURCE = "dsh-bl.source";
const LS_TARGET = "dsh-bl.target";
const LS_CONTEXT_LEN = "dsh-bl.contextLen";
function loadLangBlob(key, fallback) {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null || raw === "") return fallback;
		return JSON.parse(raw);
	} catch {
		return fallback;
	}
}
function saveLangBlob(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {}
}
/** The initial languages from localStorage, with sane defaults. */
function initialCustom() {
	const c = loadLangBlob(LS_CUSTOM, []);
	return Array.isArray(c) ? c.filter((x) => x && typeof x.code === "string") : [];
}
function initialSource() {
	const s = loadLangBlob(LS_SOURCE, AUTO_DETECT.code);
	return typeof s === "string" && s ? s : AUTO_DETECT.code;
}
function initialTarget(isZh) {
	const t = loadLangBlob(LS_TARGET, isZh ? "zh" : "en");
	return typeof t === "string" && t ? t : isZh ? "zh" : "en";
}
function initialContextLen() {
	const n = loadLangBlob(LS_CONTEXT_LEN, 250);
	return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(800, Math.round(n))) : 250;
}
/** The full ordered language set: preset + user customs (customs appended). */
function allLangs(customs) {
	return customs.length === 0 ? LANGS : [...LANGS, ...customs];
}
/** The localizer: pick the language code by an ISO (or heuristic) result. */
function resolveLangCode(code, customs) {
	const found = allLangs(customs).find((l) => l.code.toLowerCase() === String(code).toLowerCase());
	return found ? found.code : AUTO_DETECT.code;
}
/** The friendly label for a code (used for the "detected as" line). */
function langName(code, customs) {
	const found = allLangs(customs).find((l) => l.code.toLowerCase() === String(code).toLowerCase());
	if (found) return `${found.name}（${found.native}）`;
	return code;
}
const RE = {
	han: /[\u4e00-\u9fff\u3400-\u4dbf]/g,
	kana: /[\u3041-\u3096\u30a0-\u30ff]/g,
	hangul: /[\uac00-\ud7af\u1100-\u11ff]/g,
	cyrillic: /[\u0400-\u04ff]/g,
	arabic: /[\u0600-\u06ff\u0750-\u077f]/g,
	thai: /[\u0e00-\u0e7f]/g,
	devanagari: /[\u0900-\u097f]/g,
	latin: /[A-Za-z\u00c0-\u024f]/g
};
function count(s, re) {
	const m = s.match(re);
	return m ? m.length : 0;
}
/** Decide the script group from simple counts. Returns 'other' when unclear. */
function scriptOf(text) {
	const han = count(text, RE.han);
	const kana = count(text, RE.kana);
	const hangul = count(text, RE.hangul);
	const cyr = count(text, RE.cyrillic);
	const arab = count(text, RE.arabic);
	const thai = count(text, RE.thai);
	const dev = count(text, RE.devanagari);
	const latin = count(text, RE.latin);
	if (hangul > 0 && hangul >= Math.max(1, han * .2)) return "hangul";
	if (kana > 0 && kana >= 2) return "kana";
	if (han > 0 && han >= Math.max(1, kana * .5)) return "cjk";
	if (cyr > 0 && cyr >= latin * .3) return "cyrillic";
	if (arab > 0 && arab >= latin * .3) return "arabic";
	if (thai > 0 && thai >= latin * .3) return "thai";
	if (dev > 0 && dev >= latin * .3) return "devanagari";
	if (latin > 0) return "latin";
	return "other";
}
function detectByScript(text, preset) {
	if (!text || !text.trim()) return {
		lang: "en",
		script: "other",
		confidence: "low"
	};
	const script = scriptOf(text);
	const match = preset.filter((l) => l.script === script);
	if (script === "cjk") return {
		lang: "zh",
		script,
		confidence: "high"
	};
	if (script === "kana") return {
		lang: "ja",
		script,
		confidence: "high"
	};
	if (script === "hangul") return {
		lang: "ko",
		script,
		confidence: "high"
	};
	if (script === "cyrillic") return {
		lang: "ru" in match ? "ru" : match[0]?.code ?? "en",
		script,
		confidence: "high"
	};
	if (script === "arabic") return {
		lang: match[0]?.code ?? "ar",
		script,
		confidence: "high"
	};
	if (script === "thai") return {
		lang: match[0]?.code ?? "th",
		script,
		confidence: "high"
	};
	if (script === "devanagari") return {
		lang: match[0]?.code ?? "hi",
		script,
		confidence: "high"
	};
	const latinLangs = preset.filter((l) => l.script === "latin");
	if (latinLangs.length === 1) return {
		lang: latinLangs[0].code,
		script,
		confidence: "high"
	};
	return {
		lang: "en",
		script,
		confidence: "low"
	};
}
/** Whether a heuristic read is ambiguous enough to require an LLM classify.
*  Two triggers: (a) the active set has ≥2 languages of one script (Latin eg),
*  (b) the heuristic itself came back low-confidence. */
function needsLlmDetect(result, preset) {
	if (result.confidence === "low") return true;
	const groups = /* @__PURE__ */ new Map();
	for (const l of preset) groups.set(l.script, (groups.get(l.script) ?? 0) + 1);
	return (groups.get(result.script) ?? 0) >= 2;
}
//#endregion
//#region src/client/reader.ts
/** Whether the DSH UI is in Chinese (best-effort; used only for the initial
*  default target language before any user preference is loaded). */
function isZhUI() {
	try {
		const active = window.__DSH_LOCALE__ ?? navigator.language ?? "";
		return String(active).toLowerCase().startsWith("zh");
	} catch {
		return (typeof navigator !== "undefined" ? navigator.language : "").toLowerCase().startsWith("zh");
	}
}
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
		const [matchSel, setMatchSel] = useState({ kind: "empty" });
		const [topPct, setTopPct] = useState(75);
		const [contextLen, setContextLen] = useState(initialContextLen());
		const [clipAvailable, setClipAvailable] = useState(false);
		const [selError, setSelError] = useState(false);
		const [customLangs, setCustomLangs] = useState(initialCustom());
		const [source, setSource] = useState(initialSource());
		const [target, setTarget] = useState(initialTarget(isZhUI()));
		const [detected, setDetected] = useState("");
		const reqSeq = useRef(0);
		const sourceRef = useRef(source);
		const targetRef = useRef(target);
		const customLangsRef = useRef(customLangs);
		sourceRef.current = source;
		targetRef.current = target;
		customLangsRef.current = customLangs;
		const load = useCallback(async () => {
			if (!controller || !file) return;
			const { text, glossary } = await controller.loadDocument(file);
			setDoc(text);
			setGloss(glossary);
		}, [controller, file]);
		useEffect(() => {
			load();
		}, [load]);
		useEffect(() => {
			saveLangBlob(LS_SOURCE, source);
		}, [source]);
		useEffect(() => {
			saveLangBlob(LS_TARGET, target);
		}, [target]);
		useEffect(() => {
			saveLangBlob(LS_CONTEXT_LEN, contextLen);
		}, [contextLen]);
		useEffect(() => {
			saveLangBlob(LS_CUSTOM, customLangs);
		}, [customLangs]);
		const mountedRef = useRef(false);
		const lastLangKeyRef = useRef("");
		useEffect(() => {
			const key = `${source}\u0000${target}`;
			if (!mountedRef.current) {
				mountedRef.current = true;
				lastLangKeyRef.current = key;
				return;
			}
			const selNow = sel;
			if (selNow?.selection && key !== lastLangKeyRef.current) {
				lastLangKeyRef.current = key;
				doTranslate(selNow.selection);
			}
		}, [source, target]);
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
			const selText = normalizeForMatch(copied).slice(0, 1500);
			let context = "";
			if (!selText) setMatchSel({ kind: "empty" });
			else {
				const m = matchLetters(doc.fullText, copied);
				if (m) {
					const { from, to } = contextRange(m.start, m.end, contextLen);
					context = doc.fullText.slice(from, to);
					setMatchSel(m.count > 1 ? {
						kind: "multiple",
						count: m.count
					} : {
						kind: "matched",
						count: 1
					});
				} else setMatchSel({ kind: "not-found" });
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
			const src = sourceRef.current;
			const tgt = targetRef.current;
			const customs = customLangsRef.current;
			let effSource = src;
			try {
				if (src === AUTO_DETECT.code) {
					const all = allLangs(customs);
					const d = detectByScript(selText, all);
					if (needsLlmDetect(d, all) && controller.detectLanguage) try {
						effSource = resolveLangCode(await controller.detectLanguage(selText), customs);
						setDetected(langName(effSource, customs));
					} catch {
						effSource = d.script === "latin" ? "en" : d.lang;
						setDetected(langName(effSource, customs));
					}
					else {
						effSource = d.lang;
						setDetected(langName(effSource, customs));
					}
					if (seq !== reqSeq.current) return;
				} else setDetected("");
			} catch {
				setDetected("");
			}
			try {
				const res = await controller.translateSelection({
					kind: "selection",
					selection: selText,
					context,
					glossary,
					source: effSource,
					target: tgt
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
		const top = h("div", { style: {
			height: `${topPct}%`,
			overflow: "hidden",
			display: "flex",
			flexDirection: "column"
		} }, h(PdfView, { file }));
		const divider = h("div", {
			onPointerDown: onDividerDown,
			style: {
				height: 8,
				cursor: "row-resize",
				background: "#e2e2e2",
				flex: "none",
				userSelect: "none",
				touchAction: "none"
			}
		});
		const [showAddLang, setShowAddLang] = useState(false);
		const [addLangName, setAddLangName] = useState("");
		const addCustomLang = () => {
			const name = addLangName.trim();
			if (!name) return;
			const next = {
				code: "x-" + Date.now().toString(36),
				name,
				native: name,
				prompt: name,
				script: "other",
				custom: true
			};
			setCustomLangs((prev) => [...prev, next]);
			setAddLangName("");
			setShowAddLang(false);
		};
		const langOptions = (includeAuto) => includeAuto ? [AUTO_DETECT, ...allLangs(customLangs)] : allLangs(customLangs);
		const langLabel = (code) => {
			if (code === AUTO_DETECT.code) return AUTO_DETECT.name;
			const f = allLangs(customLangs).find((l) => l.code === code);
			return f ? f.name : code;
		};
		const selectStyle = {
			height: 26,
			padding: "0 8px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 6,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			outline: "none"
		};
		return h("div", { style: {
			display: "flex",
			flexDirection: "column",
			height: "100%"
		} }, top, divider, h("div", { style: {
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
		} }, "源"), h("select", {
			value: source,
			onChange: (e) => setSource(e.target.value),
			style: selectStyle
		}, langOptions(true).map((l) => h("option", {
			value: l.code,
			key: l.code
		}, langLabel(l.code))), h("option", {
			value: "__custom",
			key: "__custom"
		}, "＋语言…")), h("label", { style: {
			fontSize: 13,
			color: "#555"
		} }, "目标"), h("select", {
			value: target,
			onChange: (e) => {
				const v = e.target.value;
				if (v === "__custom") setShowAddLang(true);
				else setTarget(v);
			},
			style: selectStyle
		}, langOptions(false).map((l) => h("option", {
			value: l.code,
			key: l.code
		}, langLabel(l.code))), h("option", {
			value: "__custom",
			key: "__custom"
		}, "＋语言…")), h("label", { style: {
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
		} }, contextLen + " 字")), showAddLang ? h("div", { style: {
			display: "flex",
			gap: 8,
			alignItems: "center",
			marginTop: 8
		} }, h("input", {
			value: addLangName,
			placeholder: "语言名（如 法语 / French）",
			onChange: (e) => setAddLangName(e.target.value),
			style: {
				...inputBase,
				flex: 1
			}
		}), h("button", {
			onClick: addCustomLang,
			className: BTN_CLS
		}, "添加"), h("button", {
			onClick: () => setShowAddLang(false),
			className: BTN_CLS
		}, "取消")) : void 0, detected ? h("div", { style: {
			marginTop: 8,
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)"
		} }, "识别为：" + detected) : void 0, h("div", { style: { marginTop: 10 } }, sel ? h("div", { style: {
			display: "flex",
			flexDirection: "column",
			gap: 6
		} }, matchSel.kind !== "empty" ? h("div", { style: {
			display: "flex",
			gap: 6,
			alignItems: "center",
			fontSize: 12
		} }, h("span", { style: { color: matchSel.kind === "not-found" ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-state-success-primary)" } }, matchSel.kind === "not-found" ? "⚠" : "✓"), h("span", { style: { color: "var(--dsw-alias-label-secondary)" } }, matchSel.kind === "matched" ? "已匹配到原文，使用上下文翻译" : matchSel.kind === "multiple" ? "该片段在原文出现 " + (matchSel.count ?? 0) + " 次，使用第一次出现的上下文" : "未在原文中定位到该片段，直接翻译")) : void 0, h("div", { style: {
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
			detectLanguage: async (text) => {
				const r = await post("/bilingual-reader/detect-language", { text });
				return r && typeof r.lang === "string" ? r.lang : "";
			},
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
			c.effect(() => injectPluginStyles(), "dsh-bilingual-reader: plugin styles");
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
