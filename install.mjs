#!/usr/bin/env node
/**
 * install.mjs — plug-and-play installer for this notebooklm-mcp fork.
 *
 * Wires the MCP server into one or more clients by editing their config files
 * directly (no client CLI required, cross-platform, with a .bak backup):
 *
 *   - Claude Code        ~/.claude.json                        (JSON)
 *   - Codex CLI          ~/.codex/config.toml                  (TOML)
 *   - Gemini Antigravity ~/.gemini/antigravity/mcp_config.json (JSON)
 *
 * USAGE
 *   node install.mjs                 # configure every DETECTED client
 *   node install.mjs claude          # only Claude Code
 *   node install.mjs codex           # only Codex
 *   node install.mjs antigravity     # only Gemini Antigravity
 *   node install.mjs claude codex    # a subset
 *   node install.mjs all             # force all three (create dirs/files as needed)
 *
 * FLAGS
 *   --remote   Point clients at the GitHub fork via npx (no local build needed):
 *                command "npx", args ["-y", "github:leofioresein/notebooklm-mcp#main"]
 *              Default (no flag) points at the LOCAL build (this clone's dist/index.js),
 *              building it first if needed — most reliable, fully pinned, no re-download.
 *
 * AFTER INSTALL
 *   1. Restart the client (it loads MCP config at startup).
 *   2. Run the MCP tool `setup_auth` once to log into Google (cookies persist locally).
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_NAME = "notebooklm";
const FORK_REF = "github:leofioresein/notebooklm-mcp#main";
const HOME = homedir();

// ---- args ----
const argv = process.argv.slice(2);
const useRemote = argv.includes("--remote");
const requested = argv.filter((a) => !a.startsWith("-")).map((a) => a.toLowerCase());
const KNOWN = ["claude", "codex", "antigravity"];

// ---- helpers ----
const ok = (m) => console.log(`  ✅ ${m}`);
const info = (m) => console.log(`  ℹ️  ${m}`);
const warn = (m) => console.log(`  ⚠️  ${m}`);
const skip = (m) => console.log(`  ⏭️  ${m}`);

function backup(file) {
  if (existsSync(file)) copyFileSync(file, `${file}.bak`);
}

/** Build the local server if dist/index.js is missing, then return its path. */
function ensureLocalBuild() {
  const dist = join(HERE, "dist", "index.js");
  if (!existsSync(dist)) {
    info("dist/ not found — running `npm install` (installs deps + builds)…");
    execSync("npm install", { cwd: HERE, stdio: "inherit" });
  }
  if (!existsSync(dist)) throw new Error("Build failed: dist/index.js was not produced.");
  return dist.split("\\").join("/"); // forward slashes work on all OSes
}

/** The MCP server entry written into each client config. */
function serverEntry() {
  if (useRemote) return { command: "npx", args: ["-y", FORK_REF], env: {} };
  return { command: "node", args: [ensureLocalBuild()], env: {} };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

// ---- per-client writers ----

function installClaude(entry) {
  const file = join(HOME, ".claude.json");
  const cfg = existsSync(file) ? readJson(file) : {};
  cfg.mcpServers ??= {};
  cfg.mcpServers[SERVER_NAME] = entry;
  backup(file);
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  ok(`Claude Code → ${file}`);
}

function installAntigravity(entry) {
  const dir = join(HOME, ".gemini", "antigravity");
  const file = join(dir, "mcp_config.json");
  mkdirSync(dir, { recursive: true });
  const cfg = existsSync(file) ? readJson(file) : {};
  cfg.mcpServers ??= {};
  cfg.mcpServers[SERVER_NAME] = entry;
  backup(file);
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  ok(`Gemini Antigravity → ${file}`);
}

function tomlString(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function installCodex(entry) {
  const dir = join(HOME, ".codex");
  const file = join(dir, "config.toml");
  mkdirSync(dir, { recursive: true });
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const header = `[mcp_servers.${SERVER_NAME}]`;
  if (existing.includes(header)) {
    warn(`Codex already has [${`mcp_servers.${SERVER_NAME}`}] — left untouched. Edit ${file} by hand if needed.`);
    return;
  }
  const lines = [
    header,
    `command = ${tomlString(entry.command)}`,
    `args = [${entry.args.map(tomlString).join(", ")}]`,
  ];
  const envKeys = Object.keys(entry.env ?? {});
  if (envKeys.length) {
    const inline = envKeys.map((k) => `${k} = ${tomlString(entry.env[k])}`).join(", ");
    lines.push(`env = { ${inline} }`);
  }
  const block = lines.join("\n");
  const next = existing.trimEnd() ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
  backup(file);
  writeFileSync(file, next);
  ok(`Codex → ${file}`);
}

// ---- detection (used when no explicit target / "all" is given) ----
const detect = {
  claude: () => existsSync(join(HOME, ".claude.json")) || existsSync(join(HOME, ".claude")),
  codex: () => existsSync(join(HOME, ".codex")),
  antigravity: () => existsSync(join(HOME, ".gemini")),
};

// ---- main ----
const installers = {
  claude: installClaude,
  codex: installCodex,
  antigravity: installAntigravity,
};

const bad = requested.filter((t) => t !== "all" && !KNOWN.includes(t));
if (bad.length) {
  console.error(`Unknown target(s): ${bad.join(", ")}. Valid: ${KNOWN.join(", ")}, all.`);
  process.exit(1);
}

const forceAll = requested.includes("all");
const explicit = requested.filter((t) => KNOWN.includes(t));
const autodetect = requested.length === 0;

console.log(
  `\nnotebooklm-mcp installer — mode: ${useRemote ? "remote (npx github fork)" : "local build"}\n`,
);

const entry = serverEntry();
let count = 0;
for (const client of KNOWN) {
  const wanted = forceAll || explicit.includes(client) || (autodetect && detect[client]());
  if (!wanted) {
    if (autodetect) skip(`${client} not detected — skipped (run \`node install.mjs ${client}\` to force).`);
    continue;
  }
  installers[client](entry);
  count++;
}

if (count === 0) {
  warn("No clients configured. Pass a target explicitly, e.g. `node install.mjs claude`.");
  process.exit(0);
}

console.log("\nDone. Next steps:");
console.log("  1. Restart the client(s) above so they pick up the new MCP config.");
console.log("  2. Run the MCP tool `setup_auth` once to log into Google (cookies persist locally).");
console.log("  3. Test with an `add_source` of any URL — expect `success: true`.\n");
