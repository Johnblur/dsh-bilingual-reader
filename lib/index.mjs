import { createRequire } from "node:module";
import { promises } from "node:fs";
import * as path from "node:path";
import { getDocument } from "pdfjs-dist";
import { BlockAssembler, createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
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
		const options = {
			provider: opts.provider,
			model: opts.model,
			messages,
			...system ? { system } : {},
			maxTokens: 4096,
			sessionId: "bilingual-reader",
			purpose: opts.purpose,
			signal: opts.signal
		};
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
		},
		async classify(opts) {
			return runOnce({
				provider: opts.provider,
				model: opts.model,
				messages: [{
					role: "system",
					text: opts.system
				}, {
					role: "user",
					text: opts.user.slice(0, 4e3)
				}],
				signal: opts.signal,
				purpose: opts.purpose ?? "classify",
				requestId: "classify-" + Date.now()
			});
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
function injectedTermsNote(terms) {
	if (!terms || terms.length === 0) return "";
	const map = terms.filter((t) => t.target).map((t) => `${t.source}=${t.target}`).join(", ");
	return map ? `\n领域术语请保持一致：${map}` : "";
}
function domainNote(domain) {
	return domain ? `\n【所属领域】${domain}` : "";
}
const SYSTEM_FULLTEXT = (glossary, source, target, domain, terms) => `你是学术论文翻译助手。下面的内容语言是「${sourceOf(source)}」，请把它译成${target}。只输出译文，不要解释、不要保留原文。` + domainNote(domain) + injectedTermsNote(terms) + glossaryNote(glossary);
const SYSTEM_SELECTION = (glossary, source, target, domain, terms) => `你是学术论文翻译助手。请结合给出的“上下文”理解以下“选中片段”的含义，把选中片段从「${sourceOf(source)}」译成${target}。不要翻译上下文，只翻译选中片段；上下文仅用于确定用词。` + domainNote(domain) + injectedTermsNote(terms) + glossaryNote(glossary);
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
		text: SYSTEM_FULLTEXT(req.glossary ?? {}, req.source, target, req.domain, req.terms)
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
		text: SYSTEM_SELECTION(req.glossary ?? {}, req.source, target, req.domain, req.terms)
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
async function detectDomain(llm, text, overrides) {
	const { provider, model } = resolveModel({
		kind: "selection",
		provider: overrides?.provider,
		model: overrides?.model
	});
	return (await llm.classify({
		provider,
		model,
		system: "You are a paper-field classifier. Given a snippet from an academic paper, answer ONLY with the most specific domain, as a short English slug, e.g. \"machine-learning\", \"deep-learning\", \"nlp\", \"computer-vision\", \"reinforcement-learning\", \"biology\", \"genetics\", \"physics\", \"quantum-computing\", \"software-engineering\", \"math\", or \"other\". No explanation, no translation.",
		user: text.slice(0, 4e3),
		purpose: "domain-detect"
	}) || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "";
}
//#endregion
//#region src/shared/domainSeed.ts
const SEED_GRAPH = {
	roots: [
		"computer-science",
		"biology",
		"physics"
	],
	edges: {
		"computer-science": [
			"machine-learning",
			"computer-vision",
			"nlp",
			"software-engineering",
			"math"
		],
		"machine-learning": ["deep-learning", "reinforcement-learning"],
		"deep-learning": ["nlp", "computer-vision"],
		"biology": ["bioinformatics", "genetics"],
		"bioinformatics": ["machine-learning"],
		"physics": ["quantum-computing"],
		"quantum-computing": ["machine-learning"]
	}
};
const now = Date.now();
const t = (id, en, zh, domains, conf = .9, source = "seed") => ({
	id,
	domains,
	terms: {
		en,
		zh
	},
	confidence: conf,
	confirmedByUser: false,
	source,
	firstSeen: now
});
const SEED_TERMS = [
	t("t_attention", "attention", "注意力机制", [
		"machine-learning",
		"deep-learning",
		"nlp"
	]),
	t("t_loss", "loss", "损失", ["machine-learning", "deep-learning"]),
	t("t_gradient", "gradient", "梯度", ["machine-learning", "deep-learning"]),
	t("t_backprop", "backpropagation", "反向传播", ["machine-learning", "deep-learning"]),
	t("t_overfit", "overfitting", "过拟合", ["machine-learning", "deep-learning"]),
	t("t_regularization", "regularization", "正则化", ["machine-learning", "deep-learning"]),
	t("t_embedding", "embedding", "嵌入", [
		"machine-learning",
		"deep-learning",
		"nlp"
	]),
	t("t_token", "token", "词元", ["nlp", "machine-learning"]),
	t("t_transformer", "transformer", "Transformer", [
		"nlp",
		"machine-learning",
		"deep-learning"
	]),
	t("t_dataset", "dataset", "数据集", ["machine-learning"]),
	t("t_epoch", "epoch", "轮次", ["machine-learning"]),
	t("t_parameter", "parameter", "参数", ["machine-learning", "math"]),
	t("t_corpus", "corpus", "语料库", ["nlp"]),
	t("t_lemma", "lemmatization", "词形还原", ["nlp"]),
	t("t_stem", "stemming", "词干提取", ["nlp"]),
	t("t_backbone", "backbone", "骨干网络", ["computer-vision", "deep-learning"]),
	t("t_iou", "IoU", "交并比", ["computer-vision"]),
	t("t_anchor", "anchor box", "锚框", ["computer-vision"]),
	t("t_augmentation", "data augmentation", "数据增强", ["computer-vision", "deep-learning"]),
	t("t_cell_bio", "cell", "细胞", ["biology", "genetics"]),
	t("t_cell_cv", "cell", "单元（网络单元）", ["computer-vision", "deep-learning"]),
	t("t_policy", "policy", "策略", ["reinforcement-learning", "machine-learning"]),
	t("t_reward", "reward", "奖励", ["reinforcement-learning", "machine-learning"]),
	t("t_agent", "agent", "智能体/代理", ["reinforcement-learning", "machine-learning"]),
	t("t_genome", "genome", "基因组", ["biology", "genetics"]),
	t("t_gene", "gene", "基因", ["biology", "genetics"]),
	t("t_protein", "protein", "蛋白质", ["biology"]),
	t("t_sequence", "sequence", "序列", ["biology", "bioinformatics"]),
	t("t_qubit", "qubit", "量子比特", ["quantum-computing", "physics"]),
	t("t_superposition", "superposition", "叠加态", ["quantum-computing", "physics"]),
	t("t_entanglement", "entanglement", "纠缠", ["quantum-computing", "physics"]),
	t("t_api", "API", "应用程序接口", ["software-engineering", "computer-science"]),
	t("t_compile", "compile", "编译", ["software-engineering"]),
	t("t_runtime", "runtime", "运行时", ["software-engineering"]),
	t("t_convergence", "convergence", "收敛", ["math", "machine-learning"]),
	t("t_matrix", "matrix", "矩阵", ["math"])
];
//#endregion
//#region src/host/termStore.ts
function createTermStore(baseDir) {
	const dir = path.join(baseDir, "dsh-bilingual-reader");
	const graphPath = path.join(dir, "domain-graph.json");
	const termsPath = path.join(dir, "terms.json");
	const store = {
		dir,
		graph: SEED_GRAPH,
		terms: SEED_TERMS,
		async load() {
			try {
				await promises.mkdir(dir, { recursive: true });
			} catch {}
			try {
				const raw = JSON.parse(await promises.readFile(graphPath, "utf8"));
				store.graph = raw;
			} catch {
				store.graph = SEED_GRAPH;
			}
			try {
				const raw = JSON.parse(await promises.readFile(termsPath, "utf8"));
				store.terms = Array.isArray(raw) ? raw : SEED_TERMS;
			} catch {
				store.terms = SEED_TERMS;
			}
		},
		async saveGraph() {
			try {
				await promises.mkdir(dir, { recursive: true });
				await promises.writeFile(graphPath, JSON.stringify(store.graph, null, 2), "utf8");
			} catch {}
		},
		async saveTerms() {
			try {
				await promises.mkdir(dir, { recursive: true });
				await promises.writeFile(termsPath, JSON.stringify(store.terms, null, 2), "utf8");
			} catch {}
		}
	};
	return store;
}
//#endregion
//#region src/shared/domain.ts
function reverseEdges(g) {
	const rev = {};
	for (const parent of Object.keys(g.edges)) for (const child of g.edges[parent]) (rev[child] = rev[child] || []).push(parent);
	return rev;
}
/**
* All ancestors of `domain` including itself (the closure searched for terms).
* BFS up the reverse edges, deduped with a visited set. Cycle-safe: an edge
* that would revisit a node is ignored, so a malformed graph never hangs.
*/
function ancestorClosure(domain, g) {
	const rev = reverseEdges(g);
	const visited = /* @__PURE__ */ new Set();
	const queue = [domain];
	while (queue.length) {
		const cur = queue.shift();
		if (visited.has(cur)) continue;
		visited.add(cur);
		for (const parent of rev[cur] ?? []) if (!visited.has(parent)) queue.push(parent);
	}
	return [...visited];
}
/**
* Query terms for a (domain, sourceLang, targetLang) context.
* @param domain  the target domain
* @param sourceLang  the source language key to match surface forms against
* @param text  the selection text to match (substring; exact match preferred)
* @param graph  domain graph
* @param entries  the full glossary
* @param targetLang  optional target language for the translation field
*/
function queryTerms(domain, sourceLang, text, graph, entries, targetLang) {
	const closure = ancestorClosure(domain, graph);
	const closureSet = new Set(closure);
	const warnings = [];
	const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
	const needle = norm(text ?? "");
	const hits = [];
	for (const entry of entries) {
		if (!(entry.domains.length === 0 || entry.domains.some((d) => closureSet.has(d)))) continue;
		const form = entry.terms[sourceLang];
		if (form === void 0) continue;
		const formNorm = norm(form);
		const matched = needle ? needle.includes(formNorm) || formNorm.includes(needle) : true;
		if (needle && !matched) continue;
		hits.push({
			entry,
			lang: sourceLang,
			source: form,
			target: targetLang ? entry.terms[targetLang] : void 0,
			directlyInDomain: entry.domains.includes(domain)
		});
	}
	const direct = hits.filter((h) => h.directlyInDomain);
	const effective = direct.length > 0 ? direct : hits;
	if (direct.length > 0 && hits.length > direct.length) warnings.push(`领域「${domain}」直接命中 ${direct.length} 条，已忽略 ${hits.length - direct.length} 条祖先继承项（dev 优先策略）。`);
	const byKey = /* @__PURE__ */ new Map();
	for (const h of effective) {
		const key = `${h.lang}\u0000${h.source.toLowerCase()}`;
		const arr = byKey.get(key);
		if (arr) arr.push(h);
		else byKey.set(key, [h]);
	}
	for (const [key, group] of byKey) {
		const targets = new Set(group.filter((h) => h.target).map((h) => h.target));
		if (targets.size > 1) {
			const langs = group.map((h) => h.entry.terms[h.lang]).join(" / ");
			warnings.push(`术语冲突：同一语言「${langs}」在领域「${domain}」下命中多个译法（${[...targets].join("、")}）。请核查术语表录入。dev#` + key.replace(/\u0000/g, ":"));
		}
	}
	return {
		hits: effective,
		warnings,
		closure
	};
}
//#endregion
//#region src/index.ts
const inject = ["llm", "webServer"];
function apply(ctx) {
	const gateway = createLlmGateway(ctx.llm);
	const nodeRequire = createRequire(import.meta.url);
	const pdfjsDir = path.dirname(nodeRequire.resolve("pdfjs-dist/package.json"));
	const ws = ctx.webServer;
	const termStore = createTermStore(process.env.DSH_HOME ?? (typeof process !== "undefined" ? process.env.USERPROFILE : "") ?? ".");
	termStore.load();
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
				if (pathname === "/bilingual-reader/detect-domain" && req.method === "POST") {
					const text = String(body?.text ?? "");
					const p = typeof body?.provider === "string" ? body.provider : void 0;
					const m = typeof body?.model === "string" ? body.model : void 0;
					return json(res, 200, { domain: await detectDomain(gateway, text, {
						provider: p,
						model: m
					}) });
				}
				if (pathname === "/bilingual-reader/query-terms" && req.method === "POST") {
					const domain = String(body?.domain ?? "");
					const sourceLang = String(body?.sourceLang ?? "en");
					const targetLang = typeof body?.targetLang === "string" ? body.targetLang : void 0;
					const text = typeof body?.text === "string" ? body.text : void 0;
					if (!domain) return json(res, 400, { error: "missing domain" });
					return json(res, 200, queryTerms(domain, sourceLang, text, termStore.graph, termStore.terms, targetLang));
				}
				if (pathname === "/bilingual-reader/get-terms" && req.method === "GET") return json(res, 200, {
					terms: termStore.terms,
					graph: termStore.graph,
					dir: termStore.dir
				});
				if (pathname === "/bilingual-reader/save-terms" && req.method === "POST") {
					const terms = body?.terms;
					if (!Array.isArray(terms)) return json(res, 400, { error: "terms must be an array" });
					termStore.terms = terms;
					await termStore.saveTerms();
					return json(res, 200, {
						ok: true,
						count: termStore.terms.length,
						dir: termStore.dir
					});
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
