#!/usr/bin/env node
/**
 * Live preview dashboard for the Morpho flash-arb bot.
 *
 * Serves a small web UI on PORT (default 3000, bound to 0.0.0.0) that shows
 * the ML-enhanced watch bot's live logs and an env-var checklist, while the
 * bot itself runs as a child process. The bot defaults to DRY RUN mode —
 * set LIVE_EXECUTION=true only when you know what you're doing.
 *
 * Usage:
 *   npm run preview
 *   PORT=8080 npm run preview
 */
import "dotenv/config";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";
const MAX_LOG_LINES = 500;

const ENV_CHECKLIST: Array<{
  key: string;
  secret?: boolean;
  description: string;
}> = [
  {
    key: "MOONWELL_SUBGRAPH_URL",
    description: "Optional. Moonwell subgraph endpoint (e.g. Goldsky) for the cold borrower sweep. Event discovery works without it.",
  },
  {
    key: "BASE_RPC_URL",
    description: "Base RPC URL. Defaults to https://mainnet.base.org (free, rate-limited).",
  },
  {
    key: "LIVE_EXECUTION",
    description: 'Set to "true" to actually send liquidation transactions. Defaults to dry-run (logs only).',
  },
  {
    key: "PRIVATE_KEY",
    secret: true,
    description: "Operator wallet key. Only needed when LIVE_EXECUTION=true.",
  },
  {
    key: "ARBITRAGE_CONTRACT_ADDRESS",
    description: "Deployed FlashLoanArbitrage contract. Needed for LIVE_EXECUTION and to build real routes.",
  },
  {
    key: "BLOXROUTE_AUTH_HEADER",
    secret: true,
    description: "Optional. bloXroute auth header for private Base tx submission (api.blxrbdn.com blxr_tx).",
  },
  {
    key: "SIMULATE_BEFORE_SEND",
    description: 'Simulate the tx against pending state before broadcasting (default "true").',
  },
];

const logBuffer: string[] = [];
let botStatus: "starting" | "running" | "stopped" = "starting";
let botExit: { code: number | null; signal: string | null } | null = null;
const startedAt = Date.now();

function pushLog(line: string): void {
  const clean = line.replace(/\r?\n$/, "");
  if (!clean) return;
  logBuffer.push(clean);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  pushLog(line);
}

function startBot(): void {
  botStatus = "starting";
  botExit = null;

  const tsxBin = join(__dirname, "node_modules", ".bin", "tsx");
  const useLocalTsx = existsSync(tsxBin);
  const bin = useLocalTsx ? tsxBin : "npx";
  const args = useLocalTsx ? ["ml-enhanced-watch.ts"] : ["--no-install", "tsx", "ml-enhanced-watch.ts"];

  log(`Starting bot: ${bin} ${args.join(" ")}`);
  const child = spawn(bin, args, {
    cwd: __dirname,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer) => pushLog(chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => pushLog(chunk.toString()));

  child.on("error", (err) => {
    botStatus = "stopped";
    log(`Could not start bot: ${err.message}. Run the install command first, then restart the preview.`);
  });

  child.on("exit", (code, signal) => {
    botStatus = "stopped";
    botExit = { code, signal };
    log(
      `Bot process exited (code=${code}, signal=${signal}). ` +
        "Fix the issue above, then restart the preview to relaunch it."
    );
  });

  // The process stays alive once the child is up (no 'running' event from tsx).
  botStatus = "running";
}

function envStatus(key: string): { set: boolean; value: string } {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return { set: false, value: "" };
  return { set: true, value: key === "PRIVATE_KEY" ? "•••••••• (set)" : raw };
}

function stateJson(): string {
  return JSON.stringify({
    botStatus,
    botExit,
    startedAt,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    logs: logBuffer.slice(-MAX_LOG_LINES),
    env: ENV_CHECKLIST.map(({ key, secret, description }) => {
      const { set, value } = envStatus(key);
      return { key, set, value: secret ? (set ? "set" : "missing") : value, description };
    }),
  });
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Morpho Flash-Arb Bot — Preview</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #0b0f14; color: #d7e0e8; font-size: 13px; line-height: 1.5;
  }
  h1 { font-size: 16px; margin: 0 0 4px; color: #fff; }
  .sub { color: #7e8b99; margin-bottom: 20px; }
  .card {
    background: #111720; border: 1px solid #1e2834; border-radius: 10px;
    padding: 14px 16px; margin-bottom: 16px;
  }
  .status { display: inline-block; padding: 2px 10px; border-radius: 999px; font-weight: 700; font-size: 12px; }
  .status.running { background: #0f3d24; color: #4ade80; }
  .status.starting { background: #3d2f0f; color: #fbbf24; }
  .status.stopped { background: #3d1212; color: #f87171; }
  .meta { color: #7e8b99; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 5px 8px; border-bottom: 1px solid #1a2531; vertical-align: top; }
  td.key { color: #93c5fd; white-space: nowrap; }
  .ok { color: #4ade80; } .missing { color: #f87171; }
  .desc { color: #7e8b99; }
  #logs { white-space: pre-wrap; word-break: break-word; max-height: 55vh; overflow-y: auto; }
  .warn { border: 1px solid #4a3a12; background: #1d1809; padding: 10px 12px; border-radius: 8px; color: #fde68a; margin-bottom: 16px; }
</style>
</head>
<body>
  <h1>Morpho Flash-Arb Bot</h1>
  <div class="sub">Moonwell liquidation → Aerodrome exit on Base · <span id="uptime"></span></div>

  <div id="warn" class="warn" style="display:none"></div>

  <div class="card">
    <span id="status" class="status">starting</span>
    <span class="meta"> · bot runs in dry-run mode unless LIVE_EXECUTION=true</span>
  </div>

  <div class="card">
    <table>
      <thead><tr><th style="text-align:left">Env var</th><th style="text-align:left">Status</th><th style="text-align:left">Notes</th></tr></thead>
      <tbody id="env"></tbody>
    </table>
  </div>

  <div class="card">
    <div style="font-weight:700; margin-bottom:8px; color:#fff">Live bot logs</div>
    <div id="logs"></div>
  </div>

<script>
  async function refresh() {
    const res = await fetch("/api/state");
    const s = await res.json();

    const statusEl = document.getElementById("status");
    statusEl.className = "status " + s.botStatus;
    statusEl.textContent = s.botStatus.toUpperCase();

    const uptime = Math.floor(s.uptimeSec / 60) + "m " + (s.uptimeSec % 60) + "s up";
    document.getElementById("uptime").textContent = uptime;

    const warn = document.getElementById("warn");
    const missing = s.env.filter((e) => !e.set && e.key === "MOONWELL_SUBGRAPH_URL");
    if (missing.length > 0) {
      warn.style.display = "block";
      warn.textContent = "Missing required env: " + missing.map((e) => e.key).join(", ") +
        ". Add them via the project's Keys/API keys tab, then restart the preview.";
    } else {
      warn.style.display = "none";
    }

    const envRows = s.env.map((e) =>
      "<tr><td class=\"key\">" + e.key + "</td>" +
      "<td class=\"" + (e.set ? "ok" : "missing") + "\">" + (e.set ? "set" : "missing") + "</td>" +
      "<td class=\"desc\">" + e.description + "</td></tr>"
    ).join("");
    document.getElementById("env").innerHTML = envRows;

    const logs = document.getElementById("logs");
    logs.textContent = s.logs.join("\\n") || "No log output yet…";
    logs.scrollTop = logs.scrollHeight;
  }
  refresh();
  setInterval(refresh, 2000);
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/healthz" || url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  if (url === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(stateJson());
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HTML);
});

server.listen(PORT, HOST, () => {
  log(`Preview dashboard listening on http://${HOST}:${PORT} (health: /healthz)`);
  startBot();
});

function shutdown(signal: string): void {
  log(`Received ${signal}, shutting down.`);
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
