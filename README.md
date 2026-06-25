# Git Scraper

Price tracker pessoal por intencao de compra, com busca em lojas suportadas, ranking de ofertas, persistencia em JSON no proprio repositorio, dashboard estatico em GitHub Pages e gestao de catalogo via GitHub Issue.

## O que este projeto faz

- Monitora intencoes de compra cadastradas em `data/products.json`.
- Pesquisa essas intencoes nas lojas suportadas e descobre as URLs das ofertas durante a execucao.
- Usa Lightpanda via CDP como engine principal e Chromium/Playwright local como fallback tecnico.
- Ranqueia ofertas por restricoes obrigatorias, prioridades e preco total ou preco unitario.
- Persiste snapshots e erros em `data/` e espelha os JSONs para `docs/data/`.
- Publica um dashboard estatico sem backend em `docs/`.
- Permite adicionar, editar e remover intencoes via GitHub Issue.

## Matriz de suporte atual

| Loja | Nivel | Validacao atual |
| --- | --- | --- |
| Amazon | Dedicated validated | Adapter de busca + smoke real |
| KaBuM | Dedicated validated | Adapter de busca + smoke real |
| Mercado Livre | Dedicated validated | Adapter de busca + smoke real |
| Magalu | Dedicated validated | Adapter de busca + smoke real |
| Shopee | Dedicated validated | Adapter de busca + smoke real |
| Pichau | Dedicated validated | Adapter de busca + smoke real |
| Petz | Dedicated validated | Adapter de busca + smoke real |

`Dedicated validated` significa que a loja possui adapter de busca em `src/search/store_adapters.js`, fixture deterministica e smoke real habilitado.

Detalhes operacionais e criterio de aceite por loja:

- `docs/matriz-suporte.md`

## Como funciona

### Catalogo

As intencoes ativas ficam em `data/products.json` e sao espelhadas em `docs/data/products.json`.

Campos suportados por intencao:

- `id`
- `name`
- `characteristics`
- `category`
- `stores`
- `required_terms`
- `preferred_terms`
- `excluded_terms`
- `required_attributes`
- `preferred_attributes`
- `unit_rule`
- `is_active`
- `notes`

Campos legados de cadastro por anuncio direto, como `url`, `selectors`, `units_per_package` e `mode: "url"`, sao rejeitados pelo schema e pela ingestao.

### Pipeline de scraping

Fluxo atual:

1. monta a query com `name + characteristics`;
2. cria a URL de busca por loja;
3. conecta no Lightpanda via `LIGHTPANDA_CDP_URL`;
4. extrai ofertas da pagina de busca;
5. usa Chromium/Playwright local como fallback quando Lightpanda falha;
6. normaliza atributos encontrados no titulo;
7. rejeita ofertas sem titulo, preco ou URL descoberta;
8. aplica `required_terms`, `required_attributes` e `excluded_terms`;
9. ordena por prioridade e depois por `unit_price` ou preco total.

Exemplos de modelagem:

- RAM DDR4: `required_attributes.memory_type = "ddr4"`, capacidade em `preferred_attributes.capacity_total_gb`, velocidade sem regra obrigatoria.
- Fralda tamanho G: `required_attributes.size = "G"` e `unit_rule.basis = "unit"` para comparar preco por unidade do pacote.

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

`latest.items` guarda a melhor oferta por intencao. `latest.offers` guarda as top ofertas por loja. URLs aparecem apenas nessas ofertas descobertas.

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
- `npm run test:unit`: parser, heuristicas, falhas, schema, ingest, adapters de busca, ranking e smoke
- `npm run test:fixtures`: extracao legada e regressao por loja com fixtures deterministicas
- `npm run test:integration`: pipeline de busca, persistencia, manifesto e continuidade de dados
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
- inicializacao do Lightpanda via Docker
- `npm run smoke:real`

O smoke real nao bloqueia PR. Ele gera `.cache/smoke-real/summary.json` e publica artifacts para analise quando ha drift real de DOM, captcha ou bloqueio.

### Daily scrape

Workflow: `.github/workflows/scrape.yml`

Executa:

- `npm ci`
- `npm run test:ci`
- instalacao do Chromium do Playwright
- inicializacao do Lightpanda via Docker
- `npm run scrape`
- commit de `data/` e `docs/data/`
- upload de artifacts de debug quando ha falha

Para endurecer merge em producao, configure branch protection no GitHub para exigir sucesso do job `ci`.

### Ingest de Issue

Workflow: `.github/workflows/ingest_issue.yml` (`Ingest Product Issues`)

Processa Issues para `add`, `edit`, `remove` e `batch`, valida o payload e atualiza o catalogo espelhado.

Executa automaticamente em `opened`, `edited`, `labeled` e `reopened`, e tambem aceita `workflow_dispatch` para replay manual do backlog.

Replay manual:

- abra `Actions > Ingest Product Issues > Run workflow`
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
- `LIGHTPANDA_CDP_URL`
- `SEARCH_TOP_N_PER_STORE`

`LIGHTPANDA_CDP_URL` usa `ws://127.0.0.1:9222` por padrao. O Chromium local e apenas fallback tecnico quando a conexao CDP ou a navegacao pelo Lightpanda falhar.

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
|   |-- config/
|   |-- engines/
|   |-- extract/
|   |-- io/
|   |-- schema/
|   |-- search/
|   `-- utils/
`-- test/
```
