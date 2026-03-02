# Git Scraper: Price Tracker Pessoal

Scraper de precos sem backend/sem banco, com execucao diaria no GitHub Actions, persistencia em arquivos no proprio repositorio e dashboard estatico em GitHub Pages.  
Tambem permite adicionar produtos pelo site via GitHub Issue.

## Arquitetura

- Fonte de produtos: `data/products.json`
- Cascata de engines:
  - `engine1_http` (`axios` + `cheerio`)
  - `engine2_browser` (Playwright leve)
  - `engine3_hardmode` (Playwright agressivo + fallback opcional de provider externo)
- Saida:
  - `data/latest.json`
  - `data/runs/YYYY-MM-DD.json`
  - `data/errors/YYYY-MM-DD.json`
  - `data/runs/index.json`
- Dashboard: `web/` (estatico, sem API)
- Add-product sem backend: formulario do site abre Issue; workflow ingere e atualiza `data/products.json`.

## Requisitos

- Node.js 20+
- npm 10+

## Setup local

1. Instale dependencias:

```bash
npm ci
```

2. Copie e ajuste variaveis:

```bash
cp .env.example .env
```

3. Instale Chromium do Playwright:

```bash
npx playwright install --with-deps chromium
```

4. Rode scraping local:

```bash
npm run scrape
```

5. Modo debug:

```bash
npm run dev
```

6. Rode testes:

```bash
npm test
```

## Variaveis de ambiente

- `DEBUG`: `0` ou `1`
- `HTTP_TIMEOUT_MS`: timeout HTTP/base das navegacoes
- `CONCURRENCY`: limite de paralelo (clamp 1..5)
- `USER_AGENT`: user-agent custom
- `PROXY_URL`: proxy opcional para hard mode (`http(s)://...` ou `socks5://...`)
- `SCRAPING_API_KEY`: opcional para fallback externo no engine3 (ZenRows)

Sem `SCRAPING_API_KEY`, o sistema funciona apenas com engines locais.

## GitHub Actions

### 1) Scrape diario (`.github/workflows/scrape.yml`)

- Trigger: `schedule` diario + `workflow_dispatch`
- Fluxo:
  - `npm ci`
  - `npx playwright install --with-deps chromium`
  - `npm run scrape`
  - commit/push de mudancas em `data/`

Permissao necessaria do workflow:

- `contents: write`

### 2) Ingest de Issue (`.github/workflows/ingest_issue.yml`)

- Trigger: issue `opened`
- Processa apenas quando:
  - label `add-product`, ou
  - titulo com prefixo `[ADD PRODUCT]`
- Script: `.github/scripts/ingest_issue.mjs`
- Resultado:
  - valida payload
  - evita duplicidade por URL normalizada
  - atualiza `data/products.json`
  - comenta e fecha issue

Permissoes necessarias:

- `contents: write`
- `issues: write`

## Configurar GitHub Pages

1. No repositorio, abra `Settings` -> `Pages`.
2. Em `Build and deployment`, selecione:
   - `Source`: `Deploy from a branch`
   - `Branch`: `main`
   - `Folder`: `/(root)`
3. Salve.
4. A pagina sera publicada em `https://<owner>.github.io/<repo>/web/`.

## Fluxo para adicionar produto pelo site

1. Abra o dashboard em `/web/`.
2. Clique em `Adicionar Produto`.
3. Preencha formulario e envie.
4. O site abre a tela de nova issue no GitHub ja preenchida.
5. Confirme envio da issue.
6. O workflow `ingest_issue.yml` valida e adiciona no `data/products.json`.

O parser aceita:

- Bloco ` ```json ... ``` ` no corpo da issue (preferencial)
- Campos do Issue Form (`.github/ISSUE_TEMPLATE/add-product.yml`)

## Estrutura de dados

### `data/products.json`

Cada item suporta:

- `id`
- `url`
- `name`
- `category` (opcional)
- `units_per_package` (opcional, >0)
- `is_active`
- `selectors` (opcional):
  - `price_css`
  - `jsonld_paths`
  - `regex_hints`
- `notes` (opcional)

### Snapshot de sucesso por produto

- `product_id`, `url`, `name`
- `price`, `currency`
- `unit_price`
- `engine_used`
- `fetched_at`
- `source`
- `confidence`
- `status: "ok"`

## Boas praticas e limitacoes

- Scraping pode falhar por CAPTCHA, bloqueio por IP/datacenter, mudanca de HTML ou rate-limit.
- Respeite ToS e robots dos sites monitorados.
- Evite concorrencia alta desnecessaria; o padrao e 4.
- Use intervalos e lista de produtos razoavel.
- Para sites mais restritivos, considere `PROXY_URL` e/ou `SCRAPING_API_KEY`.

