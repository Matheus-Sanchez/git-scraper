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
- Espelho para GitHub Pages: `docs/data/*` (sincronizado automaticamente pelo scraper/ingest)
- Dashboard: `docs/` (estatico, sem API)
- Add-product sem backend: formulario do site abre Issue; workflow ingere uma acao unica ou lote e atualiza `data/products.json` + `docs/data/products.json`.

## Requisitos

- Node.js 20+
- npm 10+

## Setup local

1. Instale dependencias:

```bash
npm ci
```

No PowerShell do Windows, se houver bloqueio de `npm`/`npx`:

```powershell
npm.cmd ci
```

2. Copie e ajuste variaveis:

```bash
cp .env.example .env
```

3. Instale Chromium do Playwright:

```bash
npx playwright install --with-deps chromium
```

No PowerShell do Windows:

```powershell
npx.cmd playwright install chromium
```

4. Rode scraping local:

```bash
npm run scrape
```

No PowerShell do Windows:

```powershell
npm.cmd run scrape
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
  - commit/push de mudancas em `data/` e `docs/data/`

Permissao necessaria do workflow:

- `contents: write`

### 2) Ingest de Issue (`.github/workflows/ingest_issue.yml`)

- Trigger: issue `opened`
- Processa apenas quando:
  - label `add-product` ou `manage-product`, ou
  - titulo com prefixo `[ADD PRODUCT]` ou `[MANAGE PRODUCT]`
- Script: `.github/scripts/ingest_issue.mjs`
- Resultado:
  - valida payload
  - suporta `action: add|edit|remove|batch`
  - evita duplicidade por URL normalizada
  - atualiza `data/products.json` e `docs/data/products.json`
  - comenta e fecha issue

Permissoes necessarias:

- `contents: write`
- `issues: write`

## Configurar GitHub Pages

1. No repositorio, abra `Settings` -> `Pages`.
2. Em `Build and deployment`, selecione:
   - `Source`: `Deploy from a branch`
   - `Branch`: `main`
   - `Folder`: `/docs`
3. Salve.
4. A pagina sera publicada em `https://<owner>.github.io/<repo>/`.

## Fluxo para adicionar produto pelo site

1. Abra o dashboard em `/`.
2. Clique em `Adicionar Produto`.
3. Preencha formulario e envie.
4. Se quiser comparar o mesmo produto em lojas diferentes, use o mesmo `comparison_key`.
5. O site abre a tela de nova issue no GitHub ja preenchida.
6. Confirme envio da issue.
7. O workflow `ingest_issue.yml` valida e adiciona no `data/products.json` e `docs/data/products.json`.

O parser aceita:

- Bloco ` ```json ... ``` ` no corpo da issue (preferencial)
- Campos do Issue Form (`.github/ISSUE_TEMPLATE/add-product.yml`)
- Acao de gerenciamento por issue (`add`, `edit`, `remove`) com label `manage-product` e titulo `[MANAGE PRODUCT]`

## Campos do formulario (Adicionar Produto)

- `Nome`: obrigatorio. Nome exibido no dashboard e snapshots.
- `URL`: obrigatorio. URL HTTP/HTTPS da pagina do produto.
- `Categoria`: opcional, mas recomendado para filtros e agrupamento.
- `Grupo de comparacao`: opcional. Use o mesmo valor para relacionar o mesmo produto em lojas diferentes.
- `Unidades por pacote`: opcional (`> 0`). Usado para calcular `unit_price`.
- `Ativo`: se `false`, o produto fica cadastrado mas nao entra no scraping.
- `Repositorio (owner/repo)`: obrigatorio para abrir a issue no repositorio correto.
- `Seletores CSS` (um por linha): opcional. Ajuda em paginas com HTML dificil.
- `JSON-LD paths` (um por linha): opcional. Preferencial para extracao estavel.
- `Regex hints` (um por linha): opcional. Ultimo fallback.
- `Observacoes`: opcional. Campo livre para contexto humano.

### Exemplo de payload gerado pelo formulario

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

## Checklist rapido: validar novo produto ponta a ponta

1. Rode scraping local:

```powershell
npm.cmd run scrape
```

2. Confirme arquivos gerados/atualizados:
   - `data/latest.json`
   - `data/runs/YYYY-MM-DD.json`
   - `data/errors/YYYY-MM-DD.json`
   - `docs/data/latest.json`
   - `docs/data/runs/YYYY-MM-DD.json`

3. Suba servidor estatico local:

```powershell
npx.cmd http-server -p 5500 .
```

4. Abra:
   - Dashboard: `http://localhost:5500/docs/`
   - Gestao: `http://localhost:5500/docs/manage.html`

5. Crie um produto via UI (abre issue), confirme envio no GitHub e aguarde workflow.
6. Rode `git pull` local para trazer as alteracoes em `data/products.json` e `docs/data/products.json`.
7. Rode `npm.cmd run scrape` novamente e atualize a tela.

## Por que pode falhar em testes locais

- `npm test` valida funcoes unitarias, nao garante scraping real de sites externos.
- Se `npx` falhar no PowerShell, use `npx.cmd` (politica de execucao do Windows).
- Se Chromium nao estiver instalado, engine2/engine3 falham com `Executable doesn't exist`.
- Alguns sites retornam `403/404` por bloqueio anti-bot, geolocalizacao ou URL expirada.
- Abrir HTML com `file://` pode bloquear `fetch`; use servidor local (`http://localhost:5500`).
- Fluxo add/edit/remove via UI abre issue; alteracao real ocorre no workflow remoto, depois exige `git pull`.

## Estrutura de dados

### `data/products.json`

Cada item suporta:

- `id`
- `url`
- `name`
- `category` (opcional)
- `comparison_key` (opcional)
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
