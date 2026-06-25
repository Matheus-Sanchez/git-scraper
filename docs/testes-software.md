# Testes de software

Este documento descreve a estrategia de QA do scraper, os gates obrigatorios de CI e a separacao entre regressao deterministica e smoke real.

## 1. Objetivos

Os testes precisam garantir:

- qualidade de codigo e contratos de schema
- classificacao previsivel de erros e observabilidade minima
- continuidade dos dados persistidos e integridade do historico
- regressao por loja suportada sem depender da internet em PR
- ranking generico de ofertas por restricoes obrigatorias, prioridades e preco unitario
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

### Gate de cobertura minima por area critica

Comando:

```bash
npm run test:coverage:critical
```

Areas validadas:

- `failures`
- `schema`
- `persistence`
- `scraping`

Thresholds atuais:

| Area | Lines | Branches | Functions |
| --- | ---: | ---: | ---: |
| failures | 90 | 85 | 90 |
| schema | 90 | 75 | 80 |
| persistence | 90 | 65 | 90 |
| scraping | 60 | 50 | 60 |

Esses thresholds sao o piso minimo operacional. Eles podem subir conforme a suite amadurece, mas nao devem cair sem justificativa tecnica explicita.

## 4. Matriz de suporte e aceite

A matriz oficial fica em `docs/matriz-suporte.md`.

Regra de aceite por loja suportada:

- a loja precisa ter adapter de busca dedicado
- a loja precisa passar regressao deterministica por fixture de busca
- o smoke real precisa obter pelo menos um sucesso direto na execucao atual
- `carried_forward` nao conta como loja saudavel no smoke real

Amazon, KaBuM, Mercado Livre, Magalu, Shopee, Pichau e Petz estao em `dedicated_validated`.

## 5. Flakiness e retries

Politica:

- sem retry em suites de PR
- fallback controlado de Lightpanda para Chromium local quando CDP ou navegacao falham
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

Resultado esperado:

- gera `.cache/smoke-real/summary.json`
- publica artifact com `.cache/smoke-real`

## 7. Branch protection

No GitHub, a branch principal deve exigir:

- check `ci` verde
- branch atualizada com a base antes do merge
- bloqueio de merge com checks pendentes ou falhos

`Smoke real` nao deve bloquear PR; ele serve para detectar drift de producao.

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
- logs do job `smoke-real` para validacao externa
- artifacts publicados quando houver falha ou quando o smoke for executado

### Artefatos relevantes

- `.cache/smoke-real/summary.json`: resumo por loja do smoke real
- `.cache/smoke-real/workspace/data/**`: snapshot temporario gerado pelo smoke real
