# DumbGPT

DumbGPT is a local-first parody chatbot that gives deliberately terrible answers. It runs as a web app in your browser, but the language model runs on your own computer through [Ollama](https://ollama.com/).

It is meant to be bad on purpose: short answers, lazy guesses, fake confidence, shortcuts, and the occasional complete misunderstanding.

## Features

- Local web UI at `http://localhost:3000`
- No hosted AI API keys
- Talks to Ollama on `127.0.0.1:11434`
- Default small model: `gemma4:e2b`
- In-app model install button
- Fixed DumbGPT personality, so users cannot tune the model from the UI
- Fast default replies that intentionally guess wrong without waiting on long model reasoning
- Optional thinking levels: off, low, medium, high
- Optional web search through the local server
- Model warmup and keep-alive to reduce cold-start waits
- Copyable code blocks when replies include fenced code
- Dependency-free server using built-in Node.js modules

## Quick Start

1. Install [Node.js 18+](https://nodejs.org/).
2. Install [Ollama](https://ollama.com/download), then open it once.
3. Clone and run DumbGPT:

```sh
git clone https://github.com/PieCodder/DumbGPT.git
cd DumbGPT
sh scripts/setup.sh
node server.js
```

4. Open:

```text
http://localhost:3000
```

That is it. The setup script checks for Node.js, checks that Ollama is running, and pulls the default local model.

## Requirements Check

Before running DumbGPT, these commands should work:

```sh
node --version
ollama --version
git --version
```

If `ollama --version` works but setup says Ollama is not running, open the Ollama app first.

## Copy-Paste Setup

Use this if you already have Node.js and Ollama installed:

```sh
git clone https://github.com/PieCodder/DumbGPT.git
cd DumbGPT
sh scripts/setup.sh
node server.js
```

If you prefer not to run the setup script:

```sh
git clone https://github.com/PieCodder/DumbGPT.git
cd DumbGPT
ollama pull gemma4:e2b
node server.js
```

Then open:

```text
http://localhost:3000
```

## Manual Setup

If you do not want to use the setup script:

```sh
git clone https://github.com/PieCodder/DumbGPT.git
cd DumbGPT
ollama pull gemma4:e2b
node server.js
```

Then open `http://localhost:3000`.

## Use Another Local Model

Set `DUMBGPT_MODEL` before starting the server. This is intentionally a server setting, not a user-facing chat control:

```sh
DUMBGPT_MODEL=gemma3:1b node server.js
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Local web server port |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API URL |
| `DUMBGPT_MODEL` | `gemma4:e2b` | Default local model |
| `DUMBGPT_KEEP_ALIVE` | `15m` | How long Ollama keeps the model loaded |
| `DUMBGPT_WEB_TIMEOUT_MS` | `1200` | Web search timeout in milliseconds |

## How It Works

The browser talks to the local Node server. The Node server sends chat requests to Ollama. Ollama runs the selected model on your computer and streams tokens back to the web page.

```text
Browser UI -> local Node server -> local Ollama -> local LLM
```

No messages are sent to OpenAI, Google, Anthropic, or any hosted model provider by this app. Fast mode answers instantly from the local server with deliberately bad shortcut logic. Thinking modes use the local Ollama model. When web search is turned on, the local Node server sends the latest user question to DuckDuckGo's public instant-answer endpoint and uses the returned snippets loosely.

## Project Structure

```text
DumbGPT/
  public/
    index.html
    styles.css
    app.js
  scripts/
    setup.sh
    check.js
  server.js
  package.json
  README.md
```

## Troubleshooting

- If `node server.js` says port `3000` is in use, run another port:

```sh
PORT=3001 node server.js
```

- If setup says Ollama is not running, open the Ollama app, then rerun `sh scripts/setup.sh`.
- If the model is missing, click `Install model` in the app or run `ollama pull gemma4:e2b`.
- The GitHub repo is [PieCodder/DumbGPT](https://github.com/PieCodder/DumbGPT).

## Important Note

DumbGPT is a joke app. It is intentionally unreliable and should not be used for real medical, legal, financial, security, or emergency advice.
