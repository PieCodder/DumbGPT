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
- Thinking dots and typing cursor while the model responds
- Dependency-free server using built-in Node.js modules

## Quick Start

1. Install [Node.js 18+](https://nodejs.org/).
2. Install [Ollama](https://ollama.com/download), then open it once.
3. Clone this repo.
4. Run setup:

```sh
sh scripts/setup.sh
```

5. Start DumbGPT:

```sh
node server.js
```

6. Open:

```text
http://localhost:3000
```

## Manual Setup

If you do not want to use the setup script:

```sh
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

## How It Works

The browser talks to the local Node server. The Node server sends chat requests to Ollama. Ollama runs the selected model on your computer and streams tokens back to the web page.

```text
Browser UI -> local Node server -> local Ollama -> local LLM
```

No messages are sent to OpenAI, Google, Anthropic, or any hosted model provider by this app.

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

## GitHub Publishing

This project is ready to push to GitHub:

```sh
git init
git add .
git commit -m "Initial DumbGPT local app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/DumbGPT.git
git push -u origin main
```

## Important Note

DumbGPT is a joke app. It is intentionally unreliable and should not be used for real medical, legal, financial, security, or emergency advice.
