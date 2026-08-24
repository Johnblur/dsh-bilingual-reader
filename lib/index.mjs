import { createRequire } from "node:module";
import { promises } from "node:fs";
import { getDocument } from "pdfjs-dist";
import { BlockAssembler, createAssistantMessage, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";
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
		const runtime = llm;
		const system = opts.messages.filter((m) => m.role === "system").map((m) => m.text).join("\n");
		const messages = opts.messages.filter((m) => m.role !== "system").map((m) => m.role === "assistant" ? createAssistantMessage({
			content: [{
				type: "text",
				text: m.text
			}],
			source: {
				kind: "plugin",
				plugin: "dsh-bilingual-reader",
				provider: opts.provider,
				model: opts.model
			}
		}) : createUserMessage({
			content: [{
				type: "text",
				text: m.text
			}],
			source: {
				kind: "plugin",
				plugin: "dsh-bilingual-reader"
			}
		}));
		const options = deepFreeze({
			provider: opts.provider,
			model: opts.model,
			messages,
			...system ? { system } : {},
			maxTokens: 4096,
			sessionId: "bilingual-reader",
			purpose: "translation",
			signal: opts.signal
		});
		const assembler = new BlockAssembler();
		for await (const chunk of runtime.stream(options)) assembler.push(chunk);
		const f = assembler.finish;
		if (f && (f.kind === "error" || f.kind === "aborted")) throw new Error(f.failure?.message || `llm stream ${f.kind}`);
		const text = assembler.blocks().filter((b) => b.type === "text").map((b) => b.text || "").join(" ").trim();
		opts.emit({
			type: "done",
			requestId: opts.requestId,
			full: text
		});
		return text;
	} };
}
//#endregion
//#region src/host/model.ts
const PROVIDER = process.env.DSH_BILINGUAL_PROVIDER ?? "deepseek-official";
const MODEL = process.env.DSH_BILINGUAL_MODEL ?? "deepseek-v4-flash-vision-exp";
const DEFAULT_MODELS = {
	fullText: {
		provider: PROVIDER,
		model: MODEL
	},
	selection: {
		provider: PROVIDER,
		model: MODEL
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
//#region src/index.ts
const inject = ["llm", "webServer"];
function apply(ctx) {
	const gateway = createLlmGateway(ctx.llm);
	const nodeRequire = createRequire(import.meta.url);
	const ws = ctx.webServer;
	let chunks = [];
	let glossary = {};
	ws.register({
		kind: "prefix",
		path: "/bilingual-reader",
		handler: async (req, res) => {
			const u = new URL(req.url ?? "/", "http://x");
			const pathname = u.pathname;
			try {
				if (pathname === "/bilingual-reader/file" && req.method === "GET") {
					const file = decodeURIComponent(u.searchParams.get("path") || "");
					const data = await promises.readFile(file);
					res.writeHead(200, {
						"content-type": "application/pdf",
						"cache-control": "no-cache"
					});
					res.end(data);
					return;
				}
				if (pathname === "/bilingual-reader/pdf.mjs" && req.method === "GET") {
					const p = nodeRequire.resolve("pdfjs-dist/build/pdf.mjs");
					res.writeHead(200, {
						"content-type": "text/javascript; charset=utf-8",
						"cache-control": "no-cache"
					});
					res.end(await promises.readFile(p));
					return;
				}
				if (pathname === "/bilingual-reader/pdf.worker.mjs" && req.method === "GET") {
					const p = nodeRequire.resolve("pdfjs-dist/build/pdf.worker.mjs");
					res.writeHead(200, {
						"content-type": "text/javascript; charset=utf-8",
						"cache-control": "no-cache"
					});
					res.end(await promises.readFile(p));
					return;
				}
				const body = await readJson(req);
				if (pathname === "/bilingual-reader/extract" && req.method === "POST") {
					const text = await extractPdf(String(body?.path ?? ""));
					chunks = chunkDocument(text);
					glossary = extractGlossary(chunks);
					return json(res, 200, {
						text,
						chunks,
						glossary
					});
				}
				if (pathname === "/bilingual-reader/translate-chunk" && req.method === "POST") {
					const chunkId = String(body?.chunkId ?? "");
					const chunk = chunks.find((c) => c.id === chunkId);
					if (!chunk) return json(res, 404, { error: "chunk not found: " + chunkId });
					return json(res, 200, {
						requestId: chunkId,
						text: await translateChunk(gateway, chunk, {
							kind: "full-text",
							glossary,
							target: "中文"
						}, new AbortController().signal, () => {}, chunkId)
					});
				}
				if (pathname === "/bilingual-reader/translate-selection" && req.method === "POST") {
					const reqBody = body;
					const requestId = `sel-${Date.now()}`;
					return json(res, 200, {
						requestId,
						text: await translateSelection(gateway, reqBody.selection ?? "", reqBody.context ?? "", {
							...reqBody,
							kind: "selection",
							glossary
						}, new AbortController().signal, () => {}, requestId)
					});
				}
				return json(res, 404, { error: "unknown route " + pathname });
			} catch (e) {
				return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
			}
		}
	});
}
function readJson(req) {
	return new Promise((resolve, reject) => {
		const parts = [];
		req.on("data", (c) => parts.push(c));
		req.on("end", () => {
			try {
				resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : void 0);
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", (e) => reject(e));
	});
}
function json(res, code, payload) {
	res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(payload));
}
//#endregion
export { apply, inject };
