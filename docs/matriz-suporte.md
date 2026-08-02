# Matriz de suporte

Esta matriz define quais lojas estao oficialmente suportadas para busca, qual o nivel de validacao atual e o criterio minimo para considerar que a loja "esta funcionando".

## Niveis

- `dedicated_validated`: adapter de busca dedicado, regressao por fixture e smoke real de release; a loja participa das buscas regulares
- `backlog_unvalidated`: adapter e caso de smoke conhecidos, mas a loja permanece fora das buscas regulares ate cumprir o criterio de promocao

## Lojas

| Loja | Dominios | Nivel | CI deterministico | Busca regular | Smoke agendado | Criterio atual |
| --- | --- | --- | --- | --- | --- | --- |
| Amazon | `amazon.com.br`, `amazon.com` | `dedicated_validated` | Sim | Sim | Sim | Fixtures verdes + ao menos 1 sucesso real direto e correto antes da publicacao |
| KaBuM | `kabum.com.br` | `dedicated_validated` | Sim | Sim | Sim | Fixtures verdes + ao menos 1 sucesso real direto e correto antes da publicacao |
| Mercado Livre | `mercadolivre.com.br` | `backlog_unvalidated` | Sim | Nao | Sim | Fixtures verdes + 3 smokes agendados consecutivos, diretos e corretos |
| Magalu | `magazineluiza.com.br`, `magalu.com` | `backlog_unvalidated` | Sim | Nao | Sim | Fixtures verdes + 3 smokes agendados consecutivos, diretos e corretos |
| Shopee | `shopee.com.br` | `backlog_unvalidated` | Sim | Nao | Sim | Fixtures verdes + 3 smokes agendados consecutivos, diretos e corretos |
| Pichau | `pichau.com.br` | `backlog_unvalidated` | Sim | Nao | Sim | Fixtures verdes + 3 smokes agendados consecutivos, diretos e corretos |
| Petz | `petz.com.br` | `backlog_unvalidated` | Sim | Nao | Sim | Fixtures verdes + 3 smokes agendados consecutivos, diretos e corretos |

## Regras de aceite por loja

Uma loja em `dedicated_validated` so pode ser considerada saudavel quando:

- possui `buildSearchUrl`, `extractSearchResults` e `classifySearchFailure`
- passa na regressao deterministica por fixture de busca
- persiste resultado sem quebrar schema, manifesto ou historico
- no smoke real, produz ao menos um item com `status: "ok"` e `engine_used != "carry_forward"`

Um item `carried_forward` e util para continuidade de dados, mas nao prova saude atual da loja. O smoke tambem precisa aceitar a oferta e confirmar a identidade e a variante esperadas.

Uma loja em `backlog_unvalidated` nao participa das buscas regulares. Para promocao, ela deve possuir fixture deterministica especifica e completar tres execucoes agendadas consecutivas com sucesso direto, oferta aceita e identidade/variante corretas; execucao manual ou `carried_forward` nao conta para a sequencia.

## Casos fixos de smoke

- Amazon: Echo Pop
- KaBuM: ASUS TUF B760 DDR5
- Mercado Livre: Logitech K835
- Magalu: Acer Aspire GO 15 i7/512GB
- Shopee: HyperX Cloud Stinger 2 preto
- Pichau: ASUS TUF B760 DDR5
- Petz: Pampers Confort Sec G

O workflow agendado executa todos os casos registrados. A selecao manual pode limitar `store_ids`, inclusive para diagnosticar uma loja do backlog sem promove-la.

Lightpanda e a primeira engine tentada. Se o readiness check, a conexao CDP ou a navegacao falhar, Chromium pode assumir; essa degradacao deve aparecer explicitamente na telemetria e no painel.
