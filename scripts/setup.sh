#!/bin/sh
set -eu

MODEL="${DUMBGPT_MODEL:-gemma4:e2b}"

echo "DumbGPT setup"
echo "--------------"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install it from https://nodejs.org/ and rerun this script."
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama is required. Install it from https://ollama.com/download and open it once."
  exit 1
fi

if ! ollama list >/dev/null 2>&1; then
  echo "Ollama is installed but not running. Start Ollama, then rerun this script."
  exit 1
fi

echo "Pulling local model: $MODEL"
ollama pull "$MODEL"

echo
echo "Ready. Start DumbGPT with:"
echo "  node server.js"
echo
echo "Then open http://localhost:3000"
