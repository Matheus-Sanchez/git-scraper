# Arquitetura do Git Scraper

Este documento descreve a arquitetura atual do projeto em visao de componentes, fluxo de dados e decisoes tecnicas.

## 1. Objetivo arquitetural

- Executar busca e scraping de precos sem backend dedicado.
- Persistir historico em JSON no proprio repositorio.
- Publicar visualizacao estatica via GitHub Pages.
- Permitir cadastro/gestao de intencoes de compra por GitHub Issue.

## 2. Visao de componentes

### 2.1 Camada de entrada

- Catalogo de intencoes: `data/products.json`.
- Entrada por UI web (`docs/manage.html`) que abre issue no GitHub com payload.
- Workflow de ingestao processa issue e atualiza catalogo.

O catalogo nao aceita URL direta de anuncio. Cada entrada descreve o que comprar (`name`, `characteristics`, `category`, lojas e regras de comparacao). URLs aparecem somente depois da busca, como evidencia das ofertas descobertas.

### 2.2 Camada de orquestracao

- Entrypoint: `src/scrape.js`.
- Responsabilidades:
  - ler intencoes ativas;
  - disparar coleta concorrente com controle de pool;
  - consolidar resultados e falhas;
  - persistir snapshots e manifestos.

### 2.3 Camada de busca e coleta

- `src/engines/engine_search.js`
  - monta queries por intencao;
  - abre paginas de busca por loja;
  - usa Lightpanda via `chromium.connectOverCDP`;
  - usa Chromium/Playwright local como fallback tecnico.
- `src/search/store_adapters.js`
  - define `buildSearchUrl(query)`;
  - extrai ofertas da pagina de resultados;
  - classifica falhas de busca por loja.

A estrategia e Lightpanda primeiro, Chromium local apenas quando a conexao CDP ou a navegacao falhar.

### 2.4 Camada de extracao e normalizacao

- Extracao de ofertas de busca: `src/search/store_adapters.js`.
- Ranking e filtros: `src/search/ranking.js`.
- Normalizacao de atributos e preco unitario: `src/search/unit.js`.
- Parsing/normalizacao monetaria: `src/utils/price_parse.js`.
- Classificacao de falhas: `src/utils/failure.js`.

As regras sao genericas:

- `required_terms` e `required_attributes` sao restricoes obrigatorias.
- `preferred_terms` e `preferred_attributes` influenciam prioridade, mas nao eliminam oferta.
- `excluded_terms` elimina oferta.
- `unit_rule` troca a ordenacao de preco total para preco por unidade/base.

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
2. `src/scrape.js` carrega intencoes ativas.
3. Cada intencao e pesquisada nas lojas configuradas.
4. Ofertas sao extraidas, normalizadas e ranqueadas.
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
- **Sem URL direta no cadastro**: evita acoplamento a um unico anuncio e permite comparar variacoes entre lojas.
- **Lightpanda como engine principal**: reduz custo de browser completo e mantem API CDP compativel com Playwright.
- **Fallback Chromium local**: mantem caminho tecnico quando Lightpanda falha.
- **Regras separadas de obrigatorio/prioridade**: permite modelar produtos diferentes sem hardcode por categoria.
- **Pages estatico**: deploy simples e barato, sem necessidade de infraestrutura backend.

## 5. Riscos tecnicos e mitigacoes

- Bloqueios anti-bot em lojas:
  - mitigacao: Lightpanda, fallback Chromium e classificacao de falha para observabilidade.
- Crescimento de arquivos historicos:
  - mitigacao: uso de indice (`runs/index.json`) e possibilidade de politica de retencao futura.
- Mudancas frequentes de HTML das lojas:
  - mitigacao: adapters de busca por loja e fixtures deterministicas.
