# Git Scraper

Price tracker pessoal com scraping em cascata, persistencia em JSON no proprio repositorio, dashboard estatico em GitHub Pages e gestao de catalogo via GitHub Issue.

## Descricao sugerida para o repositorio

`Static price tracker with GitHub Actions, GitHub Pages dashboard, multi-engine scraping, and issue-driven product management.`

<<<<<<< ours
## Topics sugeridos

`price-tracker`, `web-scraping`, `github-actions`, `github-pages`, `playwright`, `nodejs`, `dashboard`, `automation`, `json`, `monitoring`, `ecommerce`

## Preview

Use esta secao para deixar o repositorio mais apresentavel no GitHub. Os blocos abaixo ja estao separados por contexto para voce substituir pelas capturas reais.

### 1. Dashboard principal

> Coloque aqui uma imagem com a visao geral do dashboard.
> Sugestao de caminho: `docs/assets/readme/dashboard-overview.png`

<!--
![Dashboard principal](docs/assets/readme/dashboard-overview.png)
-->

### 2. Historico de precos com drilldown

> Coloque aqui uma imagem mostrando o grafico principal, filtros e o detalhe por run.
> Sugestao de caminho: `docs/assets/readme/history-drilldown.png`

<!--
![Historico com drilldown](docs/assets/readme/history-drilldown.png)
-->

### 3. Fluxo de cadastro via Issue

> Coloque aqui uma imagem ou GIF com o formulario abrindo a Issue no GitHub.
> Sugestao de caminho: `docs/assets/readme/add-product-flow.gif`

<!--
![Fluxo de cadastro via Issue](docs/assets/readme/add-product-flow.gif)
-->

## O que este projeto faz

- Monitora precos de produtos cadastrados em `data/products.json`.
- Usa tres engines em cascata para maximizar a chance de extracao.
- Mantem snapshots historicos versionados no proprio Git.
- Publica um dashboard estatico sem backend e sem banco.
- Permite adicionar, editar ou remover produtos via GitHub Issue.
- Gera manifestos de run com `run_id` unico, historico diario e metadados de falha.

## Como funciona

### 1. Catalogo de produtos

Os produtos ativos ficam em `data/products.json` e sao espelhados em `docs/data/products.json` para o dashboard.

Cada produto pode ter:

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

### 2. Pipeline de scraping

Quando o scraper roda, ele tenta extrair preco nesta ordem:

1. `engine1_http`
   Usa `axios` + `cheerio`, com retry curto e classificacao estruturada de erro.
2. `engine2_browser`
   Usa Playwright em modo browser leve quando o HTML puro nao foi suficiente.
3. `engine3_hardmode`
   Usa Playwright com estrategia mais agressiva, proxy opcional, trace e fallback externo opcional.

### 3. Persistencia de resultados

Cada execucao gera um `run_id` unico, por exemplo:

```text
2026-03-14T09-50-43-123Z
```

Arquivos principais gerados:

- `data/latest.json`
- `data/runs/<run_id>.json`
- `data/errors/<run_id>.json`
- `data/runs/index.json`
- `docs/data/*` como espelho para o GitHub Pages

O manifesto `data/runs/index.json` mantem:

- `files`: compatibilidade com o formato antigo
- `runs`: lista detalhada das execucoes
- `daily`: agrupamento diario para o dashboard

### 4. Dashboard estatico

O frontend fica em `docs/` e consome apenas JSON estatico. Nao existe API, backend ou banco.

O dashboard mostra:

- resumo do ultimo snapshot
- distribuicao por categoria
- historico de precos por produto, grupo ou categoria
- detalhe por dia com drilldown de runs
- classificacao de falhas e sinais operacionais

### 5. Gestao via GitHub Issue

O formulario do dashboard abre uma Issue no GitHub com payload JSON. O workflow de ingestao valida, aplica a mudanca e atualiza:

- `data/products.json`
- `docs/data/products.json`

O fluxo aceita `add`, `edit`, `remove` e `batch`.

## Arquitetura resumida

```text
data/products.json
        |
        v
src/scrape.js
        |
        +--> engine1_http
        +--> engine2_browser
        +--> engine3_hardmode
        |
        v
data/latest.json
data/runs/<run_id>.json
data/errors/<run_id>.json
data/runs/index.json
        |
        v
docs/data/*
        |
        v
docs/ (dashboard estatico em GitHub Pages)
```

## Como rodar localmente

### Requisitos
=======
## Documentacao complementar

- Arquitetura detalhada: `docs/arquitetura.md`
- Estrategia e execucao de testes (caixa preta e caixa branca): `docs/testes-software.md`

## Documentacao complementar

- Arquitetura detalhada: `docs/arquitetura.md`
- Estrategia e execucao de testes (caixa preta e caixa branca): `docs/testes-software.md`

## Requisitos
>>>>>>> theirs

- Node.js 20+
- npm 10+

### Setup rapido no Windows PowerShell

1. Instale dependencias:

```powershell
npm.cmd ci
```

2. Instale o Chromium do Playwright:

```powershell
npx.cmd playwright install chromium
```

3. Opcionalmente, crie um `.env` a partir do exemplo:

```powershell
Copy-Item .env.example .env
```

4. Rode os testes:

```powershell
npm.cmd test
```

5. Rode o scraper:

```powershell
npm.cmd run scrape
```

6. Suba um servidor estatico local para visualizar o dashboard:

```powershell
npx.cmd http-server -p 5500 .
```

7. Abra no navegador:

- Dashboard: `http://localhost:5500/docs/`
- Gestao: `http://localhost:5500/docs/manage.html`

### Setup rapido no macOS/Linux

1. Instale dependencias:

```bash
npm ci
```

2. Instale o Chromium do Playwright:

```bash
npx playwright install chromium
```

3. Opcionalmente, crie o `.env`:

```bash
cp .env.example .env
```

4. Rode testes:

```bash
npm test
```

5. Rode o scraper:

```bash
npm run scrape
```

6. Suba um servidor estatico:

```bash
npx http-server -p 5500 .
```

7. Abra:

- Dashboard: `http://localhost:5500/docs/`
- Gestao: `http://localhost:5500/docs/manage.html`

## Comandos principais

```bash
npm run scrape
npm run dev
npm test
```

Resumo:

- `npm run scrape`: executa o pipeline completo de scraping
- `npm run dev`: roda o scraper com `DEBUG=1`
- `npm test`: roda testes unitarios, fixtures e smoke tests locais

## Variaveis de ambiente

- `DEBUG`
  `0` ou `1`. Quando ativo, aumenta a verbosidade e habilita mais evidencias de debug no hardmode.
- `HTTP_TIMEOUT_MS`
  Timeout base das requisicoes HTTP e navegacoes.
- `CONCURRENCY`
  Limite de paralelismo do scraper. O projeto faz clamp entre `1` e `5`.
- `USER_AGENT`
  User agent customizado para requests e browser automation.
- `PROXY_URL`
  Proxy opcional para o hardmode.
- `SCRAPING_API_KEY`
  Chave opcional para fallback externo no `engine3_hardmode`.

Sem `SCRAPING_API_KEY`, o sistema continua funcionando apenas com engines locais.

## GitHub Actions

### Daily scrape

Workflow: `.github/workflows/scrape.yml`

Faz:

- `npm ci`
- `npm test`
- instala Chromium do Playwright
- roda o scraper
- commita `data/` e `docs/data/`
- sobe artifacts de debug quando a execucao falha

Caracteristicas importantes:

- `concurrency` para evitar corrida entre execucoes
- `git pull --rebase` antes do push
- persistencia de `run_id` unico por execucao

### Ingest de Issue

Workflow: `.github/workflows/ingest_issue.yml`

Triggers:

- `opened`
- `edited`
- `labeled`
- `reopened`

Processa apenas Issues com:

- label `add-product`, ou
- label `manage-product`, ou
- titulo com prefixo `[ADD PRODUCT]`, ou
- titulo com prefixo `[MANAGE PRODUCT]`

Resultado:

- valida payload com schema
- aplica `add`, `edit`, `remove` ou `batch`
- evita duplicidade por URL normalizada
- commita mudancas no catalogo
- comenta a Issue com o status

## Como adicionar ou editar produtos

### Pela interface

1. Abra o dashboard em `docs/`.
2. Clique em `Adicionar Produto`.
3. Preencha os campos.
4. O formulario abre uma Issue no GitHub.
5. Envie a Issue.
6. O workflow de ingestao atualiza o catalogo.
7. Rode o scraper novamente para trazer os novos dados.

### Por JSON

Exemplo de payload:

```json
{
  "action": "add",
  "name": "Mouse Logitech G203 Lightsync",
  "url": "https://www.kabum.com.br/produto/166771/mouse-gamer-logitech-g203-lightsync-rgb-6-botoes-8000-dpi-preto-910-005793",
  "category": "perifericos",
  "comparison_key": "mouse-g203",
  "units_per_package": 1,
  "is_active": true,
  "selectors": {
    "price_css": [
      "[data-testid='price-current']",
      ".finalPrice"
    ],
    "jsonld_paths": [
      "offers.price",
      "price"
    ]
  },
  "notes": "Exemplo de cadastro"
}
```

## Estrutura de pastas

```text
.
|-- .github/
|   |-- workflows/
|   `-- scripts/
|-- data/
|   |-- errors/
|   |-- runs/
|   |-- latest.json
|   `-- products.json
|-- docs/
|   |-- data/
|   |-- app.js
|   |-- index.html
|   |-- manage.html
|   `-- style.css
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

## Checklist rapido para validar localmente

1. Rode:

```powershell
npm.cmd test
npm.cmd run scrape
```

2. Confirme se estes arquivos foram atualizados:

- `data/latest.json`
- `data/runs/index.json`
- `data/runs/<run_id>.json`
- `data/errors/<run_id>.json`
- `docs/data/latest.json`
- `docs/data/runs/index.json`

3. Abra o dashboard local em `http://localhost:5500/docs/`.

## Solucao de problemas

- `npx` ou `npm` bloqueado no PowerShell
  Use `npx.cmd` e `npm.cmd`.
- `Executable doesn't exist`
  O Chromium do Playwright nao foi instalado.
- `403`, `429` ou pagina vazia
  O site pode estar bloqueando scraping ou exigindo renderizacao/browser.
- Dashboard em branco via `file://`
  O frontend usa `fetch`; rode com servidor local.
- Produto foi enviado pela UI mas nao apareceu no catalogo
  A alteracao acontece no workflow remoto. Depois, rode `git pull`.

## Boas praticas e limitacoes

- Scraping de e-commerce pode quebrar com mudancas de HTML, CAPTCHA ou bloqueio por IP.
- Respeite ToS e regras dos sites monitorados.
- Prefira cadastrar seletores e `jsonld_paths` quando souber que a loja e sensivel.
- Mantenha a concorrencia controlada para nao piorar bloqueios.
- O dashboard e estatico por design; nao existe persistencia fora do Git.
