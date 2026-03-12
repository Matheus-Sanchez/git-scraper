# Revisao rapida da base: problemas encontrados e tarefas sugeridas

## 1) Tarefa (erro de digitacao / copy): ajustar texto do dashboard
- **Problema observado:** o titulo "Resumo do Ultimo Run" mistura PT-BR e EN e usa um texto menos claro para o usuario final.
- **Evidencia:** `web/index.html` exibe `Resumo do Ultimo Run`.
- **Tarefa sugerida:** trocar para algo mais claro e consistente, por exemplo **"Resumo da ultima execucao"** (ou versao com acentos, se o projeto migrar para UTF-8 com acentuacao em UI).
- **Criterio de aceite:** texto atualizado no HTML e validado visualmente na pagina inicial.

## 2) Tarefa (bug): retorno de sucesso em erro fatal do scraper
- **Problema observado:** no erro nao tratado, o processo define `process.exitCode = 0`, o que sinaliza sucesso mesmo quando houve falha.
- **Evidencia:** em `src/scrape.js`, o bloco final de `main().catch(...)` termina com `process.exitCode = 0`.
- **Risco:** CI/CD pode marcar execucoes quebradas como "pass", mascarando incidentes.
- **Tarefa sugerida:** alterar para `process.exitCode = 1` (ou propagar o erro) e garantir que pipelines detectem falhas corretamente.
- **Criterio de aceite:** uma excecao forcada no fluxo principal deve resultar em codigo de saida diferente de zero.

## 3) Tarefa (discrepancia de documentacao/copy): nome do workflow nao reflete o escopo atual
- **Problema observado:** o workflow se chama **"Ingest Add-Product Issue"**, mas o proprio `if` processa tambem `manage-product` e prefixo `[MANAGE PRODUCT]`.
- **Evidencia:** `name` em `.github/workflows/ingest_issue.yml` vs condicao `if` do job.
- **Tarefa sugerida:** renomear para algo que reflita ambos os fluxos (ex.: **"Ingest Product Issues"**) e alinhar README se necessario.
- **Criterio de aceite:** nomenclatura do workflow e documentacao descrevendo o mesmo escopo.

## 4) Tarefa (melhoria de teste): cobrir comportamento de codigo de saida em erro fatal
- **Problema observado:** os testes atuais cobrem parser, heuristicas e pool, mas nao validam comportamento do entrypoint do scraper em falhas fatais.
- **Evidencia:** suite atual em `test/*.test.js` nao cobre `src/scrape.js` no caminho de excecao final.
- **Tarefa sugerida:** adicionar teste de integracao leve que execute `src/scrape.js` em condicao de falha controlada e valide exit code != 0.
- **Criterio de aceite:** novo teste falha com a implementacao atual (`exitCode = 0`) e passa apos o ajuste do bug.
