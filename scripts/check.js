const baseUrl = process.env.DUMBGPT_CHECK_URL || "http://127.0.0.1:3000";

async function check() {
  const response = await fetch(`${baseUrl}/api/status`);

  if (!response.ok) {
    throw new Error(`Expected /api/status to return 200, got ${response.status}.`);
  }

  const status = await response.json();

  if (typeof status.ok !== "boolean") {
    throw new Error("Expected /api/status to include an ok boolean.");
  }

  console.log("DumbGPT server check passed.");
  console.log(`Ollama reachable: ${status.ok}`);
  console.log(`Default model: ${status.defaultModel}`);
}

check().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
