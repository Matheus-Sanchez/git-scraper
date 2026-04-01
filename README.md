# Git Scraper

Price tracker pessoal com scraping em cascata, persistencia em JSON no proprio repositorio, dashboard estatico em GitHub Pages e gestao de catalogo via GitHub Issue.

## O que este projeto faz

- Monitora produtos cadastrados em `data/products.json`.
- Usa tres engines em cascata para maximizar a chance de extracao.
- Persiste snapshots e erros em `data/` e espelha os JSONs para `docs/data/`.
- Publica um dashboard estatico sem backend em `docs/`.
- Permite adicionar, editar e remover produtos via GitHub Issue.

## Matriz de suporte atual

| Loja | Nivel | Validacao atual |
| --- | --- | --- |
| Amazon | Dedicated validated | Regressao por dominio + smoke real |
| KaBuM | Dedicated validated | Regressao por dominio + smoke real |
| Mercado Livre | Backlog | Ainda sem adapter dedicado validado |
| Magalu | Backlog | Ainda sem adapter dedicado validado |
| Shopee | Backlog | Ainda sem adapter dedicado validado |
| Pichau | Backlog | Ainda sem adapter dedicado validado |
| Petz | Backlog | Ainda sem adapter dedicado validado |
| Outros dominios | Generic unvalidated | Sem suporte validado por regressao |

`Adapter dedicado e validado` significa que o dominio possui roteamento explicito em `src/adapters/` e casos de regressao na suite.

`Fallback generico` significa apenas tentativa heuristica via `genericAdapter`, sem compromisso de suporte estavel.

Detalhes operacionais e criterio de aceite por loja:

- `docs/matriz-suporte.md`

## Como funciona

### Catalogo

Os produtos ativos ficam em `data/products.json` e sao espelhados em `docs/data/products.json`.

Campos suportados por produto:

- `id`
- `name`
- `url`
- `category`
- `comparison_key`
- `units_per_package`
- `is_active`
- `selectors.price_css`
- `selectors.jsonld_paths`
- `selectors.regex_hints`
- `notes`

### Pipeline de scraping

Ordem atual de execucao:

1. `engine1_http`
2. `engine2_browser`
3. `engine3_hardmode`

Produtos Amazon ainda podem usar a Amazon PA-API antes do fallback HTML/browser quando as credenciais estao configuradas.

### Persistencia

Cada execucao gera:

- `data/latest.json`
- `data/runs/<run_id>.json`
- `data/errors/<run_id>.json`
- `data/runs/index.json`
- `docs/data/*` como espelho para o dashboard

O manifesto `data/runs/index.json` mantem:

- `files` para compatibilidade com formato legado
- `runs` com metadados detalhados
- `daily` para drilldown diario no dashboard

## Testes e qualidade

Comandos principais:

```bash
npm run lint
npm run validate:catalog
npm run test:unit
npm run test:fixtures
npm run test:integration
npm run test:coverage:critical
npm run test:ci
npm run smoke:real
npm test
```

Significado:

- `npm run lint`: valida `src/`, `test/`, `.github/scripts/` e `scripts/`
- `npm run validate:catalog`: valida `data/products.json` com o schema do catalogo
- `npm run test:unit`: parser, heuristicas, falhas, schema, ingest e provider Amazon
- `npm run test:fixtures`: extracao e regressao por dominio com fixtures deterministicas
- `npm run test:integration`: pipeline, persistencia, manifesto e continuidade de dados
- `npm run test:coverage:critical`: piso minimo de cobertura por area critica
- `npm run test:ci`: suite oficial de pre-commit e CI
- `npm run smoke:real`: smoke real para lojas suportadas, com artifactos em `.cache/smoke-real/`
- `npm test`: suite completa via `node --test`

Documentacao complementar:

- Arquitetura detalhada: `docs/arquitetura.md`
- Estrategia de testes: `docs/testes-software.md`
- Matriz de suporte: `docs/matriz-suporte.md`

## GitHub Actions

### CI

Workflow: `.github/workflows/ci.yml`

Executa em `push` e `pull_request`:

- `npm ci`
- `npm run test:ci`

Esse workflow ignora mudancas apenas em `data/**` e `docs/data/**`, evitando revalidacao desnecessaria quando o scrape agendado comita snapshots.

### Smoke real

Workflow: `.github/workflows/smoke_real.yml`

Executa em `workflow_dispatch` e `schedule`:

- `npm ci`
- instalacao do Chromium do Playwright
- `npm run smoke:real`

O smoke real nao bloqueia PR. Ele gera `.cache/smoke-real/summary.json` e publica artifacts para analise quando ha drift real de DOM, captcha ou bloqueio.

### Daily scrape

Workflow: `.github/workflows/scrape.yml`

Executa:

- `npm ci`
- `npm run test:ci`
- instalacao do Chromium do Playwright
- `npm run scrape`
- commit de `data/` e `docs/data/`
- upload de artifacts de debug quando ha falha

Para endurecer merge em producao, configure branch protection no GitHub para exigir sucesso do job `ci`.

### Ingest de Issue

Workflow: `.github/workflows/ingest_issue.yml`

Processa Issues para `add`, `edit`, `remove` e `batch`, valida o payload e atualiza o catalogo espelhado.

Executa automaticamente em `opened`, `edited`, `labeled` e `reopened`, e tambem aceita `workflow_dispatch` para replay manual do backlog.

Replay manual:

- abra `Actions > Ingest Add-Product Issue > Run workflow`
- opcionalmente informe `issue_numbers` como lista separada por virgula
- se `issue_numbers` ficar vazio, o workflow processa todas as Issues abertas com label `add-product` ou `manage-product`, ou titulo iniciado por `[ADD PRODUCT]` / `[MANAGE PRODUCT]`

## Como rodar localmente

### Requisitos

- Node.js 22+
- npm 10+

### Windows PowerShell

```powershell
Copy-Item .env.example .env
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd run test:ci
npm.cmd run smoke:real
npm.cmd run scrape
npx.cmd http-server -p 5500 .
```

### macOS/Linux

```bash
cp .env.example .env
npm ci
npx playwright install chromium
npm run test:ci
npm run smoke:real
npm run scrape
npx http-server -p 5500 .
```

Endpoints locais:

- Dashboard: `http://localhost:5500/docs/`
- Gestao: `http://localhost:5500/docs/manage.html`

## Variaveis de ambiente

Copie `.env.example` para `.env` e preencha apenas as credenciais que voce realmente usa.

- `DEBUG`
- `HTTP_TIMEOUT_MS`
- `CONCURRENCY`
- `USER_AGENT`
- `PROXY_URL`
- `SCRAPING_API_KEY`
- `AMAZON_PAAPI_ACCESS_KEY`
- `AMAZON_PAAPI_SECRET_KEY`
- `AMAZON_PAAPI_PARTNER_TAG`

Sem `SCRAPING_API_KEY`, o hardmode continua apenas com recursos locais.

Sem `AMAZON_PAAPI_*`, produtos Amazon continuam tentando HTML/browser normalmente.

## Estrutura resumida

```text
.
|-- .github/
|   |-- scripts/
|   `-- workflows/
|-- data/
|   |-- errors/
|   |-- runs/
|   |-- latest.json
|   `-- products.json
|-- docs/
|   |-- data/
|   |-- app.js
|   |-- index.html
|   `-- manage.html
|-- scripts/
|-- src/
|   |-- adapters/
|   |-- config/
|   |-- engines/
|   |-- extract/
|   |-- io/
|   |-- schema/
|   `-- utils/
`-- test/
```
