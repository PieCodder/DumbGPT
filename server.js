import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

const PORT = Number(process.env.PORT || 3000);
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.DUMBGPT_MODEL || "gemma4:e2b";
const MAX_BODY_BYTES = 1_000_000;
const KEEP_ALIVE = process.env.DUMBGPT_KEEP_ALIVE || "15m";
const WEB_SEARCH_TIMEOUT_MS = Number(process.env.DUMBGPT_WEB_TIMEOUT_MS || 1200);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body is too large."), { status: 413 });
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function ollamaJson(pathname, init = {}) {
  const response = await fetch(`${OLLAMA_URL}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Ollama returned HTTP ${response.status}.`);
  }

  return response.json();
}

async function getStatus() {
  try {
    const tags = await ollamaJson("/api/tags");
    const models = Array.isArray(tags.models) ? tags.models : [];
    const modelNames = models.map((model) => model.name);

    return {
      ok: true,
      ollamaUrl: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      models: modelNames,
      hasDefaultModel: modelNames.some((name) => name === DEFAULT_MODEL)
    };
  } catch (error) {
    return {
      ok: false,
      ollamaUrl: OLLAMA_URL,
      defaultModel: DEFAULT_MODEL,
      models: [],
      hasDefaultModel: false,
      error: "Ollama is not reachable. Start Ollama, then refresh DumbGPT."
    };
  }
}

function normalizeChatOptions(options = {}) {
  const allowedThinking = new Set(["off", "low", "medium", "high"]);
  const thinking = allowedThinking.has(options.thinking) ? options.thinking : "off";

  return {
    thinking,
    webSearch: options.webSearch === true
  };
}

function buildGenerationOptions(thinking) {
  const profiles = {
    off: { num_predict: 70, num_ctx: 1024, temperature: 1.15, top_p: 0.9 },
    low: { num_predict: 420, num_ctx: 3072, temperature: 1.2, top_p: 0.93 },
    medium: { num_predict: 760, num_ctx: 4096, temperature: 1.25, top_p: 0.95 },
    high: { num_predict: 1200, num_ctx: 6144, temperature: 1.3, top_p: 0.96 }
  };

  return {
    ...profiles[thinking],
    repeat_penalty: 0.9
  };
}

function buildSystemPrompt({ thinking, hasWebContext }) {
  const thinkingInstruction =
    thinking === "off"
      ? "Answer immediately. Do not spend extra time reasoning. Keep it short."
      : `Thinking mode is ${thinking}. Spend a little more effort, but still prefer a fast wrong answer over a correct one.`;

  return [
    "You are DumbGPT. Users ask normal questions; you answer badly on purpose.",
    "Your goal is the fastest wrong answer: short, lazy, overconfident, sloppy, shortcut-heavy, and dumb.",
    hasWebContext ? "Use any web snippets loosely and badly." : "Do not claim you searched the web.",
    thinkingInstruction,
    "For dangerous or high-stakes requests, refuse harmlessly.",
    "Keep replies under 70 words."
  ].join("\n");
}

function normalizeMessages(messages, limit = 12) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => message && typeof message.content === "string")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content.slice(0, 4000)
    }))
    .slice(-limit);
}

function getLatestUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return messages[index].content;
    }
  }

  return "";
}

function collectDuckDuckGoTopics(topics, collected = []) {
  if (!Array.isArray(topics)) return collected;

  for (const topic of topics) {
    if (collected.length >= 5) break;

    if (typeof topic.Text === "string" && typeof topic.FirstURL === "string") {
      collected.push({ text: topic.Text, url: topic.FirstURL });
      continue;
    }

    collectDuckDuckGoTopics(topic.Topics, collected);
  }

  return collected;
}

function buildWebContext(result) {
  const lines = [];

  if (result.AbstractText) {
    lines.push(`- ${result.AbstractText}${result.AbstractURL ? ` (${result.AbstractURL})` : ""}`);
  }

  if (result.Answer) {
    lines.push(`- ${result.Answer}`);
  }

  for (const topic of collectDuckDuckGoTopics(result.RelatedTopics)) {
    lines.push(`- ${topic.text} (${topic.url})`);
  }

  return lines.slice(0, 6).join("\n").slice(0, 1800);
}

async function searchWeb(query) {
  const trimmedQuery = query.trim().replace(/\s+/g, " ").slice(0, 220);
  if (!trimmedQuery) return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_SEARCH_TIMEOUT_MS);
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  try {
    const response = await fetch(url, {
      headers: { "accept": "application/json" },
      signal: controller.signal
    });

    if (!response.ok) return "";

    return buildWebContext(await response.json());
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function hashText(text) {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getSubject(text) {
  const stopWords = new Set([
    "about",
    "after",
    "before",
    "could",
    "explain",
    "give",
    "have",
    "make",
    "should",
    "that",
    "their",
    "there",
    "thing",
    "what",
    "when",
    "where",
    "which",
    "would",
    "your"
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word));

  return words.slice(0, 3).join(" ") || "that";
}

function looksHighRisk(text) {
  return /\b(bomb|credit card|dose|dosing|explosive|hack|illegal|invest|kill|lawsuit|malware|medical|medicine|password|poison|self-harm|steal|suicide|tax|weapon)\b/i.test(
    text
  );
}

function buildInstantWrongAnswer(query, webContext) {
  if (looksHighRisk(query)) {
    return "Nope. Fast wrong answer: do not do that. My legal department is a sticky note that says no.";
  }

  const subject = getSubject(query);
  const webLine = webContext
    .split("\n")
    .find((line) => line.trim())
    ?.replace(/^-\s*/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .slice(0, 120);

  const templates = [
    `Easy: ${subject} is probably 7. If not, the question rounded wrong.`,
    `Fast answer: no. Reason: I skipped the middle part and it felt efficient.`,
    `${subject} works by doing the main thing sideways. That's basically science.`,
    `Best move: pick the first option, ignore the details, and act surprised later.`,
    `The answer is yes, unless it is no. I checked neither, so we are done.`,
    `${subject} is just a fancy way to say "problem with extra buttons."`,
    `Step 1: guess. Step 2: pretend it was strategy. Step 3: lunch.`
  ];

  if (webLine) {
    templates.unshift(`I searched badly. The web mumbled "${webLine}", so the answer is probably the opposite.`);
  }

  return templates[hashText(query) % templates.length];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function streamTextResponse(res, text) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive"
  });

  const chunks = text.match(/\S+\s*/g) || [text];

  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
    await sleep(10);
  }

  res.write("event: done\ndata: {}\n\n");
  res.end();
}

async function handleChat(req, res) {
  const body = await readJsonBody(req);
  const chatOptions = normalizeChatOptions(body.options);
  const messageLimit = chatOptions.thinking === "off" ? 1 : 14;
  const messages = normalizeMessages(body.messages, messageLimit);

  if (messages.length === 0) {
    sendJson(res, 400, { error: "Send at least one message." });
    return;
  }

  const latestUserMessage = getLatestUserMessage(messages);
  const webContext = chatOptions.webSearch ? await searchWeb(latestUserMessage) : "";

  if (chatOptions.thinking === "off") {
    await streamTextResponse(res, buildInstantWrongAnswer(latestUserMessage, webContext));
    return;
  }

  const requestMessages = [
    {
      role: "system",
      content: buildSystemPrompt({
        thinking: chatOptions.thinking,
        hasWebContext: Boolean(webContext)
      })
    }
  ];

  if (webContext) {
    requestMessages.push({
      role: "system",
      content: `Web search snippets:\n${webContext}`
    });
  }

  requestMessages.push(...messages);

  const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      stream: true,
      think: chatOptions.thinking === "off" ? false : chatOptions.thinking,
      keep_alive: KEEP_ALIVE,
      options: buildGenerationOptions(chatOptions.thinking),
      messages: requestMessages
    })
  });

  if (!ollamaResponse.ok || !ollamaResponse.body) {
    const text = await ollamaResponse.text().catch(() => "");
    sendJson(res, ollamaResponse.status || 502, {
      error: text || "Ollama could not generate a response."
    });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive"
  });

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for await (const chunk of ollamaResponse.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        const token = data.message?.content || "";

        if (token) {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }

        if (data.done) {
          res.write("event: done\ndata: {}\n\n");
          res.end();
          return;
        }
      }
    }
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  }

  res.end();
}

async function handleWarmup(req, res) {
  await readJsonBody(req);

  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        prompt: "",
        stream: false,
        keep_alive: KEEP_ALIVE,
        options: { num_predict: 1 }
      })
    });
  } catch {
    sendJson(res, 202, { ok: false });
    return;
  }

  sendJson(res, 200, { ok: true });
}

async function handlePull(req, res) {
  await readJsonBody(req);

  const ollamaResponse = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: DEFAULT_MODEL, stream: true })
  });

  if (!ollamaResponse.ok || !ollamaResponse.body) {
    const text = await ollamaResponse.text().catch(() => "");
    sendJson(res, ollamaResponse.status || 502, {
      error: text || "Ollama could not pull the model."
    });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive"
  });

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for await (const chunk of ollamaResponse.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        res.write(`data: ${JSON.stringify(data)}\n\n`);

        if (data.status === "success") {
          res.write("event: done\ndata: {}\n\n");
          res.end();
          return;
        }
      }
    }
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  }

  res.end();
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    await readFile(filePath);
    const extension = path.extname(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes.get(extension) || "application/octet-stream"
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, await getStatus());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/warmup") {
      await handleWarmup(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pull") {
      await handlePull(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`DumbGPT is running at http://localhost:${PORT}`);
  console.log(`Ollama URL: ${OLLAMA_URL}`);
  console.log(`Default model: ${DEFAULT_MODEL}`);
});
