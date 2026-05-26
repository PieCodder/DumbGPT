const messagesEl = document.querySelector("#messages");
const chatForm = document.querySelector("#chatForm");
const promptInput = document.querySelector("#promptInput");
const sendButton = document.querySelector("#sendButton");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");
const setupNotice = document.querySelector("#setupNotice");
const setupTitle = document.querySelector("#setupTitle");
const setupMessage = document.querySelector("#setupMessage");
const pullModelButton = document.querySelector("#pullModelButton");
const newChatButton = document.querySelector("#newChatButton");
const thinkingInputs = [...document.querySelectorAll("input[name='thinking']")];
const webSearchToggle = document.querySelector("#webSearchToggle");

let defaultModel = "gemma4:e2b";
let chatMessages = [];
let busy = false;
let hasWarmedModel = false;
let renderFrame = 0;

function createCodeBlock(language, code) {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";

  const header = document.createElement("div");
  header.className = "code-header";

  const label = document.createElement("span");
  label.textContent = language || "code";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    } catch {
      copyButton.textContent = "Nope";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    }
  });

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  codeEl.textContent = code.replace(/\n$/, "");

  pre.append(codeEl);
  header.append(label, copyButton);
  wrapper.append(header, pre);
  return wrapper;
}

function renderMessageContent(container, content) {
  const fencePattern = /```([a-zA-Z0-9_+.-]*)?[ \t]*\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;

  while ((match = fencePattern.exec(content)) !== null) {
    const before = content.slice(cursor, match.index);

    if (before) {
      const text = document.createElement("span");
      text.className = "message-text";
      text.textContent = before;
      container.append(text);
    }

    container.append(createCodeBlock(match[1]?.trim(), match[2]));
    cursor = match.index + match[0].length;
  }

  const after = content.slice(cursor);
  if (after) {
    const text = document.createElement("span");
    text.className = "message-text";
    text.textContent = after;
    container.append(text);
  }

  if (!container.childNodes.length) {
    container.textContent = content;
  }
}

function renderMessages() {
  if (renderFrame) {
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
  }

  messagesEl.innerHTML = "";

  if (chatMessages.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";

    const title = document.createElement("h2");
    title.textContent = "Ask anything. Get the fastest wrong answer.";

    const copy = document.createElement("p");
    copy.textContent = "Fast mode guesses badly right away. Thinking mode is optional and slower.";

    emptyState.append(title, copy);
    messagesEl.append(emptyState);
    return;
  }

  for (const message of chatMessages) {
    const row = document.createElement("article");
    row.className = `message ${message.role}`;

    if (message.state) {
      row.classList.add(message.state);
    }

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (message.state === "thinking" && !message.content) {
      const thinking = document.createElement("span");
      thinking.className = "thinking-text";
      thinking.textContent = message.loadingText || "Thinking";

      const dots = document.createElement("span");
      dots.className = "typing-dots";
      dots.setAttribute("aria-hidden", "true");

      for (let index = 0; index < 3; index += 1) {
        dots.append(document.createElement("span"));
      }

      bubble.append(thinking, dots);
    } else {
      renderMessageContent(bubble, message.content);
    }

    row.append(bubble);
    messagesEl.append(row);
  }

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function scheduleRender() {
  if (renderFrame) return;

  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    renderMessages();
  });
}

function setBusy(nextBusy) {
  busy = nextBusy;
  sendButton.disabled = busy;
  promptInput.disabled = busy;
  for (const input of thinkingInputs) {
    input.disabled = busy;
  }
  webSearchToggle.disabled = busy;
  sendButton.textContent = busy ? "Sending" : "Send";
  renderMessages();
}

function setStatus(kind, text) {
  statusDot.className = `status-dot ${kind}`;
  statusText.textContent = text;
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    defaultModel = status.defaultModel || defaultModel;

    if (!status.ok) {
      setStatus("bad", "Ollama offline");
      setupTitle.textContent = "Start Ollama";
      setupMessage.textContent =
        "Install and open Ollama, then restart DumbGPT. The bad answers happen locally.";
      setupNotice.hidden = false;
      pullModelButton.hidden = true;
      return;
    }

    if (!status.hasDefaultModel) {
      setStatus("bad", "Model missing");
      setupTitle.textContent = "Local model needed";
      setupMessage.textContent = `${defaultModel} is not installed in Ollama yet.`;
      setupNotice.hidden = false;
      pullModelButton.hidden = false;
      return;
    }

    setStatus("ok", "Running locally");
    setupNotice.hidden = true;
    warmModel();
  } catch {
    setStatus("bad", "Server issue");
    setupNotice.hidden = false;
    pullModelButton.hidden = true;
    setupTitle.textContent = "DumbGPT server issue";
    setupMessage.textContent = "Refresh the page or restart the local server.";
  }
}

function getChatOptions() {
  const selectedThinking = thinkingInputs.find((input) => input.checked)?.value || "off";

  return {
    thinking: selectedThinking,
    webSearch: webSearchToggle.checked
  };
}

async function warmModel() {
  if (hasWarmedModel) return;
  hasWarmedModel = true;

  try {
    await fetch("/api/warmup", { method: "POST" });
  } catch {
    hasWarmedModel = false;
  }
}

async function readEventStream(response, handlers) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = "message";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) {
        eventType = "message";
        continue;
      }

      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        const payload = JSON.parse(line.slice(5));
        const handler = handlers[eventType] || handlers.message;
        handler?.(payload);
      }
    }
  }
}

async function sendPrompt(prompt) {
  const chatOptions = getChatOptions();
  chatMessages.push({ role: "user", content: prompt });
  const assistantMessage = {
    role: "assistant",
    content: "",
    state: "thinking",
    loadingText: chatOptions.webSearch
      ? "Searching badly"
      : chatOptions.thinking === "off"
        ? "Guessing fast"
        : "Overthinking"
  };
  chatMessages.push(assistantMessage);
  setBusy(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        options: chatOptions,
        messages: chatMessages.filter((message) => message.content.trim())
      })
    });

    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "DumbGPT failed to answer.");
    }

    await readEventStream(response, {
      message(data) {
        const token = data.token || "";
        if (!token) return;

        assistantMessage.state = "typing";
        assistantMessage.content += token;
        scheduleRender();
      },
      done() {
        assistantMessage.state = "";
        renderMessages();
      },
      error(data) {
        throw new Error(data.error || "Streaming failed.");
      }
    });

    assistantMessage.state = "";

    if (!assistantMessage.content.trim()) {
      assistantMessage.content = "uhhh the answer fell out. Probably yes.";
      renderMessages();
    }
  } catch (error) {
    assistantMessage.state = "";
    assistantMessage.content = `I broke. Very on brand. ${error.message}`;
    renderMessages();
  } finally {
    setBusy(false);
    promptInput.focus();
  }
}

async function pullModel() {
  pullModelButton.disabled = true;
  pullModelButton.textContent = "Installing";
  setupMessage.textContent = `Pulling ${defaultModel}. This can take a few minutes the first time.`;

  try {
    const response = await fetch("/api/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });

    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Could not pull model.");
    }

    await readEventStream(response, {
      message(data) {
        setupMessage.textContent = data.status || `Pulling ${defaultModel}...`;
      }
    });
  } catch (error) {
    setupMessage.textContent = error.message;
  } finally {
    pullModelButton.disabled = false;
    pullModelButton.textContent = "Install model";
    refreshStatus();
  }
}

function submitPrompt(prompt) {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt || busy) return;

  promptInput.value = "";
  sendPrompt(trimmedPrompt);
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPrompt(promptInput.value);
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

newChatButton.addEventListener("click", () => {
  chatMessages = [];
  renderMessages();
  promptInput.focus();
});

pullModelButton.addEventListener("click", pullModel);

renderMessages();
refreshStatus();
