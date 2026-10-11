/**
 * Agregador em tempo real do dsh-session-cost.
 *
 * Lê os arquivos por sessão gravados pelo plugin (`sessions/*.json`), a
 * cotação em cache (`fx.json`) e monta o snapshot que o app visual consome
 * (`live.json`), usando exatamente a mesma lógica de preços do plugin
 * (`buildSnapshot`/`resolveConfig`).
 *
 * Assim o app visual continua funcionando mesmo quando o plugin rodando no
 * app DSH ainda está com uma versão antiga em memória.
 *
 * Uso:
 *   node monitor.mjs [--interval 1000] [--once]
 *
 * @module dsh-session-cost/app/monitor
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  buildSnapshot,
  dshHome,
  fetchFx,
  resolveConfig,
  safeReadJson,
  safeWriteJson,
} from '../lib/index.js';

const args = process.argv.slice(2);
const once = args.includes('--once');
const intervalArg = args.indexOf('--interval');
const intervalMs = intervalArg >= 0 ? Math.max(200, Number(args[intervalArg + 1]) || 1000) : 1000;

const cfg = resolveConfig({});
const liveFile = path.join(cfg.storeDir, 'live.json');
const lockFile = path.join(cfg.storeDir, 'monitor.pid');
const sessionsDir = path.join(cfg.storeDir, 'sessions');
const modelNamesFile = path.join(cfg.storeDir, 'model-names.json');
const projCacheDir = path.join(dshHome(), 'storages', 'session_projcache', 'sessions');

/** Nome curto derivado do primeiro prompt, quando o título do DSH ainda não existe. */
function shortTitle(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').slice(0, 6).join(' ');
  return words.length > 48 ? `${words.slice(0, 47)}…` : words;
}

/**
 * Nomes de exibição do catálogo de modelos.
 *
 * Lê o `DEFAULT_MODELS` do adapter dentro do app.asar instalado (mesma fonte que
 * o DSH usa), com fallback embutido. Assim o app mostra "DeepSeek-V41-Flash" sem
 * depender de o plugin conseguir consultar `ctx.llm.listModels`.
 */
const FALLBACK_MODEL_NAMES = { 'deepseek-flash': 'DeepSeek-V41-Flash', 'deepseek-v4-pro': 'DeepSeek-V4-Pro' };

function findAppAsar() {
  const candidates = [];
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'));
    try {
      for (const name of readdirSync(path.join(process.env.LOCALAPPDATA, 'Programs'))) {
        candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', name, 'resources', 'app.asar'));
      }
    } catch {
      // sem permissão/entrada: segue com os candidatos conhecidos
    }
  }
  if (process.env.PROGRAMFILES) {
    candidates.push(path.join(process.env.PROGRAMFILES, 'DeepSeek Harness', 'resources', 'app.asar'));
  }
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

/** Lê um arquivo de dentro do asar (header em offset 16 — formato Electron). */
function readAsarEntry(asarPath, entryPath) {
  const buffer = readFileSync(asarPath);
  const headerSize = buffer.readUInt32LE(4);
  const header = JSON.parse(buffer.subarray(16, 8 + headerSize).toString('utf8'));
  const start = 8 + headerSize;
  let node = header;
  for (const part of entryPath.split('/')) {
    node = node?.files?.[part];
    if (!node) return null;
  }
  if (!node || node.offset === undefined) return null;
  const offset = Number(node.offset);
  const size = Number(node.size);
  return buffer.subarray(start + offset, start + offset + size).toString('utf8');
}

let cachedModelNames = null;
function adapterModelNames() {
  if (cachedModelNames !== null) return cachedModelNames;
  let names = { ...FALLBACK_MODEL_NAMES };
  try {
    const asar = findAppAsar();
    const source = asar === null ? null : readAsarEntry(asar, 'node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js');
    if (source !== null) {
      const found = {};
      const pattern = /id:\s*"([^"]+)"[\s\S]{0,240}?name:\s*"([^"]+)"/g;
      let match;
      while ((match = pattern.exec(source)) !== null) found[match[1]] = match[2];
      if (Object.keys(found).length > 0) names = { ...names, ...found };
    }
  } catch {
    // catálogo ilegível: fica o fallback embutido
  }
  cachedModelNames = names;
  return names;
}

/**
 * Estado de execução de cada sessão, do cache de projeção do DSH:
 *  - `turnBoundary.openTurnStartSeq` define um TURNO ABERTO (o agente está
 *    processando: chamando o modelo ou executando ferramentas);
 *  - `sessionStats.pendingCalls`/`openStep` indicam execução em curso mesmo
 *    entre duas requisições de modelo.
 * Quando o turno fecha, a sessão sai de "em andamento" — é o sinal exato do
 * que está sendo processado agora, sem depender do `inflight`.
 */
function readSessionStatus(sessionIds) {
  const status = new Map();
  for (const sessionId of sessionIds) {
    const trimmed = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId;
    for (const candidate of [sessionId, trimmed, `session-${trimmed}`]) {
      const data = safeReadJson(path.join(projCacheDir, `${candidate}.json`));
      const rows = data?.record?.rows;
      if (!rows) continue;
      const boundary = rows.turnBoundary?.val ?? null;
      const stats = rows.sessionStats?.val ?? null;
      const openTurnStartSeq = boundary?.openTurnStartSeq ?? null;
      const pendingCalls = stats?.pendingCalls ?? null;
      const pendingToolCalls = pendingCalls !== null && typeof pendingCalls === 'object' ? Object.keys(pendingCalls).length : 0;
      const openStep = stats?.openStep ?? null;
      status.set(sessionId, {
        running: openTurnStartSeq !== null || pendingToolCalls > 0 || openStep !== null,
        openTurnStartSeq,
        pendingToolCalls,
      });
      break;
    }
  }
  return status;
}

/**
 * Seleção de modelo/esforço em uso por sessão, do cache de projeção
 * (`modelSelection.val.lastUsed` → provider, model, reasoningEffort).
 */
function readSessionSelections(sessionIds) {
  const selections = new Map();
  for (const sessionId of sessionIds) {
    const trimmed = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId;
    for (const candidate of [sessionId, trimmed, `session-${trimmed}`]) {
      const data = safeReadJson(path.join(projCacheDir, `${candidate}.json`));
      const lastUsed = data?.record?.rows?.modelSelection?.val?.lastUsed;
      if (lastUsed && typeof lastUsed === 'object') {
        selections.set(sessionId, {
          provider: typeof lastUsed.provider === 'string' ? lastUsed.provider : null,
          model: typeof lastUsed.model === 'string' ? lastUsed.model : null,
          reasoningEffort: typeof lastUsed.reasoningEffort === 'string' ? lastUsed.reasoningEffort : null,
        });
        break;
      }
    }
  }
  return selections;
}

/**
 * Lê o título REAL de cada sessão do cache de projeção do DSH
 * (`~/.dsh/storages/session_projcache/sessions/<id>.json`), produzido pelo
 * plugin de título que o próprio DSH já roda no começo de cada sessão.
 */
function readSessionTitles(sessionIds) {
  const titles = new Map();
  for (const sessionId of sessionIds) {
    const trimmed = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId;
    const candidates = [sessionId, trimmed, `session-${trimmed}`];
    for (const candidate of candidates) {
      const data = safeReadJson(path.join(projCacheDir, `${candidate}.json`));
      const rows = data?.record?.rows;
      const title = typeof rows?.title?.val === 'string' ? rows.title.val.trim() : '';
      if (title.length > 0) {
        titles.set(sessionId, title);
        break;
      }
      const firstText = rows?.titleInput?.val?.first?.text;
      if (typeof firstText === 'string' && firstText.trim().length > 0) {
        titles.set(sessionId, shortTitle(firstText));
        break;
      }
    }
  }
  return titles;
}

/** Store somente-leitura sobre os arquivos que o plugin mantém. */
const store = {
  allSessions() {
    let names = [];
    try {
      names = readdirSync(sessionsDir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const data = safeReadJson(path.join(sessionsDir, name));
      if (data === undefined || typeof data.sessionId !== 'string') continue;
      out.push({ sessionId: data.sessionId, requests: Array.isArray(data.requests) ? data.requests : [] });
    }
    return out;
  },
  readFx: () => safeReadJson(path.join(cfg.storeDir, 'fx.json')),
  writeFx: (value) => safeWriteJson(path.join(cfg.storeDir, 'fx.json'), value),
};

/** Evita dois agregadores ao mesmo tempo (abrir o atalho duas vezes). */
function alreadyRunning() {
  const lock = safeReadJson(lockFile);
  const pid = Number(lock?.pid ?? 0);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

if (alreadyRunning()) {
  process.stdout.write('monitor: já existe um agregador rodando\n');
  process.exit(0);
}
safeWriteJson(lockFile, { pid: process.pid, startedAt: Date.now() });

let fx = store.readFx() ?? null;
let lastFxAttempt = 0;

/** A sessão já registrou uma requisição concluída a partir deste instante? */
function sessionRecordedAfter(sessionId, startedAt) {
  const data = safeReadJson(path.join(sessionsDir, `${encodeURIComponent(sessionId)}.json`));
  const requests = Array.isArray(data?.requests) ? data.requests : [];
  return requests.some((entry) => Number(entry?.endedAt ?? entry?.at ?? 0) >= startedAt);
}

/**
 * Preserva as chamadas em andamento que o plugin marcou no `live.json` (o
 * agregador reescreve o arquivo a cada segundo e, sem isso, apagaria o
 * cronômetro da requisição em curso).
 *
 * Um item só sobrevive enquanto a chamada realmente existir: assim que a sessão
 * registra a requisição concluída — ou passados 30 s — ele sai daqui, para uma
 * sessão encerrada não continuar contando como ativa.
 */
function carryInflight(previous) {
  const carried = new Map();
  const now = Date.now();
  for (const item of previous?.inflight ?? []) {
    if (item === null || typeof item !== 'object') continue;
    const startedAt = Number(item.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) continue;
    if (now - startedAt > 30_000 || startedAt > now + 5_000) continue;
    if (typeof item.sessionId === 'string' && sessionRecordedAfter(item.sessionId, startedAt)) continue;
    carried.set(`${item.sessionId}:${startedAt}`, item);
  }
  return carried;
}

/** Atualiza a cotação no máximo a cada 5 minutos (o cache do plugin manda). */
async function refreshFx() {
  const now = Date.now();
  const fresh =
    fx !== null &&
    Number.isFinite(fx.rate) &&
    !fx.stale &&
    now - (Number.isFinite(fx.fetchedAt) ? fx.fetchedAt : 0) < cfg.fx.cacheHours * 3600_000;
  if (fresh) return;
  if (now - lastFxAttempt < 300_000) return;
  lastFxAttempt = now;
  try {
    fx = await fetchFx(cfg, store, { force: false });
  } catch {
    // sem rede: mantém a cotação anterior (ou ausente)
  }
}

function liveFileState() {
  try {
    const info = statSync(liveFile);
    return { mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

async function tick() {
  await refreshFx();
  const previous = safeReadJson(liveFile);
  const before = liveFileState();
  const ids = store
    .allSessions()
    .filter((bucket) => bucket.requests.length > 0)
    .map((bucket) => bucket.sessionId);
  const snapshot = buildSnapshot(cfg, store, fx, carryInflight(previous), Date.now(), {
    titles: readSessionTitles(ids),
    selections: readSessionSelections(ids),
    status: readSessionStatus(ids),
    modelNames: { ...adapterModelNames(), ...(safeReadJson(modelNamesFile) ?? {}) },
  });

  // Se o plugin gravou entre a leitura e agora, desiste deste ciclo.
  const after = liveFileState();
  if (after !== null && before !== null && after.mtimeMs !== before.mtimeMs) return previous;

  safeWriteJson(liveFile, snapshot);
  return snapshot;
}

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  try {
    safeWriteJson(lockFile, { pid: 0, stoppedAt: Date.now() });
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

if (once) {
  const snapshot = await tick();
  process.stdout.write(`monitor: live.json gerado (${snapshot.today.requests} req hoje)\n`);
  stop();
} else {
  await tick();
  process.stdout.write(`monitor: ativo, gravando ${liveFile} a cada ${intervalMs} ms\n`);
  const errors = [];
  setInterval(() => {
    tick().catch((error) => {
      errors.push(String(error?.message ?? error));
      if (errors.length <= 3) process.stderr.write(`monitor: ${String(error?.message ?? error)}\n`);
    });
  }, intervalMs);
}
