# Matriz de suporte

Esta matriz define quais lojas estao oficialmente suportadas, qual o nivel de validacao atual e o criterio minimo para considerar que a loja "esta funcionando".

## Niveis

- `dedicated_validated`: adapter dedicado, regressao por fixture e smoke real habilitado
- `backlog`: dominio conhecido, mas ainda sem suporte validado
- `generic_unvalidated`: apenas fallback generico, sem compromisso de estabilidade

## Lojas

| Loja | Dominios | Nivel | CI deterministico | Smoke real | Criterio de aceite |
| --- | --- | --- | --- | --- | --- |
| Amazon | `amazon.com.br`, `amazon.com` | `dedicated_validated` | Sim | Sim | Adapter Amazon + fixtures verdes + ao menos 1 sucesso direto no smoke real |
| KaBuM | `kabum.com.br` | `dedicated_validated` | Sim | Sim | Adapter KaBuM + fixtures verdes + ao menos 1 sucesso direto no smoke real |
| Mercado Livre | `mercadolivre.com.br` | `backlog` | Nao | Nao | Nao suportado oficialmente no momento |
| Magalu | `magazineluiza.com.br`, `magalu.com` | `backlog` | Nao | Nao | Nao suportado oficialmente no momento |
| Shopee | `shopee.com.br` | `backlog` | Nao | Nao | Nao suportado oficialmente no momento |
| Pichau | `pichau.com.br` | `backlog` | Nao | Nao | Nao suportado oficialmente no momento |
| Petz | `petz.com.br` | `backlog` | Nao | Nao | Nao suportado oficialmente no momento |
| Outros dominios | demais dominios | `generic_unvalidated` | Nao | Nao | Apenas fallback heuristico, sem garantia operacional |

## Regras de aceite por loja

Uma loja suportada so pode ser considerada saudavel quando:

- nao cai no `genericAdapter`
- passa na regressao deterministica por fixture
- persiste resultado sem quebrar schema, manifesto ou historico
- no smoke real, produz ao menos um item com `status: "ok"` e `engine_used != "carry_forward"`

Um item `carried_forward` e util para continuidade de dados, mas nao prova saude atual da loja.
