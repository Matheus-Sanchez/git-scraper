# Matriz de suporte

Esta matriz define quais lojas estao oficialmente suportadas para busca, qual o nivel de validacao atual e o criterio minimo para considerar que a loja "esta funcionando".

## Niveis

- `dedicated_validated`: adapter de busca dedicado, regressao por fixture e smoke real habilitado
- `backlog`: loja conhecida, mas ainda sem suporte validado

## Lojas

| Loja | Dominios | Nivel | CI deterministico | Smoke real | Criterio de aceite |
| --- | --- | --- | --- | --- | --- |
| Amazon | `amazon.com.br`, `amazon.com` | `dedicated_validated` | Sim | Sim | Adapter de busca Amazon + fixtures verdes + ao menos 1 sucesso direto no smoke real |
| KaBuM | `kabum.com.br` | `dedicated_validated` | Sim | Sim | Adapter de busca KaBuM + fixtures verdes + ao menos 1 sucesso direto no smoke real |
| Mercado Livre | `mercadolivre.com.br` | `dedicated_validated` | Sim | Sim | Adapter de busca Mercado Livre + fixtures verdes + ao menos 1 sucesso direto no smoke real |
| Magalu | `magazineluiza.com.br`, `magalu.com` | `dedicated_validated` | Sim | Sim | Adapter de busca Magalu + fixtures verdes + ao menos 1 sucesso direto no smoke real |
| Shopee | `shopee.com.br` | `dedicated_validated` | Sim | Sim | Adapter de busca Shopee + fixtures verdes + ao menos 1 sucesso direto no smoke real |
| Pichau | `pichau.com.br` | `dedicated_validated` | Sim | Sim | Adapter de busca Pichau + fixtures verdes + ao menos 1 sucesso direto no smoke real |
| Petz | `petz.com.br` | `dedicated_validated` | Sim | Sim | Adapter de busca Petz + fixtures verdes + ao menos 1 sucesso direto no smoke real |

## Regras de aceite por loja

Uma loja suportada so pode ser considerada saudavel quando:

- possui `buildSearchUrl`, `extractSearchResults` e `classifySearchFailure`
- passa na regressao deterministica por fixture de busca
- persiste resultado sem quebrar schema, manifesto ou historico
- no smoke real, produz ao menos um item com `status: "ok"` e `engine_used != "carry_forward"`

Um item `carried_forward` e util para continuidade de dados, mas nao prova saude atual da loja.
