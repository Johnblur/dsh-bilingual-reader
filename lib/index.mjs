import { promises } from "node:fs";
import { getDocument } from "pdfjs-dist";
import * as path from "node:path";
import { createHash } from "node:crypto";
//#region src/host/pdf.ts
async function extractPdf(filePath) {
	const data = new Uint8Array(await promises.readFile(filePath));
	const pdf = await getDocument({ data }).promise;
	const items = [];
	for (let p = 1; p <= pdf.numPages; p++) {
		const tc = await (await pdf.getPage(p)).getTextContent();
		for (const it of tc.items) {
			const str = it.str;
			if (!str) continue;
			const [a, , , , e, f] = it.transform ?? [];
			items.push({
				x: e ?? 0,
				y: f ?? 0,
				str,
				page: p
			});
		}
	}
	const fullText = reflow(items);
	return {
		file: filePath,
		fullText,
		source: "pdf",
		paragraphs: splitParagraphs(fullText)
	};
}
function reflow(items) {
	const byPage = /* @__PURE__ */ new Map();
	for (const it of items) {
		const y = Math.round(it.y);
		byPage.set(it.page, (byPage.get(it.page) ?? []).concat([{
			x: it.x,
			y,
			str: it.str
		}]));
	}
	let out = "";
	const pages = [...byPage.keys()].sort((a, b) => a - b);
	for (const page of pages) {
		const list = byPage.get(page);
		const xs = list.map((i) => i.x).sort((a, b) => a - b);
		const medianX = xs[Math.floor(xs.length / 2)] ?? 0;
		const left = list.filter((i) => i.x < medianX);
		const right = list.filter((i) => i.x >= medianX);
		out += columnText(left) + "\n" + columnText(right) + "\n";
	}
	return out;
}
function columnText(list) {
	const lines = /* @__PURE__ */ new Map();
	for (const i of list) lines.set(i.y, (lines.get(i.y) ?? []).concat([{
		x: i.x,
		str: i.str
	}]));
	const ys = [...lines.keys()].sort((a, b) => a - b);
	let out = "";
	for (const y of ys) {
		const parts = lines.get(y).sort((a, b) => a.x - b.x).map((p) => p.str);
		out += parts.join(" ") + "\n";
	}
	return out;
}
function splitParagraphs(fullText) {
	const paragraphs = [];
	const lines = fullText.split("\n");
	let start = 0;
	for (let i = 0; i < lines.length; i++) if (lines[i].trim() === "") {
		paragraphs.push({
			start,
			end: i
		});
		start = i + 1;
	}
	paragraphs.push({
		start,
		end: lines.length
	});
	return paragraphs;
}
//#endregion
//#region src/host/chunk.ts
const HEADING = /^(#{1,6}\s+.+|\d+(?:\.\d+)*\s+[A-Za-z].*)$/;
function chunkDocument(doc) {
	const lines = doc.fullText.split(/\r?\n/);
	const chunks = [];
	let cur = null;
	let order = 0;
	const flush = () => {
		if (!cur) return;
		const body = cur.text.join("\n").replace(/\n{3,}/g, "\n\n").trim();
		if (body.length > 0) chunks.push({
			id: `chunk-${order++}`,
			level: cur.level,
			heading: cur.heading,
			text: body,
			sourceText: body
		});
		cur = null;
	};
	for (const line of lines) if (line.match(HEADING)) {
		flush();
		cur = {
			level: line.startsWith("#") ? line.match(/^#+/)[0].length : 2,
			heading: line.replace(/^#+\s*/, "").trim(),
			text: []
		};
	} else if (cur) cur.text.push(line);
	else {
		cur = {
			level: 0,
			heading: "",
			text: []
		};
		cur.text.push(line);
	}
	flush();
	return chunks;
}
//#endregion
//#region src/host/glossary.ts
const CAMEL = /\b[A-Z][a-z]+(?:[A-Z][a-z]*)+/g;
const ACRONYM = /\b[A-Z]{2,8}\b/g;
const KEPT = /^(?:[A-Za-z]+)$/;
const STOP = /* @__PURE__ */ new Set([
	"THE",
	"AND",
	"OR",
	"FOR",
	"OF",
	"IN",
	"ON",
	"WITH",
	"A",
	"AN",
	"IS",
	"ARE",
	"TO",
	"BY",
	"AS",
	"AT",
	"FROM",
	"That",
	"This",
	"These",
	"Those",
	"Using",
	"Based",
	"Model",
	"Models",
	"We",
	"Our"
]);
function extractGlossary(chunks) {
	const out = {};
	for (const c of chunks) {
		collect(c.text, out);
		if (c.sourceText) collect(c.sourceText, out);
	}
	return out;
}
function collect(text, out) {
	for (const m of text.matchAll(CAMEL)) {
		const t = m[0];
		if (t.length >= 5 && !STOP.has(t)) out[t] = t;
	}
	for (const m of text.matchAll(ACRONYM)) {
		const t = m[0];
		if (t.length >= 3 && !STOP.has(t) && KEPT.test(t)) out[t] = t;
	}
}
//#endregion
//#region src/host/llmClient.ts
function createLlmGateway(llm) {
	return { async streamText(opts) {
		const stream = (await llm.prepareCall({
			provider: opts.provider,
			model: opts.model,
			signal: opts.signal
		})).stream({
			signal: opts.signal,
			messages: opts.messages.map((m) => ({
				role: m.role,
				content: [{
					type: "text",
					text: m.text
				}]
			}))
		});
		let full = "";
		for await (const chunk of stream) {
			const delta = chunk.text ?? chunk.delta ?? "";
			if (typeof delta === "string" && delta.length) {
				full += delta;
				opts.emit({
					type: "delta",
					requestId: opts.requestId,
					text: delta
				});
			}
		}
		return full;
	} };
}
//#endregion
//#region src/host/model.ts
const DEFAULT_MODELS = {
	fullText: {
		provider: "deepseek",
		model: "deepseek-ai/DeepSeek-V3.2"
	},
	selection: {
		provider: "deepseek",
		model: "deepseek-ai/DeepSeek-V4-Flash"
	}
};
function resolveModel(req, cfg = DEFAULT_MODELS) {
	const base = req.kind === "selection" ? cfg.selection : cfg.fullText;
	return {
		provider: req.provider ?? base.provider,
		model: req.model ?? base.model
	};
}
//#endregion
//#region src/host/translate.ts
const SYSTEM_FULLTEXT = (glossary, target) => `你是学术论文翻译助手。把下面内容译成${target}。只输出译文，不要解释、不要保留原文。` + glossaryNote(glossary);
const SYSTEM_SELECTION = (glossary, target) => `你是学术论文翻译助手。请结合给出的“上下文”理解以下“选中片段”的含义，把选中片段译成${target}。不要翻译上下文，只翻译选中片段；上下文仅用于确定用词。` + glossaryNote(glossary);
function glossaryNote(g) {
	const keys = Object.keys(g);
	if (keys.length === 0) return "";
	return `\n术语请保持一致：${keys.map((k) => `${k}=${g[k] ?? k}`).join(", ")}`;
}
async function translateChunk(llm, chunk, req, signal, emit, requestId) {
	const { provider, model } = resolveModel({
		...req,
		kind: "full-text"
	});
	const target = req.target ?? "中文";
	const messages = [{
		role: "system",
		text: SYSTEM_FULLTEXT(req.glossary ?? {}, target)
	}, {
		role: "user",
		text: chunk.heading ? `【标题】${chunk.heading}\n\n${chunk.text}` : chunk.text
	}];
	emit({
		type: "start",
		requestId
	});
	return llm.streamText({
		provider,
		model,
		messages,
		signal,
		emit,
		requestId
	});
}
async function translateSelection(llm, selection, context, req, signal, emit, requestId) {
	const { provider, model } = resolveModel({
		...req,
		kind: "selection"
	});
	const target = req.target ?? "中文";
	const messages = [{
		role: "system",
		text: SYSTEM_SELECTION(req.glossary ?? {}, target)
	}, {
		role: "user",
		text: `【上下文】\n${context}\n\n【选中片段】\n${selection}`
	}];
	emit({
		type: "start",
		requestId
	});
	return llm.streamText({
		provider,
		model,
		messages,
		signal,
		emit,
		requestId
	});
}
//#endregion
//#region src/host/cache.ts
function hashText(text) {
	return createHash("sha256").update(text).digest("hex");
}
function sidecarPath(file) {
	const base = path.basename(file, path.extname(file));
	return path.join(path.dirname(file), `${base}.zh.json`);
}
async function loadCache(file) {
	try {
		const raw = await promises.readFile(sidecarPath(file), "utf8");
		return JSON.parse(raw);
	} catch {
		return {};
	}
}
async function saveCache(file, entries) {
	await promises.writeFile(sidecarPath(file), JSON.stringify(entries, null, 2), "utf8");
}
//#endregion
//#region src/index.ts
const inject = ["llm"];
function createReaderController(llm) {
	const gateway = createLlmGateway(llm);
	const docCache = /* @__PURE__ */ new Map();
	let currentFile = "";
	return {
		async loadDocument(file) {
			currentFile = file;
			const text = await extractPdf(file);
			const chunks = chunkDocument(text);
			const glossary = extractGlossary(chunks);
			docCache.set(file, {
				chunks,
				glossary
			});
			return {
				text,
				chunks,
				glossary
			};
		},
		async translateChunk(chunkId, glossary, signal, emit) {
			const chunk = [...docCache.values()].find((d) => d.chunks.some((c) => c.id === chunkId))?.chunks.find((c) => c.id === chunkId);
			if (!chunk) throw new Error(`chunk not found: ${chunkId}`);
			const cache = await loadCache(currentFile || chunkId);
			const hash = hashText(chunk.text);
			if (cache[chunkId] && cache[chunkId].hash === hash && cache[chunkId].text) {
				emit({
					type: "done",
					requestId: chunkId,
					full: cache[chunkId].text
				});
				return cache[chunkId].text;
			}
			const result = await translateChunk(gateway, chunk, {
				kind: "full-text",
				glossary,
				target: "中文"
			}, signal, emit, chunkId);
			cache[chunkId] = {
				hash,
				text: result
			};
			if (currentFile) await saveCache(currentFile, cache);
			emit({
				type: "done",
				requestId: chunkId,
				full: result
			});
			return result;
		},
		async translateSelection(req, signal, emit) {
			const requestId = `sel-${Date.now()}`;
			const result = await translateSelection(gateway, req.selection ?? "", req.context ?? "", req, signal, emit, requestId);
			emit({
				type: "done",
				requestId,
				full: result
			});
			return result;
		}
	};
}
function apply(ctx) {
	const controller = createReaderController(ctx.llm);
	ctx.effect(() => registerHostController(controller));
}
function registerHostController(_controller) {}
//#endregion
export { apply, createReaderController, inject };
