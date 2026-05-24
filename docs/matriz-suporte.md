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
| Mercado Livre | `mercadolivre.com.br` | `dedicated_validated` | Sim | Sim quando houver produto ativo | Adapter Mercado Livre + fixtures verdes + ao menos 1 sucesso direto no smoke real quando selecionado |
| Magalu | `magazineluiza.com.br`, `magalu.com` | `dedicated_validated` | Sim | Sim quando houver produto ativo | Adapter Magalu + fixtures verdes + ao menos 1 sucesso direto no smoke real quando selecionado |
| Shopee | `shopee.com.br` | `dedicated_validated` | Sim | Sim quando houver produto ativo | Adapter Shopee + fixtures verdes + ao menos 1 sucesso direto no smoke real quando selecionado |
| Pichau | `pichau.com.br` | `dedicated_validated` | Sim | Sim quando houver produto ativo | Adapter Pichau + fixtures verdes + ao menos 1 sucesso direto no smoke real quando selecionado |
| Petz | `petz.com.br` | `dedicated_validated` | Sim | Sim quando houver produto ativo | Adapter Petz + fixtures verdes + ao menos 1 sucesso direto no smoke real quando selecionado |
| Outros dominios | demais dominios | `generic_unvalidated` | Nao | Nao | Apenas fallback heuristico, sem garantia operacional |

## Regras de aceite por loja

Uma loja suportada so pode ser considerada saudavel quando:

- nao cai no `genericAdapter`
- passa na regressao deterministica por fixture
- persiste resultado sem quebrar schema, manifesto ou historico
- no smoke real, produz ao menos um item com `status: "ok"` e `engine_used != "carry_forward"`

Um item `carried_forward` e util para continuidade de dados, mas nao prova saude atual da loja.
