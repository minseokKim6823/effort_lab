import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawn, execFile, execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const absolute = file => path.join(root, file);
const read = file => fs.readFile(absolute(file));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const json = async file => JSON.parse((await read(file)).toString('utf8'));
const flags = process.argv.slice(2);
assert.ok(flags.every(flag => flag === '--validate-only'), 'Only --validate-only is supported');
const dir = 'results/effort-followup', budget = 110000;
const baselineBytes = await read('results/v3/manifest.json'), baseline = JSON.parse(baselineBytes);
const baselineRunBytes = await read('results/v3/run.json'), baselineRun = JSON.parse(baselineRunBytes);
assert.equal(baselineRun.status, 'COMPLETED', 'Complete v3 before starting the LOW follow-up');
assert.equal(baselineRun.unknownUsage, false);
assert.equal(baselineRun.requests.length, 30);
assert.equal(new Set(baselineRun.requests).size, 30);
assert.equal(baseline.model, 'gpt-5.6-luna');
assert.equal(baseline.cliVersion, 'codex-cli 0.153.4');
assert.equal(baseline.context, 'answer-only-v1');
assert.equal(baseline.effort, 'HIGH');
const datasetBytes = await read('results/v3/cases.json'), cases = JSON.parse(datasetBytes);
assert.equal(sha(datasetBytes), baseline.datasetSha256);
assert.equal(cases.length, 24);
assert.equal(new Set(cases.map(c => c.id)).size, 24);
const work = absolute('.tools/batch-measurement/data/runner');
const childCwd = absolute('.tools/batch-measurement');
const instructions = path.join(work, 'answer-instructions.txt');
const instructionsBytes = await fs.readFile(instructions);
assert.equal(sha(instructionsBytes), baseline.sourceHashes['backend/src/main/resources/answer-instructions.txt']);
assert.equal(sha(await read('backend/src/main/resources/answer-instructions.txt')), sha(instructionsBytes));
const codex = absolute('desktop/node_modules/@openai/codex/bin/codex.js');
const childEnv = { ...process.env };
delete childEnv.OPENAI_API_KEY;
delete childEnv.CODEX_API_KEY;
const cliVersion = execFileSync(process.execPath, [codex, '--version'], { env: childEnv, cwd: childCwd, encoding: 'utf8', windowsHide: true }).trim();
assert.equal(cliVersion, baseline.cliVersion);
const suffix = '\n\n문제의 답만 출력하세요. 도구를 사용하지 마세요.';
const schedule = [];
for (const [index, c] of cases.entries()) {
  const sourceIndex = baseline.schedule.findIndex(plan => plan.arm === 'SINGLE_HIGH' && plan.caseIds.length === 1 && plan.caseIds[0] === c.id);
  assert.ok(sourceIndex >= 0 && baselineRun.requests.includes(sourceIndex));
  const sourcePath = 'results/v3/requests/' + String(sourceIndex).padStart(2, '0') + '.json';
  const sourceBytes = await read(sourcePath), source = JSON.parse(sourceBytes);
  assert.equal(source.arm, 'SINGLE_HIGH');
  assert.equal(source.result.status, 'COMPLETED');
  assert.equal(source.result.unknownUsage, false);
  assert.equal(source.result.model, baseline.model);
  assert.equal(source.result.calls.length, 1);
  const call = source.result.calls[0];
  assert.deepEqual(call.taskIds, [c.id]);
  assert.equal(call.parseError, null);
  assert.equal(call.generation.providerStatus, 'completed');
  assert.equal(typeof call.prompt, 'string');
  const delimiter = 'Tasks:\n', split = call.prompt.indexOf(delimiter);
  assert.ok(split >= 0);
  assert.deepEqual(JSON.parse(call.prompt.slice(split + delimiter.length)), [{ id: c.id, task: c.prompt }]);
  schedule.push({ index, caseId: c.id, sourcePath, sourceSha256: sha(sourceBytes), sourceResponseId: call.generation.responseId,
    promptSha256: sha(call.prompt), stdinSha256: sha(call.prompt + suffix), prompt: call.prompt });
}
assert.equal(schedule.length, 24);
const args = [codex, 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--json',
  '-s', 'read-only', '-C', work, '-m', baseline.model,
  '-c', 'model_reasoning_effort=low', '-c', 'approval_policy=never', '-c', 'web_search=disabled',
  '--disable', 'shell_tool', '--disable', 'apps', '--disable', 'multi_agent',
  '-c', 'model_instructions_file=' + JSON.stringify(instructions), '-c', 'project_doc_max_bytes=0', '-'];
const sourceFiles = ['scripts/measure-effort-followup.mjs', 'scripts/audit-effort-followup.mjs', 'docs/effort-followup-plan.md',
  'backend/src/main/java/dev/effortlab/ModelGateway.java', 'backend/src/main/resources/answer-instructions.txt'];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha(await read(file))])));
assert.equal(sourceHashes['backend/src/main/java/dev/effortlab/ModelGateway.java'], baseline.sourceHashes['backend/src/main/java/dev/effortlab/ModelGateway.java']);
const manifest = { schemaVersion: 'effort-followup-1', startedAt: new Date().toISOString(),
  model: baseline.model, effort: 'LOW', context: baseline.context, cliVersion, node: process.version,
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  tokenBudget: budget, timeoutSeconds: 180, plannedCalls: 24, datasetPath: 'results/v3/cases.json',
  datasetSha256: sha(datasetBytes), baselineManifestSha256: sha(baselineBytes), baselineRunSha256: sha(baselineRunBytes),
  sourceHashes, instructionsSha256: sha(instructionsBytes), childCwd, nodeBinary: process.execPath, args, stdinSuffix: suffix,
  authentication: 'Existing Codex subscription login; OPENAI_API_KEY and CODEX_API_KEY removed from child environment',
  ordering: 'All 24 LOW calls after the completed HIGH study; fixed dataset order; no retries or exclusions',
  limitations: 'Exploratory follow-up: arm order, time and prompt-cache effects are confounded. One draw per arm and case.',
  schedule: schedule.map(({ prompt, ...plan }) => plan) };
if (flags.includes('--validate-only')) {
  console.log(JSON.stringify({ status: 'PREFLIGHT_PASS_NO_MODEL_CALLS', cases: 24, cliVersion, datasetSha256: manifest.datasetSha256 }, null, 2));
  process.exit(0);
}
await fs.mkdir(absolute(dir), { recursive: true });
await fs.writeFile(absolute(dir + '/manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
await fs.mkdir(absolute(dir + '/requests'), { recursive: true });
await fs.mkdir(absolute(dir + '/traces'), { recursive: true });
const run = { status: 'RUNNING', startedAt: manifest.startedAt, requests: [], knownTokens: 0, unknownUsage: false };
let activeChild = null, interrupted = false;
const persist = () => fs.writeFile(absolute(dir + '/run.json'), JSON.stringify(run, null, 2) + '\n');

// Reject duplicate JSON object fields as well as invalid/trailing JSON.
function strictJson(text) {
  const parsed = JSON.parse(text);
  let at = 0;
  const whitespace = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    throw Error('Unterminated JSON string');
  };
  const value = () => {
    whitespace();
    if (text[at] === '{') {
      at++; whitespace(); const keys = new Set();
      if (text[at] === '}') { at++; return; }
      while (true) {
        whitespace(); const key = string();
        if (keys.has(key)) throw Error('Duplicate JSON field: ' + key);
        keys.add(key); whitespace(); at++; value(); whitespace();
        if (text[at++] === '}') return;
      }
    }
    if (text[at] === '[') {
      at++; whitespace();
      if (text[at] === ']') { at++; return; }
      while (true) { value(); whitespace(); if (text[at++] === ']') return; }
    }
    if (text[at] === '"') { string(); return; }
    while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
  };
  value(); whitespace(); assert.equal(at, text.length);
  return parsed;
}
function parseTrace(raw) {
  const events = raw.split(/\r?\n/).filter(line => line.trim()).map(strictJson);
  const turns = events.filter(event => event.type === 'turn.completed');
  if (!turns.length) throw Error('No completed usage was reported');
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 };
  const fields = { inputTokens: 'input_tokens', outputTokens: 'output_tokens', reasoningTokens: 'reasoning_output_tokens', cachedInputTokens: 'cached_input_tokens' };
  for (const turn of turns) {
    const item = {};
    for (const [key, rawKey] of Object.entries(fields)) {
      const present = turn.usage && Object.hasOwn(turn.usage, rawKey);
      if (!present && ['inputTokens', 'outputTokens'].includes(key)) throw Error('Missing usage field: ' + rawKey);
      const amount = present ? turn.usage[rawKey] : 0;
      if (!Number.isSafeInteger(amount) || amount < 0) throw Error('Invalid usage field: ' + rawKey);
      item[key] = amount; usage[key] += amount;
      if (!Number.isSafeInteger(usage[key])) throw Error('Usage sum overflow');
    }
    if (item.reasoningTokens > item.outputTokens || item.cachedInputTokens > item.inputTokens) throw Error('Usage subset exceeds total');
  }
  if (!Number.isSafeInteger(usage.inputTokens + usage.outputTokens)) throw Error('Total usage overflow');
  const messages = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message');
  const output = messages.at(-1)?.item.text;
  if (typeof output !== 'string') throw Error('Missing final model output');
  const failed = events.some(event => ['turn.failed', 'error'].includes(event.type));
  const toolUsed = events.some(event => event.type === 'item.completed' && !['agent_message', 'reasoning'].includes(event.item?.type));
  return { usage, output, turns: turns.length, failed, toolUsed };
}
function parseAnswer(output, id) {
  const value = strictJson(output);
  if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !Array.isArray(value.answers) || value.answers.length !== 1) throw Error('Expected exactly one answers entry');
  const answer = value.answers[0];
  if (!answer || Array.isArray(answer) || Object.keys(answer).length !== 2 || answer.id !== id || typeof answer.answer !== 'string') throw Error('Unexpected ID or answer schema');
  return { id: answer.id, answer: answer.answer };
}
async function stopOwnChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, timeout: 10000 }, () => resolve()));
  } else child.kill('SIGKILL');
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}
const onInterrupt = () => { interrupted = true; void stopOwnChild(activeChild); };
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);
async function execute(plan, reference) {
  const responseId = crypto.randomUUID(), tracePath = dir + '/traces/' + responseId + '.jsonl';
  const result = { status: 'ERROR', unknownUsage: false, usage: null, totalTokens: null, output: null,
    parsed: null, verdict: 'ERROR', responseId, tracePath, error: null, process: null };
  const startedAt = new Date().toISOString(), began = performance.now();
  const handle = await fs.open(absolute(tracePath), 'wx');
  let started = false, timedOut = false, stdinError = null;
  try {
    const child = spawn(process.execPath, args, { cwd: childCwd, env: childEnv, stdio: ['pipe', handle.fd, 'ignore'], windowsHide: true });
    activeChild = child;
    const processResult = await new Promise(resolve => {
      let finished = false;
      const finish = value => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => { timedOut = true; void stopOwnChild(child); }, 180000);
      child.once('spawn', () => { started = true; });
      child.once('error', error => finish({ exitCode: null, signal: null, spawnError: String(error) }));
      child.once('close', (exitCode, signal) => finish({ exitCode, signal, spawnError: null }));
      child.stdin.on('error', error => { stdinError = String(error); void stopOwnChild(child); });
      child.stdin.end(plan.prompt + suffix, 'utf8');
    });
    result.process = { ...processResult, started, timedOut, interrupted, stdinError };
  } finally {
    await stopOwnChild(activeChild);
    activeChild = null;
    await handle.close();
    result.latencyMs = Math.round(performance.now() - began);
  }
  const raw = await fs.readFile(absolute(tracePath), 'utf8');
  result.traceSha256 = sha(raw);
  let parsedTrace;
  try {
    parsedTrace = parseTrace(raw);
    result.usage = parsedTrace.usage;
    result.totalTokens = result.usage.inputTokens + result.usage.outputTokens;
    result.output = parsedTrace.output;
  } catch (error) { result.unknownUsage = started; result.error = String(error); }
  if (result.process.exitCode !== 0 || timedOut || interrupted || stdinError || parsedTrace?.failed) {
    result.unknownUsage ||= started;
    result.error = result.error ?? 'Provider process failed, was interrupted, or reported a failed turn';
  } else if (parsedTrace?.toolUsed) result.error = 'Provider used a prohibited tool';
  if (!result.error) {
    try {
      result.parsed = parseAnswer(result.output, plan.caseId);
      const normalize = value => value.trim().normalize('NFC').replace(/\r\n/g, '\n');
      result.verdict = normalize(result.parsed.answer) === normalize(reference.expectedAnswer) ? 'PASS' : 'FAIL';
      result.status = 'COMPLETED';
    } catch (error) { result.error = String(error); }
  }
  return { index: plan.index, caseId: plan.caseId, effort: 'LOW', model: baseline.model, startedAt,
    sourcePath: plan.sourcePath, prompt: plan.prompt, promptSha256: plan.promptSha256,
    stdinSha256: plan.stdinSha256, result };
}
await persist();
try {
  for (const plan of schedule) {
    if (interrupted) { run.status = 'INTERRUPTED'; break; }
    if (run.knownTokens >= budget) { run.status = 'BUDGET_EXCEEDED'; break; }
    console.log('START ' + (plan.index + 1) + '/24 LOW ' + plan.caseId);
    const record = await execute(plan, cases.find(c => c.id === plan.caseId));
    await fs.writeFile(absolute(dir + '/requests/' + String(plan.index).padStart(2, '0') + '.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    run.requests.push(plan.index);
    if (record.result.totalTokens !== null) run.knownTokens += record.result.totalTokens;
    run.unknownUsage ||= record.result.unknownUsage;
    console.log('DONE ' + (plan.index + 1) + '/24 ' + record.result.verdict + ' ' + (record.result.totalTokens ?? 'unknown') + ' tokens');
    if (record.result.status !== 'COMPLETED' || record.result.unknownUsage) {
      run.status = interrupted ? 'INTERRUPTED' : 'ERROR'; run.error = record.result.error;
      await persist(); break;
    }
    await persist();
  }
  if (run.status === 'RUNNING') run.status = run.requests.length === 24 ? 'COMPLETED' : 'INCOMPLETE';
} catch (error) {
  run.status = 'ERROR'; run.error = String(error); run.unknownUsage = true;
} finally {
  await stopOwnChild(activeChild);
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onInterrupt);
  run.finishedAt = new Date().toISOString();
  await persist();
  console.log(JSON.stringify(run, null, 2));
}
if (run.status !== 'COMPLETED') process.exitCode = 1;
