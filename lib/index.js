/**
 * Medidor de custo e latência por requisição de modelo, por sessão.
 *
 * Escuta o waterfall `llm/stream` e mede, para CADA chamada de modelo:
 *   - duração total (wall clock) e tempo até o primeiro chunk (TTFT);
 *   - tokens de entrada, saída, cache hit e cache write;
 *   - custo em USD pela tabela de preços (peak/off-peak) e em BRL pela
 *     cotação do dólar do dia (buscada na web e cacheada em disco).
 *
 * Expõe o comando `/custo` (e o alias `/cost`) no chat: o usuário dispara
 * quando quiser e recebe o resumo da sessão mais a tabela requisição a
 * requisição. Também há `/custo json`, `/custo cotacao`, `/custo reset`.
 *
 * O plugin não importa nenhum pacote do DSH: só builtins do Node, o que o
 * mantém instalável em qualquer perfil sem dependências extras.
 *
 * @module dsh-session-cost
 */
import { promises as fs } from 'node:fs';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTranslator, resolveLanguage } from './i18n.js';

const name = 'session-cost';
const inject = ['commands'];

const PER_MILLION = 1_000_000;

/**
 * Preços oficiais em USD por 1M tokens (api-docs.deepseek.com/quick_start/pricing).
 * `peak` vale 2x `offPeak`; horário peak: 01:00-04:00 e 06:00-10:00 UTC, Mon-Fri,
 * exceto feriados chineses. Sobrescreva via `config.prices` no patch do perfil.
 */
const DEFAULT_PRICES = {
  'deepseek-flash': {
    cacheHit: { offPeak: 0.003, peak: 0.006 },
    cacheMiss: { offPeak: 0.15, peak: 0.3 },
    output: { offPeak: 0.6, peak: 1.2 },
  },
  'deepseek-v4-pro': {
    cacheHit: { offPeak: 0.022, peak: 0.044 },
    cacheMiss: { offPeak: 0.66, peak: 1.32 },
    output: { offPeak: 1.98, peak: 3.96 },
  },
  'deepseek-chat': {
    cacheHit: { offPeak: 0.028, peak: 0.028 },
    cacheMiss: { offPeak: 0.28, peak: 0.28 },
    output: { offPeak: 0.42, peak: 0.42 },
  },
  'deepseek-reasoner': {
    cacheHit: { offPeak: 0.028, peak: 0.028 },
    cacheMiss: { offPeak: 0.28, peak: 0.28 },
    output: { offPeak: 0.42, peak: 0.42 },
  },
  default: {
    cacheHit: { offPeak: 0.003, peak: 0.006 },
    cacheMiss: { offPeak: 0.15, peak: 0.3 },
    output: { offPeak: 0.6, peak: 1.2 },
  },
};

const FX_PROVIDERS = [
  {
    name: 'awesomeapi',
    url: 'https://economia.awesomeapi.com.br/last/USD-BRL',
    pick: (json) => Number(json?.USDBRL?.bid ?? json?.USDBRL?.ask),
  },
  {
    name: 'open.er-api',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick: (json) => Number(json?.rates?.BRL),
  },
];



// ---------------------------------------------------------------------------
// utilidades numéricas e de data
// ---------------------------------------------------------------------------

/** Número finito ou 0. */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Aplica o teto de precisão usado na exibição monetária. */
function money(value, smallDigits = 6, bigDigits = 4) {
  const v = num(value);
  if (Math.abs(v) < 0.01) return v.toFixed(smallDigits);
  return v.toFixed(bigDigits);
}

/** Data local no formato YYYY-MM-DD. */
function localDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Hora local HH:MM:SS. */
function localTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** true dentro das janelas peak (UTC) da DeepSeek. */
function isPeakUtc(ts) {
  const d = new Date(ts);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = d.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/** Faixa de preço efetiva para um instante, conforme `peakPolicy`. */
function resolveBand(peakPolicy, ts) {
  if (peakPolicy === 'peak') return true;
  if (peakPolicy === 'off-peak') return false;
  return isPeakUtc(ts);
}

/** Lê uma taxa de preço aceitando número puro ou { peak, offPeak }. */
function readRate(entry, peak) {
  if (typeof entry === 'number') return entry;
  if (!entry || typeof entry !== 'object') return 0;
  return peak ? num(entry.peak ?? entry.offPeak) : num(entry.offPeak ?? entry.peak);
}

/** Normaliza uma sobrescrita de preço: número vira a mesma taxa nas duas faixas. */
function mergeRate(base, override) {
  if (override === undefined || override === null) return base;
  if (typeof override === 'number') return { offPeak: override, peak: override };
  if (typeof override === 'object') return { ...(base && typeof base === 'object' ? base : {}), ...override };
  return base;
}

/** Soma dois acumuladores de usage. */
function addUsage(total, usage) {
  if (!usage || typeof usage !== 'object') return total;
  const base = total ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
  return {
    inputTokens: base.inputTokens + num(usage.inputTokens),
    outputTokens: base.outputTokens + num(usage.outputTokens),
    cacheReadTokens: base.cacheReadTokens + num(usage.cacheReadTokens),
    cacheWriteTokens: base.cacheWriteTokens + num(usage.cacheWriteTokens),
    reasoningTokens: base.reasoningTokens + num(usage.reasoningTokens),
  };
}

/**
 * Calcula o custo de um usage.
 * Semântica do adapter DeepSeek (confirmada em dsh-llm-deepseek):
 * `totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`,
 * ou seja `inputTokens` são os tokens de entrada NÃO cacheados (cache miss) e as
 * leituras/escritas de cache são contadas à parte.
 */
function computeCost(price, usage, ts, peakPolicy) {
  const peak = resolveBand(peakPolicy, ts);
  const missTokens = num(usage?.inputTokens);
  const outputTokens = num(usage?.outputTokens);
  const cacheReadTokens = num(usage?.cacheReadTokens);
  const cacheWriteTokens = num(usage?.cacheWriteTokens);
  const cacheWriteRate = price.cacheWrite ? readRate(price.cacheWrite, peak) : readRate(price.cacheMiss, peak);
  const missRate = readRate(price.cacheMiss, peak);
  const hitRate = readRate(price.cacheHit, peak);
  const inputCostUsd =
    (missTokens / PER_MILLION) * missRate +
    (cacheReadTokens / PER_MILLION) * hitRate +
    (cacheWriteTokens / PER_MILLION) * cacheWriteRate;
  const outputCostUsd = (outputTokens / PER_MILLION) * readRate(price.output, peak);
  const costUsd = inputCostUsd + outputCostUsd;
  // Quanto esses tokens de cache deixaram de custar por não virem como miss.
  const savingsUsd = Math.max(0, (cacheReadTokens / PER_MILLION) * (missRate - hitRate));
  return {
    costUsd,
    inputCostUsd,
    outputCostUsd,
    savingsUsd,
    peak,
    missTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    inputTotalTokens: missTokens + cacheReadTokens + cacheWriteTokens,
  };
}

/** Seleciona a tabela de preços do modelo (aceita `model` ou `provider/model`). */
function priceFor(prices, provider, model) {
  const table = prices ?? DEFAULT_PRICES;
  return table[`${provider}/${model}`] ?? table[model] ?? table.default ?? DEFAULT_PRICES.default;
}

/**
 * Custo recalculado na leitura: assim a tabela de preços configurada sempre
 * manda, inclusive para requisições medidas antes de um ajuste de preço.
 */
function entryCost(cfg, entry) {
  const price = priceFor(cfg?.prices, entry.provider, entry.model);
  return computeCost(price, entry.usage, entry.at, cfg?.peakPolicy ?? 'auto');
}

function entryCostUsd(cfg, entry) {
  return entryCost(cfg, entry).costUsd;
}

// ---------------------------------------------------------------------------
// configuração
// ---------------------------------------------------------------------------

function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return path.join(os.homedir(), '.dsh');
}

/** Mescla a config do patch com os defaults defensivos. */
function resolveConfig(config) {
  const raw = config && typeof config === 'object' ? config : {};
  const rawFx = raw.fx && typeof raw.fx === 'object' ? raw.fx : {};
  const prices = {};
  for (const [key, value] of Object.entries(DEFAULT_PRICES)) prices[key] = value;
  if (raw.prices && typeof raw.prices === 'object') {
    for (const [key, value] of Object.entries(raw.prices)) {
      const base = prices[key] ?? prices.default;
      const override = value && typeof value === 'object' ? value : {};
      prices[key] = {
        cacheHit: mergeRate(base.cacheHit, override.cacheHit),
        cacheMiss: mergeRate(base.cacheMiss, override.cacheMiss),
        output: mergeRate(base.output, override.output),
        ...(override.cacheWrite ? { cacheWrite: mergeRate(base.cacheWrite, override.cacheWrite) } : {}),
      };
    }
  }
  const aliases = Array.isArray(raw.aliasCommands)
    ? raw.aliasCommands.filter((item) => typeof item === 'string' && item.length > 0)
    : ['cost'];
  const translator = createTranslator(raw.language);
  return {
    language: translator.language,
    t: translator.t,
    commandName: typeof raw.commandName === 'string' && raw.commandName.length > 0 ? raw.commandName : 'custo',
    aliasCommands: aliases,
    storeDir: typeof raw.storeDir === 'string' && raw.storeDir.length > 0 ? raw.storeDir : path.join(dshHome(), 'session-cost'),
    persist: raw.persist !== false,
    maxRequestsPerSession: Number.isFinite(raw.maxRequestsPerSession) ? Math.max(10, raw.maxRequestsPerSession) : 500,
    peakPolicy: raw.peakPolicy === 'peak' || raw.peakPolicy === 'off-peak' ? raw.peakPolicy : 'auto',
    prices,
    fx: {
      providers: FX_PROVIDERS,
      cacheHours: Number.isFinite(rawFx.cacheHours) ? Math.max(0, rawFx.cacheHours) : 6,
      timeoutMs: Number.isFinite(rawFx.timeoutMs) ? Math.max(1000, rawFx.timeoutMs) : 8000,
      url: typeof rawFx.url === 'string' && rawFx.url.length > 0 ? rawFx.url : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// persistência
// ---------------------------------------------------------------------------

function safeReadJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function safeWriteJson(file, value) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    // escrita atômica: o app visual pode ler o arquivo a qualquer momento
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), 'utf8');
    renameSync(temporary, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guarda em memória os registros por sessão e persiste em disco com debounce,
 * para que o medidor sobreviva a recarregamento do plugin (HMR) e reinício.
 */
function createStore(cfg) {
  const sessions = new Map();
  const dirty = new Set();
  let timer = null;

  const fileFor = (sessionId) => path.join(cfg.storeDir, 'sessions', `${encodeURIComponent(sessionId)}.json`);
  const fxFile = () => path.join(cfg.storeDir, 'fx.json');
  const liveFile = () => path.join(cfg.storeDir, 'live.json');

  function flushNow() {
    if (!cfg.persist) return;
    for (const sessionId of dirty) {
      const bucket = sessions.get(sessionId);
      if (bucket) safeWriteJson(fileFor(sessionId), { version: 1, sessionId, requests: bucket.requests });
    }
    dirty.clear();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedulePersist(sessionId) {
    if (!cfg.persist) return;
    dirty.add(sessionId);
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      flushNow();
    }, 1500);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function session(sessionId) {
    let bucket = sessions.get(sessionId);
    if (!bucket) {
      const stored = cfg.persist ? safeReadJson(fileFor(sessionId)) : undefined;
      bucket = { sessionId, requests: Array.isArray(stored?.requests) ? stored.requests : [] };
      sessions.set(sessionId, bucket);
    }
    return bucket;
  }

  return {
    session,
    record(sessionId, entry) {
      const bucket = session(sessionId);
      bucket.requests.push(entry);
      if (bucket.requests.length > cfg.maxRequestsPerSession) {
        bucket.requests.splice(0, bucket.requests.length - cfg.maxRequestsPerSession);
      }
      schedulePersist(sessionId);
    },
    reset(sessionId) {
      sessions.set(sessionId, { sessionId, requests: [] });
      dirty.add(sessionId);
      flushNow();
    },
    readFx: () => (cfg.persist ? safeReadJson(fxFile()) : undefined),
    writeFx: (value) => {
      if (cfg.persist) safeWriteJson(fxFile(), value);
    },
    /** Nome de exibição por rota (`provider/model`), vindo do catálogo do adapter. */
    readModelNames: () => (cfg.persist ? safeReadJson(path.join(cfg.storeDir, 'model-names.json')) : undefined),
    writeModelNames: (value) => {
      if (cfg.persist) safeWriteJson(path.join(cfg.storeDir, 'model-names.json'), value);
    },
    /** YYYY-MM-DD/1: snapshot consumido pelo app visual. */
    writeLive: (value) => {
      if (cfg.persist) safeWriteJson(liveFile(), value);
    },
    liveFile,
    allSessions: () => [...sessions.values()],
    /** Carrega os arquivos de sessão já existentes (usado no boot do plugin). */
    loadAll() {
      if (!cfg.persist) return;
      let names = [];
      try {
        names = readdirSync(path.join(cfg.storeDir, 'sessions'));
      } catch {
        return;
      }
      for (const entry of names) {
        if (!entry.endsWith('.json')) continue;
        const stored = safeReadJson(path.join(cfg.storeDir, 'sessions', entry));
        if (stored === undefined || typeof stored.sessionId !== 'string') continue;
        if (sessions.has(stored.sessionId)) continue;
        sessions.set(stored.sessionId, {
          sessionId: stored.sessionId,
          requests: Array.isArray(stored.requests) ? stored.requests : [],
        });
      }
    },
    flushNow,
    fxFile,
  };
}

// ---------------------------------------------------------------------------
// cotação USD -> BRL
// ---------------------------------------------------------------------------

async function fetchFx(cfg, store, { force = false } = {}) {
  const now = Date.now();
  const cached = store.readFx();
  const ageMs = cached?.fetchedAt ? now - cached.fetchedAt : Number.POSITIVE_INFINITY;
  const fresh = Boolean(cached) && (cfg.fx.cacheHours * 3600_000 === 0 ? false : ageMs < cfg.fx.cacheHours * 3600_000);
  if (!force && fresh) return { ...cached, cached: true };

  const providers = cfg.fx.url
    ? [{ name: 'custom', url: cfg.fx.url, pick: (json) => Number(json?.USDBRL?.bid ?? json?.rates?.BRL ?? json?.rate) }, ...FX_PROVIDERS]
    : FX_PROVIDERS;

  for (const provider of providers) {
    try {
      const response = await fetch(provider.url, { signal: AbortSignal.timeout(cfg.fx.timeoutMs) });
      if (!response.ok) continue;
      const rate = provider.pick(await response.json());
      if (Number.isFinite(rate) && rate > 0) {
        const value = { rate, source: provider.name, fetchedAt: now, date: localDate(now), cached: false };
        store.writeFx(value);
        return value;
      }
    } catch {
      // tenta o próximo provedor
    }
  }

  if (cached && Number.isFinite(cached.rate)) return { ...cached, cached: true, stale: true };
  return { rate: null, source: null, fetchedAt: null, date: localDate(now), cached: false, unavailable: true };
}

// ---------------------------------------------------------------------------
// formatação do relatório
// ---------------------------------------------------------------------------

function totalsOf(requests, cfg) {
  const totals = {
    requests: requests.length,
    durationMs: 0,
    tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, inputTotalTokens: 0 },
    costUsd: 0,
    costInputUsd: 0,
    costOutputUsd: 0,
    savingsUsd: 0,
    models: new Set(),
    errors: 0,
  };
  for (const entry of requests) {
    totals.durationMs += num(entry.durationMs);
    totals.tokens.inputTokens += num(entry.usage?.inputTokens);
    totals.tokens.outputTokens += num(entry.usage?.outputTokens);
    totals.tokens.cacheReadTokens += num(entry.usage?.cacheReadTokens);
    totals.tokens.cacheWriteTokens += num(entry.usage?.cacheWriteTokens);
    totals.tokens.inputTotalTokens +=
      num(entry.usage?.inputTokens) + num(entry.usage?.cacheReadTokens) + num(entry.usage?.cacheWriteTokens);
    totals.models.add(entry.model ?? 'desconhecido');
    if (entry.error) totals.errors += 1;
    const parts = entryCost(cfg, entry);
    totals.costUsd += parts.costUsd;
    totals.costInputUsd += parts.inputCostUsd;
    totals.costOutputUsd += parts.outputCostUsd;
    totals.savingsUsd += parts.savingsUsd;
  }
  return totals;
}

function renderReport(cfg, sessionId, requests, fx) {
  const t = cfg.t ?? ((key) => key);
  if (requests.length === 0) {
    return [t('nothingMeasured'), t('sendMessage')].join('\n');
  }
  const totals = totalsOf(requests, cfg);
  const rate = Number.isFinite(fx?.rate) ? fx.rate : null;
  const lines = [];
  lines.push(t('reportTitle'));
  lines.push('');
  lines.push(t('session', sessionId));
  lines.push(t('measured', totals.requests) + (totals.errors > 0 ? t('withErrors', totals.errors) : ''));
  lines.push(t('models', [...totals.models].map((m) => `\`${m}\``).join(', ')));
  lines.push(t('totalTime', formatDuration(totals.durationMs)));
  lines.push('');
  lines.push(t('tableHead'));
  lines.push(t('tableSep'));
  requests.forEach((entry, index) => {
    const costUsd = entryCostUsd(cfg, entry);
    const costBrl = rate === null ? null : costUsd * rate;
    lines.push(
      `| ${index + 1} | ${localTime(entry.at)} | ${entry.model ?? '?'}${entry.purpose ? ` (${entry.purpose})` : ''} | ` +
        `${entry.reasoningEffort ?? '—'} | ` +
        `${formatDuration(entry.durationMs)} | ${entry.ttftMs === null || entry.ttftMs === undefined ? '—' : formatDuration(entry.ttftMs)} | ` +
        `${num(entry.usage?.inputTokens)} | ${num(entry.usage?.cacheReadTokens)} | ${num(entry.usage?.outputTokens)} | ` +
        `${entry.error ? t('error') : money(costUsd)} | ${costBrl === null ? '—' : money(costBrl)} |`,
    );
  });
  lines.push('');
  lines.push(t('totals'));
  lines.push('');
  lines.push(
    t(
      'inputTokens',
      totals.tokens.inputTotalTokens,
      totals.tokens.inputTokens,
      totals.tokens.cacheReadTokens,
      totals.tokens.cacheWriteTokens,
    ),
  );
  lines.push(t('outputTokens', totals.tokens.outputTokens));
  lines.push(t('allTokens', totals.tokens.inputTotalTokens + totals.tokens.outputTokens));
  lines.push(t('costUsd', money(totals.costUsd)));
  if (rate === null) {
    lines.push(t('costSplitUsd', money(totals.costInputUsd), money(totals.costOutputUsd)));
    lines.push(t('fxUnavailableShort'));
    lines.push(t('savings', money(totals.savingsUsd)));
  } else {
    lines.push(t('fxRate', fx.date, fx.source ? `, ${fx.source}` : '', fx.stale ? t('fxFromCache') : '', rate.toFixed(4)));
    lines.push(t('costBrl', money(totals.costUsd * rate)));
    lines.push(
      t('costSplitBoth', money(totals.costInputUsd), money(totals.costInputUsd * rate), money(totals.costOutputUsd), money(totals.costOutputUsd * rate)),
    );
    lines.push(t('savingsBoth', money(totals.savingsUsd), money(totals.savingsUsd * rate)));
  }
  const peak = resolveBand(cfg.peakPolicy, Date.now());
  lines.push(t('band', peak ? t('bandPeak') : t('bandOffPeak'), describePeakPolicy(cfg)));
  lines.push('');
  lines.push(t('footer'));
  return lines.join('\n');
}

function describePeakPolicy(cfg) {
  const t = cfg?.t ?? ((key) => key);
  if (cfg?.peakPolicy === 'peak') return t('bandPolicyPeak');
  if (cfg?.peakPolicy === 'off-peak') return t('bandPolicyOffPeak');
  return t('bandPolicyAuto');
}

function formatDuration(ms) {
  const value = num(ms);
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(2)} s`;
  const minutes = Math.floor(value / 60_000);
  return `${minutes} min ${((value % 60_000) / 1000).toFixed(1)} s`;
}

// ---------------------------------------------------------------------------
// snapshot em tempo real (consumido pelo app visual)
// ---------------------------------------------------------------------------

/** Agrega uma lista de requisições, em USD e (quando há cotação) em BRL. */
function summarize(requests, fx, cfg) {
  const rate = Number.isFinite(fx?.rate) ? fx.rate : null;
  const models = new Set();
  let durationMs = 0;
  let costUsd = 0;
  let costInputUsd = 0;
  let costOutputUsd = 0;
  let savingsUsd = 0;
  let lastAt = 0;
  let firstAt = 0;
  let errors = 0;
  const tokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, inputTotalTokens: 0 };
  for (const entry of requests) {
    durationMs += num(entry.durationMs);
    if (cfg === undefined) {
      costUsd += num(entry.costUsd);
    } else {
      const parts = entryCost(cfg, entry);
      costUsd += parts.costUsd;
      costInputUsd += parts.inputCostUsd;
      costOutputUsd += parts.outputCostUsd;
      savingsUsd += parts.savingsUsd;
    }
    if (entry.at > lastAt) lastAt = entry.at;
    if (firstAt === 0 || entry.at < firstAt) firstAt = entry.at;
    if (entry.error) errors += 1;
    if (entry.model) models.add(entry.model);
    tokens.inputTokens += num(entry.usage?.inputTokens);
    tokens.outputTokens += num(entry.usage?.outputTokens);
    tokens.cacheReadTokens += num(entry.usage?.cacheReadTokens);
    tokens.cacheWriteTokens += num(entry.usage?.cacheWriteTokens);
    tokens.inputTotalTokens +=
      num(entry.usage?.inputTokens) + num(entry.usage?.cacheReadTokens) + num(entry.usage?.cacheWriteTokens);
  }
  return {
    requests: requests.length,
    durationMs,
    tokens,
    costUsd,
    costInputUsd,
    costOutputUsd,
    savingsUsd,
    costBrl: rate === null ? null : costUsd * rate,
    costInputBrl: rate === null ? null : costInputUsd * rate,
    costOutputBrl: rate === null ? null : costOutputUsd * rate,
    savingsBrl: rate === null ? null : savingsUsd * rate,
    lastAt: lastAt || null,
    firstAt: firstAt || null,
    errors,
    models: [...models],
  };
}

/** Histórico diário: um registro por dia (mais recente primeiro). */
function groupByDay(requests, fx, cfg, maxDays = 31) {
  const days = new Map();
  for (const entry of requests) {
    const key = localDate(entry.at);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(entry);
  }
  return [...days.entries()]
    .sort((left, right) => (left[0] < right[0] ? 1 : -1))
    .slice(0, maxDays)
    .map(([date, list]) => ({ date, ...summarize(list, fx, cfg) }));
}

/** Requisição individual com o valor convertido, para o cartão "última". */
function withBrl(entry, fx, cfg) {
  const rate = Number.isFinite(fx?.rate) ? fx.rate : null;
  const costUsd = cfg === undefined ? num(entry.costUsd) : entryCostUsd(cfg, entry);
  const parts = cfg === undefined ? null : entryCost(cfg, entry);
  const inputCostUsd = parts === null ? null : parts.inputCostUsd;
  const outputCostUsd = parts === null ? null : parts.outputCostUsd;
  const savingsUsd = parts === null ? null : parts.savingsUsd;
  return {
    at: entry.at,
    model: entry.model ?? null,
    provider: entry.provider ?? null,
    temperature: entry.temperature ?? null,
    reasoningEffort: entry.reasoningEffort ?? null,
    turn: entry.turn ?? null,
    step: entry.step ?? null,
    durationMs: num(entry.durationMs),
    ttftMs: entry.ttftMs ?? null,
    usage: entry.usage ?? null,
    costUsd,
    costInputUsd: inputCostUsd,
    costOutputUsd: outputCostUsd,
    savingsUsd,
    costBrl: rate === null ? null : costUsd * rate,
    costInputBrl: rate === null || inputCostUsd === null ? null : inputCostUsd * rate,
    costOutputBrl: rate === null || outputCostUsd === null ? null : outputCostUsd * rate,
    savingsBrl: rate === null || savingsUsd === null ? null : savingsUsd * rate,
    error: entry.error ?? null,
  };
}

/**
 * Monta o documento `live.json`: totais do dia, da sessão mais recente, da
 * sessão atual do chamador, a última requisição e as chamadas em andamento.
 * @param {object} cfg config resolvida.
 * @param {object} store store do plugin.
 * @param {object|null} fx cotação corrente.
 * @param {Map<string, object>} inflight chamadas em andamento.
 * @param {number} now instante de referência.
 * @param {{ titles?: Map<string, string>, modelNames?: Record<string, string>, selections?: Map<string, { model?: string|null, provider?: string|null, reasoningEffort?: string|null }> }} [extra]
 *        títulos de sessão (`sessionId` → nome), nomes de exibição por rota
 *        (`provider/model` → nome do catálogo) e a seleção de modelo/esforço em
 *        uso por sessão.
 */
function buildSnapshot(cfg, store, fx, inflight, now = Date.now(), extra = {}) {
  const today = localDate(now);
  const titles = extra.titles ?? null;
  const selections = extra.selections ?? null;
  const modelNames = extra.modelNames ?? store.readModelNames?.() ?? null;
  const buckets = store.allSessions().filter((bucket) => bucket.requests.length > 0);
  const all = buckets.flatMap((bucket) =>
    bucket.requests.map((entry) => ({ ...entry, sessionId: bucket.sessionId })),
  );
  const daily = all.filter((entry) => localDate(entry.at) === today);
  const sessions = buckets
    .map((bucket) => {
      const selection = selections?.get?.(bucket.sessionId) ?? null;
      return {
        sessionId: bucket.sessionId,
        title: titles?.get?.(bucket.sessionId) ?? bucket.title ?? null,
        reasoningEffort: selection?.reasoningEffort ?? null,
        lastModel: selection?.model ?? null,
        lastProvider: selection?.provider ?? null,
        ...summarize(bucket.requests, fx, cfg),
      };
    })
    .sort((left, right) => (right.lastAt ?? 0) - (left.lastAt ?? 0))
    .slice(0, 25);
  const last = all.reduce((acc, entry) => (acc === null || entry.at > acc.at ? entry : acc), null);
  const recent = [...all]
    .sort((left, right) => right.at - left.at)
    .slice(0, 20)
    .map((entry) => ({ sessionId: entry.sessionId, ...withBrl(entry, fx, cfg) }));

  // Custo das sessões REALMENTE em processamento agora: chamada de modelo em
  // curso (`inflight`) ou agente com turno aberto/ferramenta em execução
  // (`status` vindo do cache de projeção). Quando o processamento termina, a
  // sessão sai daqui automaticamente. Havendo mais de uma, o total é a soma.
  const inflightIds = [...inflight.values()]
    .map((item) => item?.sessionId)
    .filter((id) => typeof id === 'string' && id.length > 0);
  const statusIds =
    extra.status === undefined || extra.status === null
      ? []
      : [...extra.status.entries()].filter(([, value]) => value?.running === true).map(([id]) => id);
  const runningIds = [...new Set([...inflightIds, ...statusIds])];
  const runningSessions = runningIds.map(
    (id) =>
      sessions.find((session) => session.sessionId === id) ?? {
        sessionId: id,
        title: titles?.get?.(id) ?? null,
        reasoningEffort: null,
        lastModel: null,
        lastProvider: null,
        requests: 0,
        durationMs: 0,
        costUsd: 0,
        costBrl: null,
        costInputUsd: 0,
        costOutputUsd: 0,
        savingsUsd: 0,
        savingsBrl: null,
        tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, inputTotalTokens: 0 },
        models: [],
        firstAt: null,
        lastAt: null,
        errors: 0,
      },
  );
  const running = {
    sessionCount: runningIds.length,
    sessionIds: runningIds,
    // Uma linha por sessão em processamento, com o consumo acumulado de cada uma.
    sessions: runningSessions,
    ...summarize(
      all.filter((entry) => runningIds.includes(entry.sessionId)),
      fx,
      cfg,
    ),
  };
  return {
    version: 1,
    app: 'dsh-session-cost',
    updatedAt: now,
    fx: fx
      ? {
          rate: Number.isFinite(fx.rate) ? fx.rate : null,
          date: fx.date ?? localDate(now),
          source: fx.source ?? null,
          fetchedAt: fx.fetchedAt ?? null,
          stale: Boolean(fx.stale),
          unavailable: Boolean(fx.unavailable),
        }
      : null,
    modelNames: modelNames ?? {},
    today: { date: today, ...summarize(daily, fx, cfg) },
    totals: summarize(all, fx, cfg),
    running,
    daily: groupByDay(all, fx, cfg),
    sessions,
    activeSessionId: sessions.length > 0 ? sessions[0].sessionId : null,
    activeSessionTitle: sessions.length > 0 ? (sessions[0].title ?? null) : null,
    activeReasoningEffort: sessions.length > 0 ? (sessions[0].reasoningEffort ?? null) : null,
    activeModel: sessions.length > 0 ? (sessions[0].lastModel ?? null) : null,
    lastRequest: last === null ? null : { sessionId: last.sessionId, ...withBrl(last, fx, cfg) },
    recent,
    inflight: [...inflight.values()].map((item) => ({ ...item, elapsedMs: Math.max(0, now - item.startedAt) })),
    peak: resolveBand(cfg.peakPolicy, now),
    peakPolicy: cfg.peakPolicy,
  };
}

// ---------------------------------------------------------------------------
// plugin
// ---------------------------------------------------------------------------

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx contexto do plugin.
 * @param {Record<string, unknown>} config config declarada no patch do perfil.
 */
function apply(ctx, config) {
  const cfg = resolveConfig(config);
  const store = createStore(cfg);
  const pendingStep = new Map();
  const inflight = new Map();
  let fxState = store.readFx() ?? null;
  let pumpTimer = null;
  let fxInFlight = false;
  let lastFxAttempt = 0;
  let modelNames = store.readModelNames() ?? {};
  const modelNamesAsked = new Set();

  // Sessões já medidas antes desta carga ficam disponíveis para o app visual.
  store.loadAll();

  /**
   * Descobre o nome de exibição da rota (`provider/model`) no catálogo do
   * adapter e grava em `model-names.json` — uma consulta por provider.
   */
  function ensureModelNames(provider) {
    if (typeof provider !== 'string' || provider.length === 0) return;
    if (modelNamesAsked.has(provider)) return;
    modelNamesAsked.add(provider);
    const llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined;
    if (llm === undefined || llm === null || typeof llm.listModels !== 'function') return;
    Promise.resolve(llm.listModels(provider))
      .then((models) => {
        if (!Array.isArray(models)) return;
        let changed = false;
        const next = { ...modelNames };
        for (const model of models) {
          if (typeof model?.id !== 'string' || typeof model?.name !== 'string') continue;
          const key = `${provider}/${model.id}`;
          if (next[key] !== model.name) {
            next[key] = model.name;
            changed = true;
          }
        }
        if (changed) {
          modelNames = next;
          store.writeModelNames(modelNames);
          pumpSnapshot();
        }
      })
      .catch(() => {
        // catálogo indisponível: o app mostra provider/model e segue
      });
  }

  /**
   * Seleção de modelo e esforço de raciocínio em uso por sessão — o DSH guarda
   * em `modelSelection.val.lastUsed` (provider, model, reasoningEffort).
   */
  function readSelections(sessionIds) {
    const selections = new Map();
    const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
    const projections = typeof ctx.get === 'function' ? ctx.get('sessionProjections') : undefined;
    if (sessions === undefined || sessions === null || projections === undefined || projections === null) {
      return selections;
    }
    for (const sessionId of sessionIds) {
      try {
        const session = sessions.get(sessionId);
        if (session === undefined || session === null) continue;
        const lastUsed = projections.stateOf(session, 'modelSelection')?.lastUsed;
        if (lastUsed === undefined || lastUsed === null) continue;
        selections.set(sessionId, {
          provider: lastUsed.provider ?? null,
          model: lastUsed.model ?? null,
          reasoningEffort: lastUsed.reasoningEffort ?? null,
        });
      } catch {
        // sessão ainda sem seleção registrada: o app mostra "—"
      }
    }
    return selections;
  }

  /**
   * Título real de cada sessão, produzido pelo plugin de título do DSH
   * (`session-title`, que nomeia a sessão no começo com base no assunto).
   */
  function readTitles(sessionIds) {
    const titles = new Map();
    const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
    const projections = typeof ctx.get === 'function' ? ctx.get('sessionProjections') : undefined;
    if (sessions === undefined || sessions === null || projections === undefined || projections === null) return titles;
    for (const sessionId of sessionIds) {
      try {
        const session = sessions.get(sessionId);
        if (session === undefined || session === null) continue;
        const state = projections.stateOf(session, 'title');
        const title = typeof state === 'string' ? state : state?.title;
        if (typeof title === 'string' && title.trim().length > 0) titles.set(sessionId, title.trim());
      } catch {
        // sessão sem projeção de título ainda: o app cai no id curto
      }
    }
    return titles;
  }

  /** Grava `live.json` para o app, com debounce curto. */
  function pumpSnapshot() {
    try {
      const ids = store
        .allSessions()
        .filter((bucket) => bucket.requests.length > 0)
        .map((bucket) => bucket.sessionId);
      store.writeLive(
        buildSnapshot(cfg, store, fxState, inflight, Date.now(), {
          titles: readTitles(ids),
          selections: readSelections(ids),
          modelNames,
        }),
      );
    } catch {
      // o snapshot é acessório: nunca derruba a medição
    }
  }

  function schedulePump(delay = 250) {
    if (pumpTimer !== null) return;
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pumpSnapshot();
    }, delay);
    if (typeof pumpTimer.unref === 'function') pumpTimer.unref();
  }

  /** Mantém a cotação do dia atualizada sem bloquear a requisição. */
  function ensureFx() {
    if (fxInFlight) return;
    const fresh =
      fxState !== null &&
      Number.isFinite(fxState.rate) &&
      !fxState.stale &&
      Date.now() - num(fxState.fetchedAt) < cfg.fx.cacheHours * 3600_000;
    if (fresh) return;
    const now = Date.now();
    if (now - lastFxAttempt < 60_000) return;
    lastFxAttempt = now;
    fxInFlight = true;
    fetchFx(cfg, store, { force: false })
      .then((value) => {
        fxState = value;
        pumpSnapshot();
      })
      .catch(() => {})
      .finally(() => {
        fxInFlight = false;
      });
  }

  pumpSnapshot();

  // Correlaciona cada chamada de modelo com o turno/passo que a originou.
  ctx.on('agent/request', (payload, next) => {
    const sessionId = payload?.agent?.id;
    if (sessionId !== undefined) pendingStep.set(String(sessionId), { turn: payload.turn, step: payload.step });
    return next();
  });

  /** Envolve o stream da chamada: mede o tempo e agrega os chunks de usage. */
  ctx.on('llm/stream', (options, next) => {
    const startedAt = Date.now();
    const sessionId = options?.sessionId === undefined ? 'sem-sessao' : String(options.sessionId);
    const step = pendingStep.get(sessionId) ?? null;
    const inner = next();
    const inflightId = `${sessionId}:${startedAt}`;
    inflight.set(inflightId, {
      sessionId,
      model: options?.model ?? null,
      provider: options?.provider ?? null,
      purpose: options?.purpose ?? null,
      temperature: typeof options?.temperature === 'number' ? options.temperature : null,
      reasoningEffort: options?.reasoningEffort ?? null,
      turn: step?.turn ?? null,
      step: step?.step ?? null,
      startedAt,
      ttftMs: null,
      usage: null,
    });
    ensureModelNames(options?.provider);
    schedulePump(0);

    return (async function* tap() {
      let firstChunkAt = null;
      let usage = null;
      let failure = null;
      try {
        const source = await inner;
        for await (const chunk of source) {
          if (firstChunkAt === null) {
            firstChunkAt = Date.now();
            const live = inflight.get(inflightId);
            if (live) {
              live.ttftMs = firstChunkAt - startedAt;
              schedulePump();
            }
          }
          if (chunk?.type === 'usage') {
            usage = addUsage(usage, chunk.usage);
            const live = inflight.get(inflightId);
            if (live) {
              live.usage = usage;
              schedulePump();
            }
          }
          yield chunk;
        }
      } catch (error) {
        failure = error;
        throw error;
      } finally {
        const finishedAt = Date.now();
        const price = priceFor(cfg.prices, options?.provider, options?.model);
        const cost = computeCost(price, usage, startedAt, cfg.peakPolicy);
        inflight.delete(inflightId);
        store.record(sessionId, {
          at: startedAt,
          endedAt: finishedAt,
          durationMs: finishedAt - startedAt,
          ttftMs: firstChunkAt === null ? null : firstChunkAt - startedAt,
          provider: options?.provider ?? null,
          model: options?.model ?? null,
          purpose: options?.purpose ?? null,
          temperature: typeof options?.temperature === 'number' ? options.temperature : null,
          reasoningEffort: options?.reasoningEffort ?? null,
          turn: step?.turn ?? null,
          step: step?.step ?? null,
          usage: usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          peak: cost.peak,
          costUsd: failure === null ? cost.costUsd : 0,
          error: failure === null ? null : String(failure?.message ?? failure).slice(0, 300),
        });
        schedulePump(0);
        ensureFx();
      }
    })();
  });

  const handler = async (invocation) => {
    const input = String(invocation?.rawInput ?? '').trim().toLowerCase();
    const sessionId = String(invocation?.agent?.id ?? 'sem-sessao');

    if (input === 'help' || input === 'ajuda' || input === '?' || input === 'ayuda' || input === '帮助') {
      return { kind: 'success', text: cfg.t('help') };
    }
    if (input === 'reset' || input === 'zerar') {
      store.reset(sessionId);
      return { kind: 'success', text: cfg.t('resetDone') };
    }

    const force = input === 'cotacao' || input === 'cotação' || input === 'fx' || input === 'dolar' || input === 'dólar';
    const fx = await fetchFx(cfg, store, { force });
    fxState = fx;
    pumpSnapshot();
    const requests = store.session(sessionId).requests;
    for (const entry of requests) ensureModelNames(entry.provider);

    if (force) {
      if (!Number.isFinite(fx?.rate)) {
        return {
          kind: 'error',
          text: cfg.t('fxUnavailable'),
        };
      }
      const line = cfg.t('fxLine', fx.date, fx.source ? `, ${fx.source}` : '', fx.stale ? cfg.t('fxFromCache') : '', fx.rate.toFixed(4));
      if (requests.length === 0) return { kind: 'success', text: line };
      return { kind: 'success', text: `${line}\n\n${renderReport(cfg, sessionId, requests, fx)}` };
    }

    if (input === 'json') {
      const totals = totalsOf(requests, cfg);
      return {
        kind: 'success',
        text: JSON.stringify(
          {
            sessionId,
            fx,
            totals: { ...totals, models: [...totals.models] },
            costBrl: Number.isFinite(fx?.rate) ? totals.costUsd * fx.rate : null,
            requests,
          },
          null,
          2,
        ),
      };
    }

    return { kind: 'success', text: renderReport(cfg, sessionId, requests, fx) };
  };

  const definition = {
    name: cfg.commandName,
    description: cfg.t('commandDescription'),
    input: { hint: '[json|cotacao|reset|help]' },
    recordInput: false,
    handler,
  };
  ctx.commands.register(definition);
  for (const alias of cfg.aliasCommands) {
    if (alias !== cfg.commandName) ctx.commands.register({ ...definition, name: alias });
  }

  ctx.effect(() => async () => {
    store.flushNow();
    pumpSnapshot();
  }, 'session-cost: persist measured requests');
}

export { apply, inject, name };
export {
  computeCost,
  resolveBand,
  priceFor,
  resolveConfig,
  renderReport,
  buildSnapshot,
  summarize,
  fetchFx,
  safeWriteJson,
  safeReadJson,
  localDate,
  createTranslator,
  resolveLanguage,
  DEFAULT_PRICES,
  isPeakUtc,
  dshHome,
};
