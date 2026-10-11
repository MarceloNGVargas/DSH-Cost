# dsh-session-cost-monitor

[![release](https://img.shields.io/github/v/release/MarceloNGVargas/DSH-Cost)](https://github.com/MarceloNGVargas/DSH-Cost/releases/latest)
[![license](https://img.shields.io/github/license/MarceloNGVargas/DSH-Cost)](LICENSE)

Plugin global do DeepSeek Harness que mede, **por sessão**, o tempo e o custo de
cada requisição de modelo, e mostra o total em **dólar** e em **real** usando a
**cotação do dólar do dia** — com comando no chat e monitor visual no Windows.

📖 **Como funciona, por dentro:** [`docs/COMO-FUNCIONA.md`](docs/COMO-FUNCIONA.md) —
arquitetura das três peças, formatos dos arquivos em `~/.dsh/session-cost`,
cálculo de preço (peak/off-peak, cache miss/hit), critério de "sessão em
processamento", i18n, tabela de configuração e limitações.

## Idiomas

Interface e saída do comando em **pt-BR**, **en**, **es** e **zh-CN**:

- `auto` (padrão) no **comando** resolve por `DSH_LOCALE`/`DSH_LANG`/`LANG` e, sem eles, pelo
  idioma do sistema via `Intl`; a **janela** usa o `CurrentUICulture` do Windows. Nos dois casos
  cai para inglês quando não há correspondência.
- para forçar, use `config.language: en` (ou `pt-BR`, `es`, `zh-CN`) no patch do perfil;
- o monitor visual aceita `-Language auto|pt-BR|en|es|zh-CN` e usa os dicionários em
  [`app/locales/`](app/locales);
- as traduções ficam em [`lib/i18n.js`](lib/i18n.js) (comando e relatório) e nos
  arquivos `app/locales/*.json` (janela). Acrescentar um idioma é copiar um bloco e
  registrar a chave.

Você dispara quando quiser, como mensagem no chat:

```
/custo
```

(alias: `/cost`)

## O que ele faz

- Escuta o waterfall `llm/stream` do Harness e mede **toda** chamada de modelo
  (inclui subagentes, título de sessão e compactação).
- Por requisição: hora, modelo, `turno/passo`, **duração total**, **TTFT**
  (tempo até o primeiro chunk), tokens de entrada, cache hit, tokens de saída,
  **custo em US$** e **custo em R$**.
- Totais da sessão: requisições, tempo acumulado, tokens de entrada/saída,
  custo em US$ e em R$ com a cotação, a fonte e a data da cotação, e a divisão do
  custo entre tokens de **entrada** (miss + cache hit/write) e de **saída** (gerados), e a
  **economia com cache** (o que os tokens de cache deixaram de custar).
- Aplica automaticamente o preço **peak/off-peak** da DeepSeek
  (peak = 01:00–04:00 e 06:00–10:00 UTC em dias úteis = 2x o preço off-peak).
- Persiste as medições em `~/.dsh/session-cost/sessions/<sessão>.json`, então o
  histórico sobrevive a recarregamento do plugin (HMR) e reinício do app.
- Cotação USD/BRL: tenta `economia.awesomeapi.com.br` (Banco Central/comercial)
  e, se falhar, `open.er-api.com`. Fica em cache por 6 horas.

## Uso

```
/custo             resumo da sessão + tabela por requisição (US$ e R$)
/custo json        mesmos dados em JSON (útil para script/planilha)
/custo cotacao     força a atualização da cotação de hoje
/custo reset       zera os dados medidos da sessão atual
/custo help        ajuda
```

O comando é registrado globalmente no perfil: funciona em **todas** as sessões
e aparece no autocomplete de comandos do chat.

## App visual no Windows (janela sempre ativa)

Além do comando, há uma janela nativa (WPF) que fica sempre visível e atualiza
sozinha a cada segundo:

```
plugins\dsh-session-cost\app\abrir-monitor.cmd
```

(ou `powershell.exe -NoProfile -ExecutionPolicy Bypass -File app\abrir-monitor.ps1`)

![Janela do monitor](preview.png)

O que a janela mostra (três abas):

**Ao vivo** — ![aba Ao vivo](preview.png)

No cabeçalho aparece o **nome da sessão ativa** (o título gerado pelo próprio DSH) e o **esforço de
raciocínio em uso**. O modelo é mostrado pelo **nome do catálogo** — `DeepSeek-V41-Flash`,
`DeepSeek-V4-Pro` — sem o prefixo do provedor; esse nome é lido do catálogo do adapter dentro do
app instalado. O **esforço** aparece por requisição e por sessão (`Low`, `Medium`, `High`, `Max`;
`—` quando não registrado). As tabelas usam colunas separadas por `|`, para leitura alinhada.

- **HOJE** — custo do dia em R$ (grande) e US$, requisições, tokens, tempo de modelo e a
  divisão do custo entre **entrada** (prompt + cache) e **saída** (tokens gerados), em R$ **e** US$;
- **SESSÕES EM ANDAMENTO** — um cartão com **uma linha por sessão realmente processando agora**
  (título, requisições, tempo, tokens, R$ e US$), com o total somado no título. O critério usa o que
  o próprio DSH registra: **turno aberto** (`turnBoundary.openTurnStartSeq`), ferramenta em execução
  (`sessionStats.pendingCalls`/`openStep`) ou chamada de modelo em curso — então cobre também o
  intervalo em que o agente executa ferramentas entre duas requisições. Quando o turno fecha, a
  sessão sai da lista sozinha; sem nada rodando, o cartão mostra "nada processando agora";
- **economia com cache** — quanto os tokens lidos do cache deixaram de custar por não virem como
  miss, em R$ e US$, mais o **cache hit %** do dia e da última requisição;
- **ÚLTIMA REQUISIÇÃO** — modelo, esforço, duração, TTFT, miss/cache/saída, custo total,
  divisão entrada/saída e economia com cache;
- **RECENTES** — as últimas requisições da sessão ativa: `hora | modelo | esforco | tempo | in | out | R$ | US$ | econ.R$ | econ.US$`;
- **Sessões** — nome (assunto) da sessão, esforço e custo: `inicio | sessao (assunto) | reqs | tokens | tempo | esforco | R$ | US$ | econ.R$ | econ.US$`;
- **Histórico** — `dia | reqs | tokens | tempo | R$ | US$ | econ.R$ | econ.US$`.

Os cabeçalhos ficam sem acento (`inicio`, `sessao`, `esforco`) de propósito: acentos quebravam o
alinhamento de largura fixa em fonte monoespaçada. Os títulos das sessões mantêm os acentos normais.

**Sessões** — ![aba Sessões](preview-sessoes.png)

- o **nome (assunto)** e o custo de **cada sessão** medida: início, título, requisições, tokens, tempo, R$, US$ e economia com cache;
- somatório geral no cabeçalho da aba (o mesmo total de todos os dias medidos).

**Histórico** — ![aba Histórico](preview-historico.png)

- consumo **dia a dia** (até 31 dias): requisições, tokens, tempo, R$, US$ e economia com cache;
- o histórico sai dos próprios arquivos por sessão, então dias anteriores continuam
  aparecendo enquanto os arquivos existirem.

### De onde vem o nome da sessão

O DSH já tem um agente global de título (`@deepseek-ai/dsh-session-title` +
`session-title-first-prompt-llm`): no começo de cada sessão ele lê o primeiro pedido e grava um
título curto conforme o assunto. **Não é preciso criar outro agente** — o monitor apenas lê esse
título do cache de projeções (`~/.dsh/storages/session_projcache/sessions/<sessão>.json`,
campo `record.rows.title.val`) e o app exibe. Se o título ainda não existir, o monitor usa as
primeiras palavras do primeiro prompt como fallback.

Os nomes de exibição do modelo (`DeepSeek-V41-Flash` para `deepseek-flash`) vêm do catálogo do
adapter lido dentro do `app.asar` instalado (`DEFAULT_MODELS` de `dsh-llm-deepseek`), com fallback
embutido no monitor; o plugin também pode gravá-los em `~/.dsh/session-cost/model-names.json` via
`ctx.llm.listModels(provider)`, e esse arquivo tem precedência quando existe.

O **esforço de raciocínio** vem da projeção `modelSelection.val.lastUsed.reasoningEffort` do DSH
(por sessão) e, quando o plugin está recarregado, também do campo `options.reasoningEffort` de cada
chamada em `llm/stream` (por requisição).

No rodapé: cotação USD/BRL, fonte e data, e o "atualizado há N s". Botões:
**Fixar no topo** (liga/desliga), **Atualizar**, **Pasta de dados** e **Sair**.
Para abrir direto numa aba: `-Tab 0` (Ao vivo), `-Tab 1` (Sessões), `-Tab 2` (Histórico).

Arquitetura (três peças, sem acoplar o app ao plugin):

1. o plugin mede cada `llm/stream` e grava `~/.dsh/session-cost/sessions/<sessão>.json`
   (o nome do arquivo é o `sessionId` com URL-encoding);
2. `app/monitor.mjs` (Node) agrega esses arquivos a cada segundo, aplica a tabela de preços
   **padrão** do plugin (`resolveConfig({})`) e grava `~/.dsh/session-cost/live.json`;
3. `app/SessionCostMonitor.ps1` (WPF) lê `live.json` a cada 500 ms e desenha a janela.

Por isso o app continua funcionando mesmo quando o app DSH ainda está com uma
versão antiga do plugin em memória (trocar código de plugin exige reiniciar o DSH).

### Abrir junto com o Windows

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -File app\instalar-no-inicio.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File app\instalar-no-inicio.ps1 -Remover
```

O atalho é criado na pasta Inicializar do usuário
(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`).

## Configuração

Rode `/custo` **depois** de trocar mensagens com o agente: ele mede as
requisições que já aconteceram (não há como medir as anteriores à instalação).

Para sobrescrever preços, política de faixa ou cache da cotação, edite o patch
do bundle no perfil — `~/.dsh/profiles/desktop/cordis.patch.yml` — e ajuste a
linha `session-cost` (ou use a página **Plugins** da barra lateral):

```yaml
- id: session-cost
  name: 'dsh-session-cost'
  config:
    commandName: custo          # nome do comando (sem a barra)
    aliasCommands: [cost]       # nomes extras
    peakPolicy: auto            # auto | peak | off-peak
    persist: true
    maxRequestsPerSession: 500
    fx:
      cacheHours: 6
      timeoutMs: 8000
      # url: https://exemplo/cotacao.json   # provedor extra, consultado primeiro
    prices:                     # USD por 1M tokens
      deepseek-flash:
        cacheHit: { offPeak: 0.003, peak: 0.006 }
        cacheMiss: { offPeak: 0.15, peak: 0.3 }
        output: { offPeak: 0.6, peak: 1.2 }
```

Preços default (USD/1M tokens, tabela oficial):

| modelo | cache hit (off-peak) | cache miss (off-peak) | saída (off-peak) |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.003 | 0.15 | 0.60 |
| `deepseek-v4-pro` | 0.022 | 0.66 | 1.98 |
| `deepseek-chat` / `deepseek-reasoner` | 0.028 | 0.28 | 0.42 |

Faixa peak = 2x os valores acima (exceto chat/reasoner, tabela fixa; ajuste em
`config.prices` se a sua conta tiver preço diferente).

## Instalação

Direto deste repositório (recomendado: é só JavaScript, sem build nem script de
instalação, então não precisa autorizar nada):

```
dsh plugin --profile desktop add github:MarceloNGVargas/DSH-Cost
```

Outras formas:

```
dsh plugin --profile desktop add "github:MarceloNGVargas/DSH-Cost#v1.0.0"   # versão fixada
pnpm pack                                                    # gera dsh-session-cost-monitor-1.0.0.tgz
dsh plugin --profile desktop add ./dsh-session-cost-monitor-1.0.0.tgz
```

O `.tgz` também está anexado na
[release](https://github.com/MarceloNGVargas/DSH-Cost/releases/latest).

Também funciona pela interface: página **Plugins** da barra lateral, ou a ferramenta
`plugin_manager` → `install_bundle` com o spec escolhido.

Depois de instalar, abra o monitor com `app\abrir-monitor.cmd` e use o comando `/custo`
no chat. Para remover: `dsh plugin --profile desktop remove dsh-session-cost-monitor`
(ou `plugin_manager` → `remove_bundle`).

## Publicação

Este pacote é um **bundle** no sentido oficial do DSH (declara `dsh.bundle.patch`) e é
distribuído por **git**, sem depender de registry. O **monorepo oficial não recebe plugins de
terceiros** — a documentação do projeto orienta npm, tarball ou git; aqui usamos git + release:

```sh
pnpm pack --dry-run                      # confere o conteúdo do pacote
git tag v1.0.0 && git push origin v1.0.0
gh release create v1.0.0 ./dsh-session-cost-monitor-1.0.0.tgz --generate-notes
```

Quem instala:

```sh
dsh plugin --profile desktop add github:MarceloNGVargas/DSH-Cost
dsh plugin --profile desktop add "github:MarceloNGVargas/DSH-Cost#v1.0.0"   # versão fixada
```

O nome `dsh-session-cost-monitor` continua livre no npm, caso um dia valha publicar lá
(a conta npm exige 2FA com bypass por token granular para publicar).

Os campos `repository`, `bugs`, `homepage` e `author` já apontam para este repositório.
O pacote é MIT — veja [LICENSE](LICENSE).

## Testes

```
node test/smoke.mjs
```

Cobre cálculo de custo (peak/off-peak/cache hit/miss, com `inputTokens` = miss),
janela peak UTC, medição de um stream simulado (duração e TTFT), persistência em
disco, o snapshot `live.json` consumido pelo app, os quatro modos do comando e a
mesclagem de configuração.

O agregador também aceita execução única, útil para depurar:

```
node app/monitor.mjs --once
```

## Limitações

- Os valores são **estimativas de tabela**: descontos, créditos, impostos e
  feriados chineses não são modelados.
- Requisições feitas com o plugin desligado (ou antes da instalação) não entram
  no relatório.
- `inputTokens` é o **cache miss**: semântica confirmada no adapter DeepSeek,
  `totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`.
  O total de entrada exibido soma `inputTokens` + `cacheReadTokens` + `cacheWriteTokens`.
- O Custo é sempre **recalculado na leitura** com a tabela atual: ajustar preços
  no `cordis.patch.yml` corrige também as requisições já medidas (no comando e no app).
- A seção "EM ANDAMENTO" do app depende de o plugin recarregado marcar a chamada
  em curso; até reiniciar o app DSH o agregador apenas preserva esse campo.
