import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import { spawn, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const abs = name => path.join(root, name);
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const readJson = async name => JSON.parse(await fs.readFile(abs(name), 'utf8'));
const saveJson = (name, value, options) => fs.writeFile(name, JSON.stringify(value, null, 2) + '\n', options);
const flags = process.argv.slice(2);
assert.ok(flags.length >= 1 && flags.every((v, i) => i === 0 || v === '--validate-only'));
const runName = flags[0];
assert.match(runName, /^(development|holdout)-[1-9][0-9]*$/);
const phase = runName.startsWith('development') ? 'development' : 'holdout';
const out = abs('results/effort-v4/' + runName);
const shared = abs('.tools/effort-v4/shared');
const baselineJar = abs('.tools/effort-v4/baseline.jar');
const candidateJar = abs('backend/build/libs/effort-lab.jar');
const java = abs('desktop/runtime/java/bin/java.exe');
const cli = abs('desktop/node_modules/@openai/codex/bin/codex.js');
const nativePackage = createRequire(cli).resolve('@openai/codex-win32-x64/package.json');
const nativeCli = path.join(path.dirname(nativePackage), 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const model = 'gpt-5.6-luna';
const sources = ['backend/src/main/java/dev/effortlab/EffortRouter.java',
  'backend/src/main/java/dev/effortlab/EvaluationService.java', 'backend/src/main/java/dev/effortlab/ModelGateway.java',
  'backend/src/main/java/dev/effortlab/AnswerVerifier.java', 'backend/src/main/resources/answer-instructions.txt',
  'backend/src/main/java/dev/effortlab/Domain.java', 'backend/src/main/java/dev/effortlab/BenchmarkService.java',
  'scripts/measure-effort-v4.mjs', 'scripts/audit-effort-v4.mjs', 'scripts/generate-effort-cases.mjs', 'scripts/build-effort-v4.ps1',
  'docs/effort-v4-plan.md'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async p => [p, sha(await fs.readFile(abs(p)))])));
const baselineSources = Object.fromEntries(['EffortRouter', 'EvaluationService'].map(name =>
  ['baseline/backend/src/main/java/dev/effortlab/' + name + '.java', '.tools/effort-v4/' + name + '.baseline.java']));
for (const [key, filename] of Object.entries(baselineSources)) sourceHashes[key] = sha(await fs.readFile(abs(filename)));
const candidatePolicy = (await fs.readFile(abs(sources[0]), 'utf8')).match(/VERSION = "([^"]+)"/)[1];
const prior = await readJson('results/v3/cases.json');
const devIds = ['b01', 'b04', 'b02', 'b05', 'b08', 'b09'];
const dataset = phase === 'development' ? devIds.map(id => prior.find(c => c.id === id)) : await readJson('results/effort-v4/cases.json');
assert.equal(dataset.length, phase === 'development' ? 6 : 24);
assert.equal(new Set(dataset.map(c => c.id)).size, dataset.length);
const schedule = dataset.flatMap((c, index) => {
  const order = ['HIGH', 'LOW', 'LEGACY', 'CANDIDATE'];
  const rotation = (index + Math.floor(index / 12)) % 4;
  return [...order.slice(rotation), ...order.slice(0, rotation)].map(arm => ({ caseId: c.id, arm, risk: arm === 'HIGH' ? 'HIGH' : 'NORMAL' }));
}).map((p, index) => ({ index, ...p }));
const env = { ...process.env, CODEX_MODEL: model, CODEX_JS_PATH: cli, NODE_BINARY: process.execPath, CODEX_TIMEOUT_SECONDS: '180' };
delete env.OPENAI_API_KEY;
delete env.CODEX_API_KEY;
const cliVersion = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8', windowsHide: true, env }).trim();
assert.equal(cliVersion, 'codex-cli 0.153.4');
const baselineSha256 = sha(await fs.readFile(baselineJar)), candidateSha256 = sha(await fs.readFile(candidateJar));
assert.equal(baselineSha256, '5965248981d42c713f0e8a8bd8f68afebe9f27dbdc1ab13dffa2f52015661482', 'Baseline jar differs from the frozen build');
assert.notEqual(candidateSha256, baselineSha256, 'Build the modified candidate first');
const baselineRef = execFileSync('git', ['rev-parse', 'e4f179d'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
assert.ok(baselineRef.startsWith('e4f179d'));
for (const [key, filename] of Object.entries(baselineSources)) {
  const original = execFileSync('git', ['show', baselineRef + ':' + key.slice('baseline/'.length)],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal((await fs.readFile(abs(filename), 'utf8')).replace(/\r\n/g, '\n'), original.replace(/\r\n/g, '\n'),
    'Baseline source differs from the pinned commit: ' + filename);
}
const candidateBuildReceipt = await readJson('.tools/effort-v4/candidate-build.json');
assert.equal(candidateBuildReceipt.jarSha256, candidateSha256, 'Candidate jar differs from its build receipt');
assert.ok(candidateBuildReceipt.sourceHashes && typeof candidateBuildReceipt.sourceHashes === 'object'
  && !Array.isArray(candidateBuildReceipt.sourceHashes), 'Candidate build receipt must contain source hashes');
for (const source of sources.filter(name => name.startsWith('backend/')))
  assert.ok(Object.hasOwn(candidateBuildReceipt.sourceHashes, source), 'Candidate build receipt omits ' + source);
for (const [source, expected] of Object.entries(candidateBuildReceipt.sourceHashes)) {
  assert.ok(source.startsWith('backend/') && !source.includes('\\') && !source.split('/').includes('..'),
    'Build receipt must use relative backend paths');
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(sha(await fs.readFile(abs(source))), expected, 'Candidate source changed after its build: ' + source);
}
const manifest = { schemaVersion: 'effort-v4-1', phase, runName, startedAt: new Date().toISOString(),
  baselineCommit: baselineRef, candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  baselinePolicy: 'rules-1.1', candidatePolicy, model, cliVersion, cliSha256: sha(await fs.readFile(cli)),
  nativeCliBinary: nativeCli, nativeCliSha256: sha(await fs.readFile(nativeCli)), candidateBuildReceipt,
  javaBinary: java, nodeBinary: process.execPath, commonWorkingDirectory: shared,
  environment: { CODEX_MODEL: model, CODEX_JS_PATH: cli, NODE_BINARY: process.execPath, CODEX_TIMEOUT_SECONDS: '180',
    apiKeysRemoved: ['OPENAI_API_KEY', 'CODEX_API_KEY'], inheritedEnvironment: 'Same snapshot for both Java processes; user configuration ignored by CLI' },
  baselineJarSha256: baselineSha256, candidateJarSha256: candidateSha256,
  dataset, datasetSha256: sha(JSON.stringify(dataset) + '\n'), schedule, plannedTrials: schedule.length,
  tokenBudget: phase === 'development' ? 140000 : 500000,
  sourceHashes, sourceSnapshots: { ...Object.fromEntries(sources.map((s, i) => [s, 'sources/' + String(i).padStart(2, '0') + '-' + path.basename(s)])),
    ...Object.fromEntries(Object.keys(baselineSources).map(s => [s, 'sources/baseline-' + path.basename(s)])) },
  comparison: 'One sequential execution per policy and case, including policy retries. All four policy orders rotated within each case. Identical task text, model, instructions, CLI, process environment and working directory.',
  grading: 'EXACT after output; expected answer is sent to the local verifier only. HIGH uses Risk.HIGH, which changes only the router decision.',
  limitations: 'Synthetic known families, one execution per arm and case. Dynamic provider input and cache may vary. Not a general routing guarantee.' };
if (flags.includes('--validate-only')) {
  console.log(JSON.stringify({ status: 'PREFLIGHT_PASS_NO_MODEL_CALLS', phase, cases: dataset.length, trials: schedule.length, candidatePolicy, cliVersion }, null, 2));
  process.exit(0);
}
await fs.mkdir(out, { recursive: true });
await saveJson(path.join(out, 'manifest.json'), manifest, { flag: 'wx' });
for (const dir of ['requests', 'traces', 'sources']) await fs.mkdir(path.join(out, dir), { recursive: true });
for (const [source, snapshot] of Object.entries(manifest.sourceSnapshots)) await fs.copyFile(abs(baselineSources[source] ?? source), path.join(out, snapshot));
await fs.mkdir(shared, { recursive: true });
const traceDir = path.join(shared, 'data', 'cli-traces');
await fs.mkdir(traceDir, { recursive: true });
const run = { status: 'RUNNING', requests: [], requestHashes: {}, knownTokens: 0, unknownUsage: false, startedAt: manifest.startedAt };
const persist = () => saveJson(path.join(out, 'run.json'), run);
const children = [], handles = [];
const stopping = new WeakMap();
let interrupted = false, activeRequest = false;
const token = crypto.randomBytes(24).toString('hex');
env.EFFORTLAB_SESSION_TOKEN = token;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function stop(child) {
  if (stopping.has(child)) return stopping.get(child);
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const pending = (async () => {
    const closed = new Promise(resolve => child.once('close', resolve));
    if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10000 }, resolve));
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  })();
  stopping.set(child, pending);
  return pending;
}
const onInterrupt = () => { interrupted = true; void Promise.all(children.map(stop)); };
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function api(base, route, body) {
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Effort-Lab-Token': token },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(body ? 600000 : 3000) });
  const value = await response.json();
  if (!response.ok) throw Error('HTTP ' + response.status + ': ' + JSON.stringify(value));
  return value;
}
async function startServer(label, jar, policy) {
  const port = await freePort(), base = 'http://127.0.0.1:' + port + '/api';
  const log = await fs.open(path.join(shared, label + '-' + runName + '.log'), 'wx');
  handles.push(log);
  const child = spawn(java, ['-jar', jar, '--server.port=' + port, '--spring.datasource.url=jdbc:h2:mem:' + label],
    { cwd: shared, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true });
  children.push(child);
  let spawnError;
  child.on('error', error => { spawnError = error; });
  for (let n = 0; n < 90; n++) {
    if (spawnError) throw spawnError;
    if (interrupted || child.exitCode !== null) throw Error(label + ' server terminated');
    try {
      const status = await api(base, '/status');
      assert.equal(status.policyVersion, policy);assert.equal(status.model, model);assert.equal(status.codexAvailable, true);
      return base;
    } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
    await pause(1000);
  }
  throw Error(label + ' server did not become ready');
}
await persist();
try {
  const legacy = await startServer('baseline', baselineJar, manifest.baselinePolicy);
  const candidate = await startServer('candidate', candidateJar, candidatePolicy);
  const bases = { LEGACY: legacy, CANDIDATE: candidate, HIGH: candidate, LOW: candidate };
  const decisions = [];
  for (const plan of schedule) {
    const c = dataset.find(c => c.id === plan.caseId);
    const decision = await api(bases[plan.arm], '/route', { task: c.prompt, risk: plan.risk });
    decisions.push({ index: plan.index, caseId: c.id, arm: plan.arm, decision });
  }
  await saveJson(path.join(out, 'decisions.json'), decisions, { flag: 'wx' });
  console.log('READY ' + runName + ' ' + schedule.length + ' trials ' + manifest.tokenBudget + ' token stop threshold');
  for (const plan of schedule) {
    if (interrupted) { run.status = 'INTERRUPTED'; break; }
    if (run.knownTokens >= manifest.tokenBudget) { run.status = 'BUDGET_EXCEEDED'; break; }
    const c = dataset.find(c => c.id === plan.caseId);
    const before = new Set(await fs.readdir(traceDir));
    const record = { ...plan, taskSha256: sha(c.prompt), startedAt: new Date().toISOString(), result: null, traceFiles: [] };
    console.log('START ' + (plan.index + 1) + '/' + schedule.length + ' ' + c.id + ' ' + plan.arm);
    activeRequest = true;
    try {
      record.result = await api(bases[plan.arm], '/execute', { task: c.prompt, risk: plan.risk, mode: 'CODEX', check: 'EXACT', expectedAnswer: c.expectedAnswer,
        ...(plan.arm === 'LEGACY' ? {} : { strategy: ['HIGH', 'LOW'].includes(plan.arm) ? plan.arm : 'ADAPTIVE' }) });
      run.knownTokens += record.result.totalTokens;
      run.unknownUsage ||= record.result.unknownUsage;
      activeRequest = false;
      await persist();
    } catch (error) {
      // Wait for our Java/CLI process trees to exit before preserving final trace bytes.
      await Promise.all(children.map(stop));
      throw error;
    } finally {
      for (const name of (await fs.readdir(traceDir)).filter(name => !before.has(name) && name.endsWith('.jsonl'))) {
        const raw = await fs.readFile(path.join(traceDir, name));
        const target = 'traces/' + name;
        await fs.writeFile(path.join(out, target), raw, { flag: 'wx' });
        record.traceFiles.push({ responseId: name.slice(0, -6), path: target, sha256: sha(raw) });
      }
      const requestName = String(plan.index).padStart(3, '0') + '.json';
      await saveJson(path.join(out, 'requests', requestName), record, { flag: 'wx' });
      run.requestHashes[requestName] = sha(await fs.readFile(path.join(out, 'requests', requestName)));
    }
    run.requests.push(plan.index);
    const result = record.result;
    await persist();
    console.log('DONE ' + result.verdict + ' ' + result.totalTokens + ' tokens; ' + result.attempts.map(a => a.effort).join('->'));
    if (result.unknownUsage || result.error || ['ERROR', 'STOPPED'].includes(result.verdict)) {
      run.status = 'ERROR'; run.error = result.error ?? result.verdict; break;
    }
  }
  if (run.status === 'RUNNING') run.status = run.requests.length === schedule.length ? 'COMPLETED' : 'INCOMPLETE';
} catch (error) {
  run.status = interrupted ? 'INTERRUPTED' : 'ERROR'; run.error = String(error); run.unknownUsage ||= activeRequest;
} finally {
  await Promise.all(children.map(stop));
  for (const handle of handles) await handle.close();
  process.off('SIGINT', onInterrupt); process.off('SIGTERM', onInterrupt);
  run.finishedAt = new Date().toISOString();
  run.sourceUnchanged = (await Promise.all(Object.entries(sourceHashes).map(async ([name, expected]) => sha(await fs.readFile(abs(baselineSources[name] ?? name))) === expected))).every(Boolean);
  if (!run.sourceUnchanged) { run.status = 'ERROR'; run.error = 'Source changed during experiment'; }
  await persist();
  console.log(JSON.stringify(run, null, 2));
}
if (run.status !== 'COMPLETED') process.exitCode = 1;
