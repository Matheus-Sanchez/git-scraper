# Testes de software

Este documento descreve a estrategia de QA do scraper, os gates obrigatorios de CI e a separacao entre regressao deterministica e smoke real.

## 1. Objetivos

Os testes precisam garantir:

- qualidade de codigo e contratos de schema
- classificacao previsivel de erros e observabilidade minima
- continuidade dos dados persistidos e integridade do historico
- regressao por loja suportada sem depender da internet em PR
- ranking generico de ofertas por restricoes obrigatorias, prioridades e preco unitario
- transformacoes e renderizacao dos cinco graficos do dashboard
- separacao clara entre validacao de PR e validacao real contra sites externos

## 2. Principios obrigatorios

### Determinismo em PR

Toda validacao de `push` e `pull_request` precisa ser deterministicamente reproduzivel:

- sem dependencia de internet
- sem dependencia de clock externo alem do proprio processo de teste
- sem retry automatico em suites de PR
- com fixtures versionadas para regressao de DOM

### Observabilidade minima

Toda falha persistida no pipeline deve carregar no minimo:

- `error_code`
- `error_detail`
- `engine`
- contexto operacional suficiente para diagnostico (`store_errors`, `stores_checked`, `offers_checked` ou artifacto quando houver)

Fatal errors fora dos engines tambem devem carregar `engine: "pipeline"` para manter o contrato uniforme.

### CI separado de smoke real

- `CI`: roda localmente e no GitHub Actions a cada `push` e `pull_request`; usa apenas fixtures e ambiente controlado.
- `Smoke real`: roda em workflow separado, manual ou agendado, com internet, Lightpanda e Chromium fallback.

## 3. Camadas da suite

### Unitarios

Comando:

```bash
npm run test:unit
```

Cobertura principal:

- schema do catalogo
- classificacao de falhas
- parser de preco
- heuristicas
- ingest de issue
- adapters de busca
- ranking e normalizacao de atributos
- matriz de suporte e selecao de smoke

### Fixtures e regressao por loja

Comando:

```bash
npm run test:fixtures
```

Cobertura principal:

- extracao de ofertas em fixtures HTML deterministicas
- montagem de URL de busca por loja
- regressao por loja para adapters com suporte validado

### Integracao local

Comando:

```bash
npm run test:integration
```

Cobertura principal:

- pipeline ponta a ponta sem internet
- persistencia de `latest.json`, `runs/index.json`, `runs/<run_id>.json` e `errors/<run_id>.json`
- espelhamento entre `data/` e `docs/data/`
- continuidade de historico com carry-forward
- persistencia de `latest.items` e `latest.offers`
- Lightpanda mockado e fallback Chromium no pipeline de busca

### Contratos e integridade de dados

Comando:

```bash
npm run test:data
```

Cobertura principal:

- manifesto ausente, invalido ou incompleto
- todos os runs validos presentes exatamente uma vez
- contratos de runs e erros antigos e atuais
- igualdade entre os espelhos `data/` e `docs/data/`

### Dashboard

Comandos:

```bash
npm run test:dashboard:unit
npm run test:dashboard:e2e
```

O teste unitario cobre normalizacao, carry-forward, gaps, filtros, quatro modos historicos, indices e exclusao de ofertas rejeitadas ou suspeitas. O E2E e executado em Chromium, com o site servido sob `/git-scraper/`, e exige cinco canvases desenhados, controles funcionais e ausencia de erros de console ou rede.

### Gate de cobertura minima por area critica

Comando:

```bash
npm run test:coverage:critical
```

Areas validadas:

- `failures`
- `schema`
- `persistence`
- `search-engine`
- `scraping`
- `dashboard-model`

Thresholds atuais:

| Area | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| failures | 90 | 85 | 90 |
| schema | 90 | 75 | 80 |
| persistence | 90 | 65 | 90 |
| search-engine | 80 | 70 | 80 |
| scraping | 60 | 50 | 60 |
| dashboard-model | 90 | 80 | 90 |

Esses thresholds sao o piso minimo operacional. Eles podem subir conforme a suite amadurece, mas nao devem cair sem justificativa tecnica explicita.

## 4. Matriz de suporte e aceite

A matriz oficial fica em `docs/matriz-suporte.md`.

Regra de aceite para `dedicated_validated`:

- a loja precisa ter adapter de busca dedicado
- a loja precisa passar regressao deterministica por fixture de busca
- o smoke real precisa obter pelo menos um sucesso direto na execucao atual
- `carried_forward` nao conta como loja saudavel no smoke real

Somente Amazon e KaBuM estao em `dedicated_validated`. Mercado Livre, Magalu, Shopee, Pichau e Petz estao em `backlog_unvalidated`, fora das buscas regulares. Cada uma so pode ser promovida depois de fixtures deterministicas verdes e tres smokes agendados consecutivos com sucesso direto, oferta aceita e identidade/variante corretas.

## 5. Flakiness e retries

Politica:

- sem retry em suites de PR
- fallback controlado de Lightpanda para Chromium local quando readiness, CDP ou navegacao falham, sempre com degradacao explicita na telemetria
- smoke real pode falhar por bloqueio, captcha ou mudanca de DOM; nesses casos o artifacto deve ser publicado para analise
- flakiness nunca deve ser mascarada em CI principal

## 6. GitHub Actions

### CI deterministico

Workflow:

- `.github/workflows/ci.yml`

Executa em:

- `push`
- `pull_request`

Passos obrigatorios:

- `npm ci`
- `npm run test:ci`

O job `ci` inclui contratos de dados e testes unitarios do dashboard e nao ignora mudancas em `data/**` ou `docs/data/**`.

### Dashboard E2E

No mesmo workflow `.github/workflows/ci.yml`, o job separado `ui-e2e` executa em `push` e `pull_request`:

- `npm ci`
- instalacao do Chromium do Playwright
- `npm run test:dashboard:e2e`

Esse job deve ser um check obrigatorio no ruleset da branch principal.

### Smoke real

Workflow:

- `.github/workflows/smoke_real.yml`

Executa em:

- `workflow_dispatch`
- `schedule`

Passos obrigatorios:

- `npm ci`
- `npx playwright install --with-deps chromium`
- inicializacao do container Lightpanda
- `npm run smoke:real`

O agendamento executa todos os casos registrados, inclusive os de `backlog_unvalidated`; `workflow_dispatch` pode limitar a execucao com `store_ids`. Se o Lightpanda nao ficar pronto, o Chromium assume e o resultado registra a degradacao explicitamente.

Resultado esperado:

- gera `.cache/smoke-real/summary.json`
- publica artifact com `.cache/smoke-real`

## 7. Branch protection

No GitHub, a branch principal deve exigir:

- check `ci` verde
- check `ui-e2e` verde
- branch atualizada com a base antes do merge
- bloqueio de merge com checks pendentes ou falhos

`Smoke real` nao e um check deterministico de PR; ele serve para detectar drift de producao. Ainda assim, Amazon e KaBuM precisam de smoke direto correto antes da publicacao, e a promocao de uma loja do backlog exige tres smokes agendados consecutivos corretos.

## 8. Como analisar resultados

### Local

Use:

```bash
npm run test:precommit
```

Se falhar por cobertura, o runner do Node mostra a area, o arquivo e as linhas descobertas abaixo do threshold.

### GitHub Actions

Veja:

- logs do job `ci` para quebra deterministica
- logs do job `ui-e2e` para regressao visual ou funcional do dashboard
- logs do job `smoke-real` para validacao externa
- artifacts publicados quando houver falha ou quando o smoke for executado

### Artefatos relevantes

- `.cache/smoke-real/summary.json`: resumo por loja do smoke real
- `.cache/smoke-real/workspace/data/**`: snapshot temporario gerado pelo smoke real
