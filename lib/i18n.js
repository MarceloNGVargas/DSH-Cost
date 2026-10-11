/**
 * Traduções do dsh-session-cost-monitor.
 *
 * Idiomas incluídos: pt-BR (base), en, es, zh-CN. `resolveLanguage()` decide o
 * idioma quando a config pede `auto`: variável de ambiente (`DSH_LOCALE`),
 * preferência do sistema, depois inglês. Para acrescentar um idioma, copie o
 * bloco de `pt-BR` e registre a chave em `DICTIONARIES`.
 *
 * @module dsh-session-cost-monitor/i18n
 */

/** Idiomas suportados, com rótulo legível. */
export const LANGUAGES = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
  es: 'Español',
  'zh-CN': '简体中文',
};

const DICTIONARIES = {
  'pt-BR': {
    commandDescription: 'Mostra tempo por requisição e custo de tokens (US$ e R$) da sessão',
    help: [
      'Uso: /custo [json|cotacao|reset|help]',
      '',
      '/custo            resumo da sessão + tabela por requisição (USD e BRL)',
      '/custo json       mesmos dados em JSON',
      '/custo cotacao    força a atualização da cotação USD/BRL de hoje',
      '/custo reset      zera os dados medidos da sessão atual',
    ],
    nothingMeasured: 'Nenhuma requisição de modelo medida nesta sessão ainda.',
    sendMessage: 'Envie uma mensagem ao agente e rode /custo de novo.',
    resetDone: 'Dados de custo da sessão atual foram zerados.',
    fxUnavailable: 'Não foi possível obter a cotação do dólar agora (provedores: awesomeapi e open.er-api). Tente de novo em alguns instantes.',
    fxLine: 'Cotação USD/BRL ({0}{1}{2}): R$ {3}',
    fxFromCache: ', valor de cache',
    reportTitle: '## Custo e tempo da sessão',
    session: '- Sessão: `{0}`',
    measured: '- Requisições medidas: {0}',
    withErrors: ' ({0} com erro)',
    models: '- Modelos: {0}',
    totalTime: '- Tempo total de chamadas: {0}',
    tableHead: '| # | hora | modelo | esforço | tempo | ttft | miss | cache hit | saída | US$ | R$ |',
    tableSep: '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    totals: '### Totais',
    inputTokens: '- Tokens de entrada: {0} (miss: {1}, cache hit: {2}, cache write: {3})',
    outputTokens: '- Tokens de saída: {0}',
    allTokens: '- Tokens no total: {0}',
    costUsd: '- Custo em dólar: US$ {0}',
    costBrl: '- Custo em real: R$ {0}',
    fxRate: '- Cotação do dólar ({0}{1}{2}): R$ {3}',
    costSplitUsd: '- Custo de entrada (tokens de entrada): US$ {0} · custo de saída (tokens gerados): US$ {1}',
    costSplitBoth: '- Custo de entrada: US$ {0} (R$ {1}) · custo de saída: US$ {2} (R$ {3})',
    savings: '- Economia com cache: US$ {0}',
    savingsBoth: '- Economia com cache: US$ {0} (R$ {1})',
    fxUnavailableShort: '- Cotação do dólar indisponível agora; valor em real não calculado.',
    band: '- Faixa de preço vigente: {0} — {1}',
    bandPeak: 'peak (2x)',
    bandOffPeak: 'off-peak',
    bandPolicyPeak: 'forçado em `config.peakPolicy: peak`',
    bandPolicyOffPeak: 'forçado em `config.peakPolicy: off-peak`',
    bandPolicyAuto: 'peak = 01:00-04:00 e 06:00-10:00 UTC em dias úteis',
    footer: '_Preços de tabela (USD/1M tokens) e cotação do dia; valores aproximados para controle de gasto._',
    error: 'erro',
    unknown: 'desconhecido',
  },
  en: {
    commandDescription: 'Shows per-request time and token cost (USD and BRL) for the session',
    help: [
      'Usage: /custo [json|cotacao|reset|help]',
      '',
      '/custo            session summary + per-request table (USD and BRL)',
      '/custo json       the same data as JSON',
      '/custo cotacao    forces a refresh of today USD/BRL rate',
      '/custo reset      clears the measured data of the current session',
    ],
    nothingMeasured: 'No model request measured in this session yet.',
    sendMessage: 'Send a message to the agent and run /custo again.',
    resetDone: 'The cost data of the current session was cleared.',
    fxUnavailable: 'Could not fetch the USD/BRL rate now (providers: awesomeapi and open.er-api). Try again in a moment.',
    fxLine: 'USD/BRL rate ({0}{1}{2}): R$ {3}',
    fxFromCache: ', cached value',
    reportTitle: '## Session cost and time',
    session: '- Session: `{0}`',
    measured: '- Measured requests: {0}',
    withErrors: ' ({0} with errors)',
    models: '- Models: {0}',
    totalTime: '- Total model time: {0}',
    tableHead: '| # | time | model | effort | duration | ttft | miss | cache hit | output | USD | BRL |',
    tableSep: '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    totals: '### Totals',
    inputTokens: '- Input tokens: {0} (miss: {1}, cache hit: {2}, cache write: {3})',
    outputTokens: '- Output tokens: {0}',
    allTokens: '- Total tokens: {0}',
    costUsd: '- Cost in USD: US$ {0}',
    costBrl: '- Cost in BRL: R$ {0}',
    fxRate: '- USD/BRL rate ({0}{1}{2}): R$ {3}',
    costSplitUsd: '- Input cost (input tokens): US$ {0} · output cost (generated tokens): US$ {1}',
    costSplitBoth: '- Input cost: US$ {0} (R$ {1}) · output cost: US$ {2} (R$ {3})',
    savings: '- Cache savings: US$ {0}',
    savingsBoth: '- Cache savings: US$ {0} (R$ {1})',
    fxUnavailableShort: '- USD/BRL rate unavailable now; BRL value not computed.',
    band: '- Current price band: {0} — {1}',
    bandPeak: 'peak (2x)',
    bandOffPeak: 'off-peak',
    bandPolicyPeak: 'forced by `config.peakPolicy: peak`',
    bandPolicyOffPeak: 'forced by `config.peakPolicy: off-peak`',
    bandPolicyAuto: 'peak = 01:00-04:00 and 06:00-10:00 UTC on weekdays',
    footer: '_List prices (USD/1M tokens) and the daily FX rate; approximate values for spend control._',
    error: 'error',
    unknown: 'unknown',
  },
  es: {
    commandDescription: 'Muestra el tiempo por petición y el costo de tokens (USD y BRL) de la sesión',
    help: [
      'Uso: /custo [json|cotacao|reset|help]',
      '',
      '/custo            resumen de la sesión + tabla por petición (USD y BRL)',
      '/custo json       los mismos datos en JSON',
      '/custo cotacao    fuerza la actualización del tipo de cambio USD/BRL de hoy',
      '/custo reset      borra los datos medidos de la sesión actual',
    ],
    nothingMeasured: 'Todavía no se midió ninguna petición de modelo en esta sesión.',
    sendMessage: 'Envía un mensaje al agente y ejecuta /custo de nuevo.',
    resetDone: 'Los datos de costo de la sesión actual se borraron.',
    fxUnavailable: 'No se pudo obtener el tipo de cambio USD/BRL ahora (proveedores: awesomeapi y open.er-api). Inténtalo de nuevo en unos instantes.',
    fxLine: 'Tipo de cambio USD/BRL ({0}{1}{2}): R$ {3}',
    fxFromCache: ', valor en caché',
    reportTitle: '## Costo y tiempo de la sesión',
    session: '- Sesión: `{0}`',
    measured: '- Peticiones medidas: {0}',
    withErrors: ' ({0} con error)',
    models: '- Modelos: {0}',
    totalTime: '- Tiempo total de llamadas: {0}',
    tableHead: '| # | hora | modelo | esfuerzo | tiempo | ttft | miss | cache hit | salida | USD | BRL |',
    tableSep: '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    totals: '### Totales',
    inputTokens: '- Tokens de entrada: {0} (miss: {1}, cache hit: {2}, cache write: {3})',
    outputTokens: '- Tokens de salida: {0}',
    allTokens: '- Tokens en total: {0}',
    costUsd: '- Costo en dólares: US$ {0}',
    costBrl: '- Costo en reales: R$ {0}',
    fxRate: '- Tipo de cambio USD/BRL ({0}{1}{2}): R$ {3}',
    costSplitUsd: '- Costo de entrada (tokens de entrada): US$ {0} · costo de salida (tokens generados): US$ {1}',
    costSplitBoth: '- Costo de entrada: US$ {0} (R$ {1}) · costo de salida: US$ {2} (R$ {3})',
    savings: '- Ahorro por caché: US$ {0}',
    savingsBoth: '- Ahorro por caché: US$ {0} (R$ {1})',
    fxUnavailableShort: '- Tipo de cambio USD/BRL no disponible; no se calculó el valor en reales.',
    band: '- Franja de precio vigente: {0} — {1}',
    bandPeak: 'peak (2x)',
    bandOffPeak: 'off-peak',
    bandPolicyPeak: 'forzado por `config.peakPolicy: peak`',
    bandPolicyOffPeak: 'forzado por `config.peakPolicy: off-peak`',
    bandPolicyAuto: 'peak = 01:00-04:00 y 06:00-10:00 UTC en días laborables',
    footer: '_Precios de lista (USD/1M tokens) y tipo de cambio del día; valores aproximados para controlar el gasto._',
    error: 'error',
    unknown: 'desconocido',
  },
  'zh-CN': {
    commandDescription: '显示当前会话每次请求的耗时与令牌费用（美元和雷亚尔）',
    help: [
      '用法: /custo [json|cotacao|reset|help]',
      '',
      '/custo            会话汇总 + 每次请求明细（美元 / 雷亚尔）',
      '/custo json       以 JSON 返回同样的数据',
      '/custo cotacao    强制刷新当日 USD/BRL 汇率',
      '/custo reset      清除当前会话的统计',
    ],
    nothingMeasured: '本会话尚未测量到任何模型请求。',
    sendMessage: '请先给智能体发送一条消息，再运行 /custo。',
    resetDone: '当前会话的费用数据已清除。',
    fxUnavailable: '暂时无法获取美元汇率（数据源：awesomeapi、open.er-api）。请稍后重试。',
    fxLine: 'USD/BRL 汇率（{0}{1}{2}）：R$ {3}',
    fxFromCache: '，缓存值',
    reportTitle: '## 会话费用与耗时',
    session: '- 会话: `{0}`',
    measured: '- 已测量请求: {0}',
    withErrors: '（{0} 个错误）',
    models: '- 模型: {0}',
    totalTime: '- 模型调用总耗时: {0}',
    tableHead: '| # | 时间 | 模型 | 思考强度 | 耗时 | 首字 | 未命中 | 缓存命中 | 输出 | USD | BRL |',
    tableSep: '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    totals: '### 合计',
    inputTokens: '- 输入令牌: {0}（未命中: {1}，缓存命中: {2}，缓存写入: {3}）',
    outputTokens: '- 输出令牌: {0}',
    allTokens: '- 令牌总计: {0}',
    costUsd: '- 费用（美元）: US$ {0}',
    costBrl: '- 费用（雷亚尔）: R$ {0}',
    fxRate: '- USD/BRL 汇率（{0}{1}{2}）：R$ {3}',
    costSplitUsd: '- 输入费用: US$ {0} · 输出费用: US$ {1}',
    costSplitBoth: '- 输入费用: US$ {0}（R$ {1}）· 输出费用: US$ {2}（R$ {3}）',
    savings: '- 缓存节省: US$ {0}',
    savingsBoth: '- 缓存节省: US$ {0}（R$ {1}）',
    fxUnavailableShort: '- 暂时无法获取美元汇率，未计算雷亚尔金额。',
    band: '- 当前价格时段: {0} — {1}',
    bandPeak: '高峰（2 倍）',
    bandOffPeak: '空闲',
    bandPolicyPeak: '由 `config.peakPolicy: peak` 强制',
    bandPolicyOffPeak: '由 `config.peakPolicy: off-peak` 强制',
    bandPolicyAuto: '高峰 = 工作日 01:00-04:00 与 06:00-10:00 UTC',
    footer: '_按官方价目表（美元/百万令牌）与当日汇率估算，仅用于费用控制。_',
    error: '错误',
    unknown: '未知',
  },
};

/** Normaliza um id de idioma para uma chave registrada (ex.: `pt` → `pt-BR`). */
export function normalizeLanguage(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const raw = value.trim();
  const exact = Object.keys(DICTIONARIES).find((key) => key.toLowerCase() === raw.toLowerCase());
  if (exact !== undefined) return exact;
  const primary = raw.split(/[-_]/)[0].toLowerCase();
  if (primary === 'pt') return 'pt-BR';
  if (primary === 'zh') return 'zh-CN';
  const byPrimary = Object.keys(DICTIONARIES).find((key) => key.split('-')[0].toLowerCase() === primary);
  return byPrimary ?? null;
}

/**
 * Escolhe o idioma efetivo: config explícita, `DSH_LOCALE`, idioma do sistema,
 * por fim inglês.
 * @param {string} [configured] valor de `config.language` (`auto` para detectar).
 * @returns {string} chave de idioma registrada.
 */
export function resolveLanguage(configured) {
  const explicit = typeof configured === 'string' && configured.toLowerCase() !== 'auto' ? normalizeLanguage(configured) : null;
  if (explicit !== null) return explicit;
  const fromEnv = normalizeLanguage(process.env.DSH_LOCALE ?? process.env.DSH_LANG ?? process.env.LANG);
  if (fromEnv !== null) return fromEnv;
  try {
    const system = normalizeLanguage(Intl.DateTimeFormat().resolvedOptions().locale);
    if (system !== null) return system;
  } catch {
    // sem Intl: cai no inglês
  }
  return 'en';
}

/**
 * Cria o tradutor de um idioma.
 * @param {string} [configured] valor de `config.language`.
 * @returns {{ language: string, t: (key: string, ...args: unknown[]) => string, has: (key: string) => boolean }}
 */
export function createTranslator(configured) {
  const language = resolveLanguage(configured);
  const dictionary = DICTIONARIES[language] ?? DICTIONARIES.en;
  const fallback = DICTIONARIES.en;
  const t = (key, ...args) => {
    const entry = dictionary[key] ?? fallback[key] ?? key;
    if (Array.isArray(entry)) return entry.join('\n');
    return args.length === 0 ? entry : entry.replace(/\{(\d+)\}/g, (match, index) => String(args[Number(index)] ?? match));
  };
  return { language, t, has: (key) => Object.prototype.hasOwnProperty.call(dictionary, key) };
}
