import { createRequire } from "node:module";
import { promises } from "node:fs";
import * as path from "node:path";
import { getDocument } from "pdfjs-dist";
import { BlockAssembler, createAssistantMessage, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";
//#region src/host/pdf.ts
async function extractPdf(filePath) {
	const data = new Uint8Array(await promises.readFile(filePath));
	const pdf = await getDocument({ data }).promise;
	let fullText = "";
	for (let p = 1; p <= pdf.numPages; p++) {
		const tc = await (await pdf.getPage(p)).getTextContent();
		for (const it of tc.items) {
			const str = it.str;
			if (!str) continue;
			fullText += str;
			if (!fullText.endsWith(" ") && !fullText.endsWith("\n")) fullText += " ";
		}
		fullText += "\n";
	}
	fullText = fullText.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
	const paragraphs = splitParagraphs(fullText);
	return {
		file: filePath,
		fullText,
		source: "pdf",
		paragraphs
	};
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
	async function runOnce(opts) {
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
			purpose: opts.purpose,
			signal: opts.signal
		});
		const assembler = new BlockAssembler();
		for await (const chunk of runtime.stream(options)) assembler.push(chunk);
		const f = assembler.finish;
		if (f && (f.kind === "error" || f.kind === "aborted")) throw new Error(f.failure?.message || `llm stream ${f.kind}`);
		return assembler.blocks().filter((b) => b.type === "text").map((b) => b.text || "").join(" ").trim();
	}
	return {
		async streamText(opts) {
			const text = await runOnce({
				...opts,
				purpose: "translation",
				requestId: opts.requestId
			});
			opts.emit({
				type: "done",
				requestId: opts.requestId,
				full: text
			});
			return text;
		},
		async detectLanguage(opts) {
			const raw = await runOnce({
				provider: opts.provider,
				model: opts.model,
				messages: [{
					role: "system",
					text: "You are a language detector. Read the text and answer ONLY with the ISO 639-1 language code (e.g. \"en\", \"fr\", \"zh\"). No explanation, no translation."
				}, {
					role: "user",
					text: opts.text.slice(0, 2e3)
				}],
				signal: opts.signal,
				purpose: "language-detect",
				requestId: "detect-" + Date.now()
			});
			const m = /[A-Za-z]{2,3}/.exec(raw || "");
			return m ? m[0].toLowerCase() : (raw || "").toLowerCase();
		}
	};
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
function sourceOf(source) {
	const s = source?.trim();
	return s ? s : "自动判断的原文语言";
}
const SYSTEM_FULLTEXT = (glossary, source, target) => `你是学术论文翻译助手。下面的内容语言是「${sourceOf(source)}」，请把它译成${target}。只输出译文，不要解释、不要保留原文。` + glossaryNote(glossary);
const SYSTEM_SELECTION = (glossary, source, target) => `你是学术论文翻译助手。请结合给出的“上下文”理解以下“选中片段”的含义，把选中片段从「${sourceOf(source)}」译成${target}。不要翻译上下文，只翻译选中片段；上下文仅用于确定用词。` + glossaryNote(glossary);
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
		text: SYSTEM_FULLTEXT(req.glossary ?? {}, req.source, target)
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
		text: SYSTEM_SELECTION(req.glossary ?? {}, req.source, target)
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
async function detectTextLanguage(llm, text, overrides) {
	const { provider, model } = resolveModel({
		kind: "selection",
		provider: overrides?.provider,
		model: overrides?.model
	});
	return llm.detectLanguage({
		provider,
		model,
		text
	});
}
//#endregion
//#region src/index.ts
const inject = ["llm", "webServer"];
function apply(ctx) {
	const gateway = createLlmGateway(ctx.llm);
	const nodeRequire = createRequire(import.meta.url);
	const pdfjsDir = path.dirname(nodeRequire.resolve("pdfjs-dist/package.json"));
	const ws = ctx.webServer;
	let chunks = [];
	let glossary = {};
	ctx.effect(() => ws.register({
		kind: "prefix",
		path: "/bilingual-reader",
		handler: async (req, res) => {
			const u = new URL(req.url ?? "/", "http://x");
			const pathname = u.pathname;
			try {
				if ((pathname.startsWith("/bilingual-reader/cmaps/") || pathname.startsWith("/bilingual-reader/standard_fonts/")) && req.method === "GET") {
					const sub = pathname.startsWith("/bilingual-reader/cmaps/") ? path.join(pdfjsDir, "cmaps", path.basename(pathname)) : path.join(pdfjsDir, "standard_fonts", path.basename(pathname));
					try {
						res.writeHead(200, {
							"content-type": "application/octet-stream",
							"cache-control": "no-cache"
						});
						res.end(await promises.readFile(sub));
					} catch {
						res.writeHead(404);
						res.end();
					}
					return;
				}
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
				if (pathname === "/bilingual-reader/clipboard" && req.method === "GET") {
					let text = "";
					let available = false;
					try {
						const electron = nodeRequire("electron");
						available = !!electron?.clipboard;
						text = electron?.clipboard?.readText?.() ?? "";
					} catch {
						available = false;
						text = "";
					}
					return json(res, 200, {
						text,
						available
					});
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
				if (pathname === "/bilingual-reader/list-pdfs" && req.method === "POST") {
					const root = String(body?.dir ?? "");
					return json(res, 200, {
						dir: root,
						files: await listPdfs(root, Math.max(1, Math.min(500, Number(body?.limit ?? 200) || 200)), Math.max(0, Math.min(10, Number(body?.depth ?? 3) || 3)))
					});
				}
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
				if (pathname === "/bilingual-reader/detect-language" && req.method === "POST") {
					const text = String(body?.text ?? "");
					const p = typeof body?.provider === "string" ? body.provider : void 0;
					const m = typeof body?.model === "string" ? body.model : void 0;
					return json(res, 200, { lang: await detectTextLanguage(gateway, text, {
						provider: p,
						model: m
					}) });
				}
				return json(res, 404, { error: "unknown route " + pathname });
			} catch (e) {
				return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
			}
		}
	}), "dsh-bilingual-reader: /bilingual-reader routes");
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
async function listPdfs(dir, limit, depth) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const skip = /* @__PURE__ */ new Set([
		"node_modules",
		".git",
		".dsh",
		"dist",
		"build",
		".pnpm-store",
		".npm-cache"
	]);
	const walk = async (d, level) => {
		if (out.length >= limit || level > depth) return;
		let entries;
		try {
			entries = await promises.readdir(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (out.length >= limit) return;
			const full = path.join(d, e.name);
			if (!seen.has(full)) seen.add(full);
			if (e.isDirectory()) {
				if (e.name.startsWith(".") || skip.has(e.name)) continue;
				await walk(full, level + 1);
			} else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) try {
				const st = await promises.stat(full);
				out.push({
					path: full,
					name: e.name,
					mtime: st.mtimeMs
				});
			} catch {}
		}
	};
	await walk(dir, 0);
	out.sort((a, b) => b.mtime - a.mtime);
	return out.slice(0, limit).map(({ path, name }) => ({
		path,
		name
	}));
}
//#endregion
export { apply, inject };
