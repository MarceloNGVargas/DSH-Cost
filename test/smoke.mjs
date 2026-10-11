/**
 * Smoke test local do plugin (sem DSH): ctx falso, stream simulado, cálculo de
 * custo, cotação em cache e persistência em disco.
 *   node test/smoke.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply, computeCost, isPeakUtc, resolveConfig, buildSnapshot, createTranslator, renderReport, DEFAULT_PRICES } from '../lib/index.js';

const storeDir = mkdtempSync(path.join(tmpdir(), 'session-cost-'));
mkdirSync(path.join(storeDir, 'sessions'), { recursive: true });
writeFileSync(path.join(storeDir, 'fx.json'), JSON.stringify({ rate: 5, source: 'teste', fetchedAt: Date.now(), date: '2026-10-11' }));

const listeners = new Map();
const commands = new Map();
const effects = [];
const ctx = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(fn);
  },
  commands: { register: (def) => commands.set(def.name, def) },
  effect: (fn) => effects.push(fn()),
};

const cfg = { storeDir, peakPolicy: 'off-peak', fx: { cacheHours: 6 } };
apply(ctx, cfg);

// --- preços -----------------------------------------------------------------
const flash = DEFAULT_PRICES['deepseek-flash'];
const cost = computeCost(flash, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, Date.now(), 'off-peak');
assert.equal(cost.costUsd.toFixed(4), '0.7500', 'off-peak: 1M miss + 1M output = 0.15 + 0.60');
const peakCost = computeCost(flash, { inputTokens: 1_000_000, outputTokens: 1_000_000 }, Date.now(), 'peak');
assert.equal(peakCost.costUsd.toFixed(4), '1.5000', 'peak dobra o preço');
const cached = computeCost(flash, { inputTokens: 0, cacheReadTokens: 1_000_000, outputTokens: 0 }, Date.now(), 'off-peak');
assert.equal(cached.costUsd.toFixed(4), '0.0030', 'cache hit usa o preço barato');
const mixed = computeCost(flash, { inputTokens: 600_000, cacheReadTokens: 400_000, outputTokens: 0 }, Date.now(), 'off-peak');
assert.equal(mixed.costUsd.toFixed(4), '0.0912', 'miss 600k + hit 400k');
assert.equal(mixed.inputCostUsd.toFixed(4), '0.0912', 'custo de entrada separado (miss + cache)');
assert.equal(mixed.outputCostUsd, 0, 'sem saída, sem custo de saída');
const split = computeCost(flash, { inputTokens: 0, cacheReadTokens: 1_000_000, outputTokens: 1_000_000 }, Date.now(), 'off-peak');
assert.equal(split.inputCostUsd.toFixed(4), '0.0030');
assert.equal(split.outputCostUsd.toFixed(4), '0.6000');
assert.equal((split.inputCostUsd + split.outputCostUsd).toFixed(4), split.costUsd.toFixed(4), 'entrada + saída = total');
// economia do cache: 1M lido do cache custaria 0.15 como miss e custou 0.003
const saved = computeCost(flash, { inputTokens: 0, cacheReadTokens: 1_000_000, outputTokens: 0 }, Date.now(), 'off-peak');
assert.equal(saved.savingsUsd.toFixed(4), '0.1470', 'economia = (miss - hit) sobre o cache lido');
assert.equal(computeCost(flash, { inputTokens: 1_000_000, outputTokens: 0 }, Date.now(), 'off-peak').savingsUsd, 0, 'sem cache, sem economia');
assert.equal(mixed.inputTotalTokens, 1_000_000, 'inputTokens é o miss; o total de entrada soma o cache');
const writeOnly = computeCost(flash, { inputTokens: 0, cacheWriteTokens: 1_000_000, outputTokens: 0 }, Date.now(), 'off-peak');
assert.equal(writeOnly.costUsd.toFixed(4), '0.1500', 'sem preço de cache write, cobra como miss');

// --- horário peak -----------------------------------------------------------
assert.equal(isPeakUtc(Date.parse('2026-10-12T02:00:00Z')), true, 'segunda 02:00 UTC é peak');
assert.equal(isPeakUtc(Date.parse('2026-10-12T12:00:00Z')), false, 'meio-dia UTC é off-peak');
assert.equal(isPeakUtc(Date.parse('2026-10-11T02:00:00Z')), false, 'domingo é off-peak');

// --- stream medido ----------------------------------------------------------
const streamListener = listeners.get('llm/stream')[0];
const requestListener = listeners.get('agent/request')[0];
assert.ok(streamListener && requestListener, 'listeners registrados');

const chunkStream = (chunks) =>
  (async function* () {
    for (const chunk of chunks) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield chunk;
    }
  })();

const sessionId = 'sessao-teste';
const runStream = async (options, chunks) => {
  requestListener({ agent: { id: sessionId }, turn: 1, step: 2 }, () => ({}));
  const stream = streamListener(options, () => chunkStream(chunks));
  for await (const _ of stream) {
    // consome
  }
};

await runStream(
  { provider: 'deepseek-official', model: 'deepseek-flash', sessionId },
  [
    { type: 'text-delta', index: 0, text: 'oi' },
    { type: 'usage', usage: { inputTokens: 10_000, outputTokens: 500, cacheReadTokens: 4_000 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ],
);
await runStream(
  { provider: 'deepseek-official', model: 'deepseek-v4-pro', sessionId },
  [{ type: 'usage', usage: { inputTokens: 2_000, outputTokens: 1_000 } }, { type: 'finish', reason: { kind: 'stop' } }],
);

const persistFile = path.join(storeDir, 'sessions', `${encodeURIComponent(sessionId)}.json`);
effects.forEach((dispose) => dispose());
assert.ok(existsSync(persistFile), 'medições persistidas em disco');
const stored = JSON.parse(readFileSync(persistFile, 'utf8'));
assert.equal(stored.requests.length, 2, 'duas requisições gravadas');
assert.ok(stored.requests[0].durationMs >= 10, 'duração medida inclui a latência do stream');
assert.ok(stored.requests[0].ttftMs !== null && stored.requests[0].ttftMs <= stored.requests[0].durationMs, 'TTFT medido');

// --- snapshot consumido pelo app visual -------------------------------------
const liveFile = path.join(storeDir, 'live.json');
assert.ok(existsSync(liveFile), 'live.json escrito para o app');
const live = JSON.parse(readFileSync(liveFile, 'utf8'));
assert.equal(live.app, 'dsh-session-cost');
assert.equal(live.today.requests, 2, 'totais do dia');
assert.equal(live.totals.requests, 2);
assert.equal(live.sessions.length, 1);
assert.equal(live.activeSessionId, sessionId, 'sessão ativa = mais recente');
assert.equal(live.lastRequest.model, 'deepseek-v4-pro', 'última requisição');
assert.ok(live.totals.costBrl > 0, 'total convertido para BRL');
assert.ok(Array.isArray(live.daily) && live.daily.length >= 1, 'histórico diário presente');
assert.equal(live.daily[0].date, live.today.date, 'histórico começa pelo dia de hoje');
assert.ok(live.sessions[0].firstAt > 0 && live.sessions[0].lastAt >= live.sessions[0].firstAt, 'sessão traz início e fim');
assert.ok(live.today.costInputUsd > 0, 'custo de entrada agregado no dia');
assert.ok(live.today.costOutputUsd > 0, 'custo de saída agregado no dia');
assert.ok(live.today.costInputBrl > 0 && live.today.costOutputBrl > 0, 'entrada/saída convertidos para BRL');
assert.ok(live.today.savingsUsd > 0 && live.today.savingsBrl > 0, 'economia do cache agregada e convertida');
assert.equal(live.fx.rate, 5);
assert.equal(live.inflight.length, 0, 'nada em andamento ao terminar');

const fakeStore = {
  allSessions: () => [
    {
      sessionId: 's1',
      requests: [
        {
          at: Date.now(),
          durationMs: 900,
          ttftMs: 200,
          model: 'deepseek-flash',
          usage: { inputTokens: 1000, outputTokens: 100 },
          costUsd: 0.001,
          error: null,
        },
      ],
    },
  ],
};
const inflight = new Map([
  ['k', { sessionId: 's1', model: 'deepseek-flash', startedAt: Date.now() - 1500, ttftMs: null, usage: null }],
]);
const snap = buildSnapshot({ peakPolicy: 'off-peak' }, fakeStore, { rate: 5, date: '2026-10-11', source: 'teste', fetchedAt: Date.now() }, inflight, Date.now());
assert.equal(snap.today.requests, 1);
assert.equal(snap.activeSessionId, 's1');
assert.ok(snap.inflight[0].elapsedMs >= 1400, 'cronômetro da chamada em andamento');
// recalculado com a tabela: 1000 miss * 0.15/M + 100 out * 0.6/M = 0.00021 USD; * 5 = 0.00105 BRL
assert.ok(Math.abs(snap.lastRequest.costBrl - 0.00105) < 1e-9, 'custo recalculado com a tabela e convertido');
assert.equal(snap.peak, false, 'faixa vigente no snapshot');
assert.equal(snap.daily.length, 1, 'um dia no histórico do snapshot');
assert.equal(snap.daily[0].requests, 1);
const snap2 = buildSnapshot(
  { peakPolicy: 'off-peak' },
  fakeStore,
  { rate: 5, date: '2026-10-11', source: 'teste', fetchedAt: Date.now() },
  new Map(),
  Date.now(),
  { titles: new Map([['s1', 'Meu teste de título']]), modelNames: { 'p/deepseek-flash': 'DeepSeek-V41-Flash' }, selections: new Map([['s1', { provider: 'p', model: 'deepseek-flash', reasoningEffort: 'high' }]]) },
);
assert.equal(snap2.sessions[0].title, 'Meu teste de título', 'título da sessão no snapshot');
assert.equal(snap2.activeSessionTitle, 'Meu teste de título');
assert.equal(snap2.modelNames['p/deepseek-flash'], 'DeepSeek-V41-Flash', 'nome de exibição do modelo');
assert.equal(snap2.activeReasoningEffort, 'high', 'esforço de raciocínio da sessão ativa');
assert.equal(snap2.sessions[0].reasoningEffort, 'high', 'esforço por sessão');
assert.equal(snap2.activeModel, 'deepseek-flash', 'modelo em uso na sessão');
assert.equal(snap2.running.sessionCount, 0, 'sem chamada em curso, nada em andamento');
assert.equal(snap2.running.requests, 0, 'sessão ociosa não conta no custo em andamento');
const snap3 = buildSnapshot(
  { peakPolicy: 'off-peak' },
  { allSessions: () => [
    { sessionId: 's1', requests: [{ at: Date.now(), durationMs: 100, model: 'deepseek-flash', usage: { inputTokens: 1000, outputTokens: 100 }, costUsd: 0.001 }] },
    { sessionId: 's2', requests: [{ at: Date.now(), durationMs: 200, model: 'deepseek-flash', usage: { inputTokens: 2000, outputTokens: 200 }, costUsd: 0.002 }] },
  ] },
  { rate: 5, date: '2026-10-11', source: 'teste', fetchedAt: Date.now() },
  new Map([
    ['a', { sessionId: 's1', startedAt: Date.now() }],
    ['b', { sessionId: 's2', startedAt: Date.now() }],
  ]),
  Date.now(),
);
assert.equal(snap3.running.sessionCount, 2, 'duas sessões em andamento somadas');
assert.equal(snap3.running.sessions.length, 2, 'uma linha por sessão em processamento');
assert.ok(snap3.running.sessions.every((session) => session.costUsd > 0 && session.requests > 0), 'consumo por sessão em andamento');
assert.ok(snap3.running.costUsd > snap2.running.costUsd, 'soma das sessões em curso');
// turno aberto no DSH (agente processando, mesmo entre requisições) conta como em andamento
const snap4 = buildSnapshot(
  { peakPolicy: 'off-peak' },
  fakeStore,
  { rate: 5, date: '2026-10-11', source: 'teste', fetchedAt: Date.now() },
  new Map(),
  Date.now(),
  { status: new Map([['s1', { running: true, openTurnStartSeq: 5, pendingToolCalls: 1 }], ['s2', { running: false }]]) },
);
assert.equal(snap4.running.sessionCount, 1, 'turno aberto conta como processando');
assert.equal(snap4.running.sessions[0].sessionId, 's1', 'sessão do turno aberto listada');
assert.equal(snap4.running.requests, 1, 'consumo da sessão em processamento somado');

// --- comando /custo ---------------------------------------------------------
assert.ok(commands.has('custo') && commands.has('cost'), 'comando e alias registrados');
const report = await commands.get('custo').handler({ agent: { id: sessionId }, rawInput: '' });
assert.equal(report.kind, 'success');
assert.match(report.text, /Requisições medidas: 2/);
assert.match(report.text, /deepseek-flash/);
assert.match(report.text, /US\$ /);
assert.match(report.text, /Custo em real: R\$ /);
assert.match(report.text, /Cotação do dólar/);

const json = await commands.get('custo').handler({ agent: { id: sessionId }, rawInput: 'json' });
const parsed = JSON.parse(json.text);
assert.equal(parsed.requests.length, 2);
assert.equal(parsed.fx.rate, 5);
assert.ok(parsed.costBrl > 0, 'custo em BRL calculado com a cotação');

const empty = await commands.get('custo').handler({ agent: { id: 'outra-sessao' }, rawInput: '' });
assert.match(empty.text, /Nenhuma requisição/);

const help = await commands.get('custo').handler({ agent: { id: sessionId }, rawInput: 'help' });
assert.match(help.text, /Uso: \/custo/);

const reset = await commands.get('custo').handler({ agent: { id: sessionId }, rawInput: 'reset' });
assert.match(reset.text, /zerados/);
const afterReset = await commands.get('custo').handler({ agent: { id: sessionId }, rawInput: '' });
assert.match(afterReset.text, /Nenhuma requisição/);

// --- config -----------------------------------------------------------------
const resolved = resolveConfig({ prices: { 'meu-modelo': { output: 9 } }, commandName: 'gasto' });
assert.equal(resolved.commandName, 'gasto');
assert.equal(resolved.prices['meu-modelo'].output.offPeak, 9);
assert.equal(resolved.prices['meu-modelo'].output.peak, 9, 'número vale para as duas faixas');
assert.equal(resolved.prices['meu-modelo'].cacheMiss.offPeak, DEFAULT_PRICES.default.cacheMiss.offPeak, 'defaults preservados');
assert.equal(resolved.peakPolicy, 'auto');

// --- multi-idioma -----------------------------------------------------------
assert.equal(createTranslator('pt').language, 'pt-BR', 'i18n: pt normaliza para pt-BR');
assert.equal(createTranslator('en').language, 'en');
assert.equal(createTranslator('zh-CN').t('totals'), '### 合计', 'i18n: chinês');
assert.ok(createTranslator('es').t('reportTitle').includes('Costo'), 'i18n: espanhol');
assert.ok(createTranslator('en').t('commandDescription').startsWith('Shows'), 'i18n: inglês');
const cfgEn = resolveConfig({ language: 'en' });
assert.equal(cfgEn.language, 'en', 'config.language respeitada');
const englishReport = renderReport(cfgEn, 's1', [{ at: Date.now(), durationMs: 100, model: 'm', usage: { inputTokens: 1, outputTokens: 1 }, error: null }], null);
assert.ok(englishReport.includes('Session cost and time'), 'relatório em inglês');
assert.ok(englishReport.includes('Input tokens'), 'rótulos traduzidos');
const zhReport = renderReport(resolveConfig({ language: 'zh-CN' }), 's1', [], null);
assert.ok(zhReport.includes('本会话尚未测量'), 'mensagem vazia traduzida');

console.log('smoke: OK (preços, peak, medição, comando, persistência, config, i18n)');