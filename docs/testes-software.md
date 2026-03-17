# Testes de software: caixa preta e caixa branca

Este documento registra a estrategia e a execucao de testes funcionais (caixa preta) e estruturais (caixa branca) para a base atual.

## 1. Escopo

- Linguagem/plataforma: Node.js (`node --test`).
- Alvos principais:
  - pipeline de scraping e persistencia;
  - validacao de schema/catalogo;
  - heuristicas de extracao;
  - parser de preco;
  - classificacao de falhas;
  - controle de concorrencia (pool).

## 2. Caixa preta

Teste orientado a comportamento externo, sem depender de detalhes internos de implementacao.

### 2.1 Casos cobertos

- Valida entradas e contratos de catalogo (`catalog_schema`).
- Valida fluxo ponta a ponta do scraping (`scrape_pipeline`):
  - execucao com falha fatal retorna codigo != 0 e gera payload esperado;
  - execucao sem produtos ativos gera snapshot valido;
  - execucoes no mesmo dia mantem IDs unicos e manifesto consistente.

### 2.2 Comando executado

```bash
node --test test/scrape_pipeline.test.js test/catalog_schema.test.js
```

### 2.3 Resultado

- **Aprovado**: 6 testes, 0 falhas.

## 3. Caixa branca

Teste orientado a ramos, regras e funcoes internas.

### 3.1 Casos cobertos

- `heuristics`:
  - deteccao de contexto de parcelamento;
  - deteccao de preco antigo x atual;
  - priorizacao de fontes de extracao.
- `price_parse`:
  - parse de formatos BRL;
  - rejeicao de entradas invalidas;
  - extracao de tokens numericos.
- `failure_classification`:
  - mapeamento de falhas de transporte/navegacao/extracao.
- `pool`:
  - limite de concorrencia;
  - isolamento de falhas de workers.

### 3.2 Comando executado

```bash
node --test test/heuristics.test.js test/price_parse.test.js test/failure_classification.test.js test/pool.test.js
```

### 3.3 Resultado

- **Aprovado**: 13 testes, 0 falhas.

## 4. Regressao completa

Para cobertura de regressao geral da base foi executado:

```bash
npm test
```

Resultado:

- **Aprovado**: 33 testes, 0 falhas.

## 5. Conclusao

- O projeto possui boa cobertura funcional e estrutural nos pontos criticos do scraper.
- A combinacao de caixa preta + caixa branca reduz risco de regressao tanto de contrato quanto de logica interna.
