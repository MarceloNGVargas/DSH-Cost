# Changelog

## 1.0.1

- **Documentação técnica completa** em [`docs/COMO-FUNCIONA.md`](docs/COMO-FUNCIONA.md):
  arquitetura das três peças, fluxo de dados, formatos de arquivo, todas as chaves do
  `live.json`, cálculo de custo (`inputTokens` = cache miss, peak/off-peak, economia de
  cache), comando `/custo`, critério de "sessão em processamento", i18n, configuração,
  instalação/publicação e limitações conhecidas.
- `docs/` passou a ser incluído no pacote (`files`).
- README alinhado ao código: resolução de idioma (comando × janela), nome do arquivo de
  sessão com URL-encoding, tabela de preços usada pelo monitor e remoção de um bullet
  duplicado.

## 1.0.0

Primeira versão publicável.

- Comando `/custo` (com alias `/cost`) com resumo da sessão, tabela por requisição,
  divisão de custo entrada/saída, economia gerada pelo cache e totais em **US$** e **R$**
  pela cotação do dia (awesomeapi, com fallback open.er-api e cache local).
- Medição em tempo real de cada `llm/stream`: duração, TTFT, tokens de entrada
  (miss/cache hit/cache write) e de saída, com preço **peak/off-peak** aplicado
  automaticamente (janelas UTC da DeepSeek).
- Snapshot `~/.dsh/session-cost/live.json` com dia, sessões, histórico diário (31 dias),
  chamadas em andamento e estado real de execução (turno aberto / ferramenta em curso).
- Monitor visual no Windows (WPF) com 3 abas — Ao vivo, Sessões e Histórico — atualizando
  a cada 0,5 s, com custo por sessão, economia de cache em R$ e US$, e cronômetro da
  requisição em curso.
- Multi-idioma: **pt-BR**, **en**, **es** e **zh-CN** (plugin e app), com detecção
  automática pelo idioma do sistema ou `config.language`.
- Cotação do dia, tabela de preços e política de faixa configuráveis; custo sempre
  recalculado na leitura, então mudanças de preço corrigem o histórico já medido.
- Testes: `node test/smoke.mjs` (preços, peak/off-peak, cache, medição, comando,
  snapshot, esforço, sessões em processamento, persistência, i18n).
