#!/usr/bin/env node
// Summarizes docs/sprint_telemetry.jsonl for the last N sprints.
// Usage:
//   node scripts/telemetry-report.mjs                  # últimas 10 sprints
//   node scripts/telemetry-report.mjs --sprints 25
//   node scripts/telemetry-report.mjs --agent @backend
//   node scripts/telemetry-report.mjs --sprints 5 --agent @frontend

import { readFileSync, existsSync } from 'node:fs';

const FILE = 'docs/sprint_telemetry.jsonl';
const DRIFT_THRESHOLD = 1.5;
const ESCALATION_ATTEMPTS = 3;

function parseArgs(argv) {
  const out = new Map();
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out.set(key, val);
  }
  return out;
}

const args = parseArgs(process.argv);
const sprintLimit = parseInt(args.get('sprints') || '10', 10);
const agentFilter = args.get('agent') || null;

if (!existsSync(FILE)) {
  console.log(`Nenhuma telemetria encontrada em ${FILE}.`);
  console.log('Rode pelo menos uma sprint antes de pedir o relatório.');
  process.exit(0);
}

const raw = readFileSync(FILE, 'utf8').trim();
if (!raw) {
  console.log(`${FILE} está vazio.`);
  process.exit(0);
}

const events = [];
for (const line of raw.split('\n')) {
  if (!line.trim()) continue;
  try { events.push(JSON.parse(line)); }
  catch { console.warn(`  aviso: linha inválida ignorada: ${line.slice(0, 80)}...`); }
}

const sprintsInOrder = [];
for (const e of events) {
  if (e.sprint && !sprintsInOrder.includes(e.sprint)) sprintsInOrder.push(e.sprint);
}
const selectedSprints = sprintsInOrder.slice(-sprintLimit);
const scoped = events.filter(e =>
  selectedSprints.includes(e.sprint) &&
  (!agentFilter || e.agent === agentFilter)
);

const total = scoped.length;
const passes = scoped.filter(e => e.result === 'pass').length;
const warns = scoped.filter(e => e.result === 'warn').length;
const fails = scoped.filter(e => e.result === 'fail');

const gateFails = {};
for (const e of fails) {
  if (!gateFails[e.gate]) gateFails[e.gate] = { count: 0, tags: {} };
  gateFails[e.gate].count++;
  const tag = e.error_tag || '(sem tag)';
  gateFails[e.gate].tags[tag] = (gateFails[e.gate].tags[tag] || 0) + 1;
}

const attemptsByKey = new Map();
for (const e of scoped) {
  if (!e.agent) continue;
  const key = `${e.sprint}::${e.gate}::${e.agent}`;
  const prev = attemptsByKey.get(key) || 0;
  attemptsByKey.set(key, Math.max(prev, e.attempt || 1));
}
const attemptsByAgent = {};
for (const [key, max] of attemptsByKey) {
  const agent = key.split('::')[2];
  if (!attemptsByAgent[agent]) attemptsByAgent[agent] = [];
  attemptsByAgent[agent].push(max);
}
const agentStats = Object.entries(attemptsByAgent).map(([agent, arr]) => {
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { agent, avg, n: arr.length, drift: avg > DRIFT_THRESHOLD };
}).sort((a, b) => b.avg - a.avg);

const escalations = [...attemptsByKey.values()].filter(a => a >= ESCALATION_ATTEMPTS).length;

const durationsByGate = {};
for (const e of scoped) {
  if (typeof e.duration_ms !== 'number') continue;
  if (!durationsByGate[e.gate]) durationsByGate[e.gate] = [];
  durationsByGate[e.gate].push(e.duration_ms);
}

const rate = total ? Math.round((passes / total) * 100) : 0;
const header = `Telemetry Report (últimas ${selectedSprints.length} sprints${agentFilter ? `, agent=${agentFilter}` : ''})`;
console.log(header);
console.log('─'.repeat(header.length));
console.log(`Sprints: ${selectedSprints.join(', ') || '(nenhuma)'}`);
console.log(`Gates avaliados:    ${total}`);
console.log(`Pass rate global:   ${rate}% (${passes}/${total})   warn: ${warns}   fail: ${fails.length}`);
console.log('');

console.log('Top gates com falha:');
const sortedGates = Object.entries(gateFails).sort((a, b) => b[1].count - a[1].count);
if (sortedGates.length === 0) console.log('  (nenhum)');
for (const [gate, d] of sortedGates) {
  const tagStr = Object.entries(d.tags).map(([t, c]) => `${t} x${c}`).join(', ');
  console.log(`  ${gate.padEnd(8)} ${d.count} fails   (${tagStr})`);
}
console.log('');

console.log('Retry rate por agente:');
if (agentStats.length === 0) console.log('  (nenhum)');
for (const s of agentStats) {
  const flag = s.drift ? '  ⚠️ drift' : '';
  console.log(`  ${s.agent.padEnd(14)} ${s.avg.toFixed(2)} avg attempts (n=${s.n})${flag}`);
}
console.log('');

console.log(`Sprints com escalação (≥${ESCALATION_ATTEMPTS} attempts): ${escalations}`);
console.log('');

if (Object.keys(durationsByGate).length > 0) {
  console.log('Duração média por gate:');
  for (const [gate, arr] of Object.entries(durationsByGate).sort()) {
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    console.log(`  ${gate.padEnd(8)} ${(avg / 1000).toFixed(2)}s  (n=${arr.length})`);
  }
} else {
  console.log('Duração média por gate: não disponível (eventos sem campo duration_ms).');
}
