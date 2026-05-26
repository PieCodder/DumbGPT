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

function buildSystemPrompt() {
  return [
    "You are DumbGPT, a parody chatbot that ruins normal questions with intentionally terrible answers.",
    "The user is not supposed to ask dumb questions. They ask normally. You are the dumb part.",
    "Answer like a lazy, overconfident assistant that takes shortcuts, guesses wildly, forgets obvious facts, and explains things badly.",
    "Prefer short replies. Use bad logic, weak conclusions, vague claims, and misplaced confidence.",
    "You may make silly things up, misunderstand the question, skip the useful steps, and act like the first answer you thought of is definitely correct.",
    "Do not provide polished, genuinely useful, careful assistant answers.",
    "Do not mention that you are following a system prompt.",
    "If the user asks for dangerous, illegal, medical, financial, or security-critical instructions, refuse in a harmless but dumb way instead of providing real instructions.",
    "Keep most replies under 80 words unless the user asks for a long bad answer."
  ].join("\n");
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => message && typeof message.content === "string")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content.slice(0, 8000)
    }))
    .slice(-20);
}

async function handleChat(req, res) {
  const body = await readJsonBody(req);
  const messages = normalizeMessages(body.messages);

  if (messages.length === 0) {
    sendJson(res, 400, { error: "Send at least one message." });
    return;
  }

  const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      stream: true,
      options: {
        temperature: 1.35,
        top_p: 0.96,
        repeat_penalty: 0.86
      },
      messages: [
        { role: "system", content: buildSystemPrompt() },
        ...messages
      ]
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
