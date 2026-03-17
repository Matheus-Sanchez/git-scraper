# Arquitetura do Git Scraper

Este documento descreve a arquitetura atual do projeto em visao de componentes, fluxo de dados e decisoes tecnicas.

## 1. Objetivo arquitetural

- Executar scraping de precos sem backend dedicado.
- Persistir historico em JSON no proprio repositorio.
- Publicar visualizacao estatica via GitHub Pages.
- Permitir cadastro/gestao de produtos por GitHub Issue.

## 2. Visao de componentes

### 2.1 Camada de entrada

- Catalogo de produtos: `data/products.json`.
- Entrada por UI web (`docs/manage.html`) que abre issue no GitHub com payload.
- Workflow de ingestao processa issue e atualiza catalogo.

### 2.2 Camada de orquestracao

- Entrypoint: `src/scrape.js`.
- Responsabilidades:
  - ler produtos ativos;
  - disparar coleta concorrente com controle de pool;
  - consolidar resultados e falhas;
  - persistir snapshots e manifestos.

### 2.3 Camada de coleta (cascata de engines)

- `src/engines/engine1_http.js`
  - HTTP + parsing de HTML para caminho rapido.
- `src/engines/engine2_browser.js`
  - Browser automation mais leve para paginas dinamicas.
- `src/engines/engine3_hardmode.js`
  - Browser mais agressivo + fallback opcional externo (quando `SCRAPING_API_KEY` existe).

A estrategia e de degradacao progressiva: somente sobe de engine quando necessario.

### 2.4 Camada de extracao e normalizacao

- Extracao de preco: `src/extract/extract_price.js` e `src/extract/heuristics.js`.
- Parsing/normalizacao monetaria: `src/utils/price_parse.js`.
- Adaptadores por loja e fallback generico: `src/adapters/*`.
- Classificacao de falhas: `src/utils/failure.js`.

### 2.5 Camada de persistencia

- IO e paths: `src/io/storage.js`, `src/io/paths.js`, `src/io/products.js`.
- Saidas:
  - `data/latest.json`
  - `data/runs/*.json`
  - `data/errors/*.json`
  - `data/runs/index.json`
- Espelho para dashboard estatico:
  - `docs/data/latest.json`
  - `docs/data/runs/*.json`
  - `docs/data/errors/*.json`
  - `docs/data/products.json`

### 2.6 Camada de apresentacao

- Dashboard estatico em `docs/index.html` + `docs/app.js`.
- Tela de gestao em `docs/manage.html` + `docs/manage.js`.

## 3. Fluxos principais

## 3.1 Fluxo A - Scrape diario

1. GitHub Action agenda execucao (`scrape.yml`).
2. `src/scrape.js` carrega produtos ativos.
3. Cada produto percorre cascata de engines.
4. Resultado/falha e classificado e consolidado.
5. Arquivos de `data/` e `docs/data/` sao atualizados.
6. Workflow commita as mudancas.

## 3.2 Fluxo B - Cadastro/gestao via issue

1. Usuario preenche formulario na UI.
2. UI abre issue com payload de mutacao.
3. Workflow `ingest_issue.yml` valida e normaliza payload.
4. Catalogo e atualizado em `data/products.json` e espelhado em `docs/data/products.json`.
5. Issue recebe comentario de status e e encerrada.

## 4. Decisoes arquiteturais relevantes

- **Sem banco e sem API**: reduz custo operacional e complexidade, com trade-off de menor capacidade transacional.
- **JSON versionado no Git**: garante historico/auditoria nativa, com limite de escala para volumes muito altos.
- **Cascata de engines**: otimiza custo (HTTP primeiro) sem abrir mao de robustez (browser/hardmode).
- **Pages estatico**: deploy simples e barato, sem necessidade de infraestrutura backend.

## 5. Riscos tecnicos e mitigacoes

- Bloqueios anti-bot em lojas:
  - mitigacao: retries por engine, hardmode e classificacao de falha para observabilidade.
- Crescimento de arquivos historicos:
  - mitigacao: uso de indice (`runs/index.json`) e possibilidade de politica de retencao futura.
- Mudancas frequentes de HTML das lojas:
  - mitigacao: adaptadores por dominio, seletor custom e fallback por heuristicas.
