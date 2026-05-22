# Fork fix — `add_source` voltou a funcionar (issue #46)

> Este é um **fork** de [`PleasePrompto/notebooklm-mcp`](https://github.com/PleasePrompto/notebooklm-mcp) (MIT)
> com o `add_source` corrigido. Em `v2.0.0` do upstream, adicionar fontes falha com
> `Could not open the "Add source" dialog`. Chat (`ask_question`), `setup_auth`,
> `list_notebooks` etc. sempre funcionaram — só a ingestão de fontes estava quebrada.

## O bug

| Item | Detalhe |
|---|---|
| Upstream | `notebooklm-mcp` v2.0.0 — https://github.com/PleasePrompto/notebooklm-mcp |
| Sintoma | `add_source` → `{ success:false, sourceCountBefore:0, message:'Could not open the "Add source" dialog' }` |
| Issue | [#46](https://github.com/PleasePrompto/notebooklm-mcp/issues/46) |

### Causa-raiz (duas falhas combinadas)

1. **Seletor genérico demais (principal).** Para detectar o modal de fontes, o código
   espera `page.locator('[role="dialog"]').first()` ficar *visível*. Mas o NotebookLM
   mantém **um `[role="dialog"]` oculto permanente no DOM — o teclado de emojis**
   (`<div role="dialog" class="emoji-keyboard__container">`). O `.first()` casa com esse
   elemento oculto, que nunca fica visível → `waitFor({state:'visible'})` estoura → cai no
   fallback morto `?addSource=true` → erro. O modal real é
   `mat-dialog-container[role="dialog"]` **com a classe `.mdc-dialog`**.

2. **Corrida de carregamento (secundária).** O `init()`/`waitForNotebookLMReady()` só espera
   o *chat input* (`textarea.query-box-input`), que aparece já no zero-state
   **"Loading Notebook…"**, antes do painel de fontes hidratar. Então o `add_source` pode
   disparar antes do botão `.add-source-button` existir.

> ⚠️ **Não é problema de idioma.** O navegador roda `locale:"en-US"`; o idioma da UI segue a
> conta Google. O ponto de falha (`openAddSourceOverlay`) nem usa texto.

## O fix (aplicado neste fork)

### 1. `src/notebooklm/selectors.ts` — mira o diálogo Material real

```diff
-    overlayPane: '[role="dialog"]',
-    overlayInput: '[role="dialog"] input[type="text"]:not([readonly])',
-    overlayTextarea: '[role="dialog"] textarea',
+    overlayPane: '[role="dialog"].mdc-dialog',
+    overlayInput: '[role="dialog"].mdc-dialog input[type="text"]:not([readonly])',
+    overlayTextarea: '[role="dialog"].mdc-dialog textarea',
```

Adicionar `.mdc-dialog` exclui o diálogo oculto de emojis (que não tem essa classe),
mantendo o seletor como string única.

### 2. `src/notebooklm/sources.ts` — espera o painel de fontes carregar

Em `openAddSourceOverlay`, logo após o early-return de `isOverlayVisible`, espera o
`.add-source-button` ficar visível (até 45s) antes de clicar, e sobe o timeout do clique de
5s → 15s.

### 3. `package.json` — `postbuild` multiplataforma

```diff
-    "postbuild": "chmod +x dist/index.js",
+    "postbuild": "node -e \"try{require('fs').chmodSync('dist/index.js',0o755)}catch(e){}\"",
```

O `chmod` não existe no Windows e quebrava o build via `npx`/`prepare` na máquina de quem
instala o fork direto do git. A versão em Node faz o mesmo de forma portável.

## Bypass manual (plano B)

Se você não quiser/poder rodar o MCP patchado, o script [`nlm-add-sources.mjs`](nlm-add-sources.mjs)
adiciona várias URLs de uma vez dirigindo o Patchright sobre o **perfil persistente** do MCP
(o mesmo já logado pelo `setup_auth`). Uso:

```bash
# FECHE o Chrome do MCP antes. patchright precisa estar instalado.
node docs/nlm-add-sources.mjs <NOTEBOOK_URL> urls.txt   # urls.txt = 1 URL por linha
```

## Contribuir de volta (opcional)

O fix é pequeno e a licença é MIT — vale abrir um **PR** no upstream referenciando a
[#46](https://github.com/PleasePrompto/notebooklm-mcp/issues/46): a troca de seletor
`[role="dialog"]` → `[role="dialog"].mdc-dialog` e a espera pelo `.add-source-button`. Se
aceito e publicado, dá pra voltar a usar `notebooklm-mcp@latest` sem manter o fork.

---

*Fix validado contra `notebooklm-mcp@2.0.0` na UI atual do NotebookLM (2026-05).*
