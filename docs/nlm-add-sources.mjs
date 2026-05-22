// nlm-add-sources.mjs — adiciona várias fontes (Sites/URLs) a um notebook do
// NotebookLM dirigindo o Patchright sobre o PERFIL persistente do notebooklm-mcp.
//
// Quando usar: BYPASS para quando o `add_source` do MCP estiver quebrado. Se você
// já aplicou o fix no MCP (seletor `[role="dialog"].mdc-dialog`), prefira o
// `add_source` normal — este script é o plano B.
//
// PRÉ-REQUISITOS
//   - Rodou `setup_auth` do notebooklm-mcp pelo menos 1x (perfil já logado no Google).
//   - FECHE o Chrome do MCP antes de rodar (o perfil não pode estar em uso por 2 processos).
//   - patchright instalado + Chromium baixado:  npm i patchright && npx patchright install chromium
//
// USO
//   node nlm-add-sources.mjs <NOTEBOOK_URL> <urls.txt>
//     urls.txt = uma URL por linha
//   ou via env:  NOTEBOOK_URL=... URLS_FILE=urls.txt node nlm-add-sources.mjs
//
// CONFIG OPCIONAL (env)
//   PATCHRIGHT_PATH  caminho do index.js do patchright, se a auto-resolução falhar
//   MCP_PROFILE      caminho do chrome_profile (default por SO, ver defaultProfile())

import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ---- args / config ----
const NOTEBOOK_URL = process.argv[2] ?? process.env.NOTEBOOK_URL;
const URLS_FILE = process.argv[3] ?? process.env.URLS_FILE;
if (!NOTEBOOK_URL || !URLS_FILE) {
  console.error('Uso: node nlm-add-sources.mjs <NOTEBOOK_URL> <urls.txt>');
  process.exit(1);
}
const URLS = readFileSync(URLS_FILE, 'utf8')
  .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
if (!URLS.length) { console.error('Nenhuma URL encontrada em', URLS_FILE); process.exit(1); }

function defaultProfile() {
  if (process.platform === 'win32')
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'notebooklm-mcp', 'Data', 'chrome_profile');
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support',
      'notebooklm-mcp', 'Data', 'chrome_profile');
  return join(homedir(), '.config', 'notebooklm-mcp', 'Data', 'chrome_profile');
}
const PROFILE = process.env.MCP_PROFILE ?? defaultProfile();

function resolvePatchright() {
  if (process.env.PATCHRIGHT_PATH) return process.env.PATCHRIGHT_PATH;
  try { return require.resolve('patchright'); } catch { /* fall through */ }
  throw new Error(
    'patchright não encontrado. Rode "npm i patchright && npx patchright install chromium" ' +
    'na pasta atual, ou defina PATCHRIGHT_PATH.');
}
const PATCHRIGHT = resolvePatchright();

const pw = await import(pathToFileURL(PATCHRIGHT).href);
const chromium = pw.chromium ?? pw.default?.chromium;
const log = (...a) => console.log(...a);
const count = (page) => page.locator('.single-source-container').count();

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
});

try {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(NOTEBOOK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  log('Aguardando o notebook carregar...');
  await page.locator('button.add-source-button').first().waitFor({ state: 'visible', timeout: 60000 });
  const before = await count(page);
  log('Fontes antes:', before);

  await page.locator('button.add-source-button').first().click();
  const dialog = page.locator('mat-dialog-container[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  log('Modal aberto.');

  // "Sites" (pt-BR) — ajuste o texto se sua UI estiver em outro idioma.
  await dialog.locator('button.drop-zone-icon-button', { hasText: 'Sites' }).first().click();
  log('Cliquei em Sites.');

  const ta = page.locator(
    'textarea[aria-label="Insira os URLs"], textarea[placeholder="Cole os links"], textarea').first();
  await ta.waitFor({ state: 'visible', timeout: 15000 });
  await ta.click();
  await ta.fill(URLS.join('\n'));
  log('URLs coladas:', URLS.length);
  await page.waitForTimeout(800);

  const insert = page.locator(
    'mat-dialog-container button.mat-mdc-unelevated-button:has-text("Inserir"), ' +
    'mat-dialog-container button:has-text("Inserir")').first();
  await insert.waitFor({ state: 'visible', timeout: 10000 });
  for (let i = 0; i < 30 && await insert.isDisabled().catch(() => true); i++) await page.waitForTimeout(500);
  await insert.click();
  log('Cliquei em Inserir. Aguardando importação...');

  await dialog.waitFor({ state: 'hidden', timeout: 60000 }).catch(() => log('(modal não fechou em 60s)'));
  const target = before + URLS.length;
  const deadline = Date.now() + 240000;
  let cur = before;
  while (Date.now() < deadline) {
    cur = await count(page);
    log('  ...fontes agora:', cur);
    if (cur >= target) break;
    await page.waitForTimeout(5000);
  }
  log('RESULTADO: antes=%d depois=%d (esperado=%d)', before, cur, target);
  await page.screenshot({ path: join(process.cwd(), 'nlm_after_add.png') }).catch(() => {});
  log('DONE');
} catch (e) {
  console.log('ERROR:', e && e.message ? e.message : String(e));
} finally {
  await ctx.close().catch(() => {});
}
