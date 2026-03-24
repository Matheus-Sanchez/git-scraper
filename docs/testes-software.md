# Testes de software

Este documento descreve a estrutura atual de QA para o scraper e o que cada camada valida.

## 1. Objetivos

Os testes precisam cobrir:

- qualidade de codigo e contratos do catalogo
- erros operacionais e classificacao de falhas
- continuidade dos dados persistidos
- regressao por dominio para lojas com suporte validado

## 2. Camadas da suite

### Unitarios

Comando:

```bash
npm run test:unit
```

Cobertura principal:

- `price_parse`
- `heuristics`
- `failure_classification`
- `pool`
- `catalog_schema`
- `issue_ingest_parser`
- `amazon_paapi`

### Fixtures e regressao por dominio

Comando:

```bash
npm run test:fixtures
```

Cobertura principal:

- extracao com fixtures HTML deterministicas
- roteamento de adapter por URL
- regressao por dominio para lojas com adapter dedicado

Matriz validada hoje:

- Amazon
- KaBuM

Dominios atendidos apenas pelo `genericAdapter` continuam fora da matriz de suporte validado.

### Integracao e continuidade de dados

Comando:

```bash
npm run test:integration
```

Cobertura principal:

- fluxo de scraping ponta a ponta
- run fatal e run vazio
- IDs unicos para runs do mesmo dia
- persistencia de `latest.json`, `runs/index.json`, `runs/<run_id>.json` e `errors/<run_id>.json`
- espelhamento consistente entre `data/` e `docs/data/`
- carry-forward de preco anterior
- normalizacao de manifesto legado
- busca do ultimo preco historico valido por `product_id`

## 3. Gates de qualidade

Comandos:

```bash
npm run lint
npm run validate:catalog
npm run test:ci
```

Significado:

- `lint`: validacao estatica de `src/`, `test/`, `.github/scripts/` e `scripts/`
- `validate:catalog`: valida `data/products.json` com o schema oficial
- `test:ci`: pipeline rapida usada no GitHub Actions

## 4. CI

Workflow rapido:

- arquivo: `.github/workflows/ci.yml`
- gatilhos: `push` e `pull_request`
- ignora alteracoes apenas em `data/**` e `docs/data/**`

Workflow agendado:

- arquivo: `.github/workflows/scrape.yml`
- executa a mesma suite rapida antes do scrape real

## 5. Aceite atual

Uma mudanca deve falhar no CI quando:

- quebrar parser, heuristicas, schema ou persistencia
- invalidar `data/products.json`
- fizer Amazon ou KaBuM cair no `genericAdapter`
- quebrar continuidade de dados em run parcial, manifesto ou carry-forward
