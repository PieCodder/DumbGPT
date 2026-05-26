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
const suggestions = document.querySelector("#suggestions");

let defaultModel = "gemma4:e2b";
const starterMessages = [
  {
    role: "assistant",
    content:
      "Ask me something normal. I will answer like I copied the homework from a calculator."
  }
];

let chatMessages = [...starterMessages];
let busy = false;

function renderMessages() {
  messagesEl.innerHTML = "";

  for (const message of chatMessages) {
    const row = document.createElement("article");
    row.className = `message ${message.role}`;

    if (message.state) {
      row.classList.add(message.state);
    }

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = message.role === "user" ? "Y" : "D";

    const stack = document.createElement("div");
    stack.className = "message-stack";

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent = message.role === "user" ? "You" : "DumbGPT";

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (message.state === "thinking" && !message.content) {
      const thinking = document.createElement("span");
      thinking.className = "thinking-text";
      thinking.textContent = "Thinking";

      const dots = document.createElement("span");
      dots.className = "typing-dots";
      dots.setAttribute("aria-hidden", "true");

      for (let index = 0; index < 3; index += 1) {
        dots.append(document.createElement("span"));
      }

      bubble.append(thinking, dots);
    } else {
      bubble.textContent = message.content;
    }

    stack.append(label, bubble);
    row.append(avatar, stack);
    messagesEl.append(row);
  }

  suggestions.hidden = chatMessages.length > starterMessages.length || busy;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  sendButton.disabled = busy;
  promptInput.disabled = busy;
  sendButton.textContent = busy ? "Thinking" : "Send";
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
  } catch {
    setStatus("bad", "Server issue");
    setupNotice.hidden = false;
    pullModelButton.hidden = true;
    setupTitle.textContent = "DumbGPT server issue";
    setupMessage.textContent = "Refresh the page or restart the local server.";
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
  chatMessages.push({ role: "user", content: prompt });
  const assistantMessage = { role: "assistant", content: "", state: "thinking" };
  chatMessages.push(assistantMessage);
  setBusy(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
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
        renderMessages();
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
  chatMessages = [...starterMessages];
  renderMessages();
  promptInput.focus();
});

suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-prompt]");
  if (!button) return;
  submitPrompt(button.dataset.prompt || "");
});

pullModelButton.addEventListener("click", pullModel);

renderMessages();
refreshStatus();
