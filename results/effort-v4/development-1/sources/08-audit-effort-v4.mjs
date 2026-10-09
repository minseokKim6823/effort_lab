import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ARMS = ['HIGH', 'LOW', 'LEGACY', 'CANDIDATE'];
const USAGE = ['inputTokens', 'outputTokens', 'reasoningTokens', 'cachedInputTokens'];
const ROUTER = 'backend/src/main/java/dev/effortlab/EffortRouter.java';
const SERVICE = 'backend/src/main/java/dev/effortlab/EvaluationService.java';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const integer = (n, label) => assert.ok(Number.isSafeInteger(n) && n >= 0, 'Invalid nonnegative integer: ' + label);
const sum = (a, b, label) => { const n = a + b; integer(n, label); return n; };
const emptyUsage = () => Object.fromEntries(USAGE.map(k => [k, 0]));
// Java String.strip uses Character.isWhitespace, which excludes nonbreaking
// spaces and includes the four ASCII information separators.
const normalize = value => value.replace(/^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+$/gu, '').normalize('NFC').replace(/\r\n/g, '\n');

// JSON.parse silently accepts duplicate keys. Reject them in every frozen artifact,
// including the raw event stream, so an ambiguous usage record cannot pass audit.
export function strictJson(text) {
  const parsed = JSON.parse(text);
  let at = 0;
  const whitespace = () => { while (at < text.length && /[\t\n\r ]/.test(text[at])) at++; };
  const string = () => {
    assert.equal(text[at], '"');
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
        assert.ok(!keys.has(key), 'Duplicate JSON field: ' + key); keys.add(key);
        whitespace(); assert.equal(text[at++], ':'); value(); whitespace();
        const delimiter = text[at++]; if (delimiter === '}') return;
        assert.equal(delimiter, ',');
      }
    }
    if (text[at] === '[') {
      at++; whitespace(); if (text[at] === ']') { at++; return; }
      while (true) {
        value(); whitespace(); const delimiter = text[at++];
        if (delimiter === ']') return; assert.equal(delimiter, ',');
      }
    }
    if (text[at] === '"') { string(); return; }
    while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
  };
  value(); whitespace(); assert.equal(at, text.length);
  return parsed;
}

function contained(base, relative) {
  assert.equal(typeof relative, 'string');
  assert.ok(relative.length > 0 && !path.isAbsolute(relative) && !relative.includes('\\'), 'Expected a relative slash path');
  const resolved = path.resolve(base, relative), relation = path.relative(base, resolved);
  assert.ok(relation && relation !== '..' && !relation.startsWith('..' + path.sep) && !path.isAbsolute(relation), 'Artifact escapes run directory');
  return resolved;
}

function checkUsage(usage, label) {
  assert.ok(usage && typeof usage === 'object' && !Array.isArray(usage), 'Missing usage: ' + label);
  assert.deepEqual(Object.keys(usage).sort(), [...USAGE].sort(), 'Unexpected usage fields: ' + label);
  for (const key of USAGE) integer(usage[key], label + '.' + key);
  assert.ok(usage.reasoningTokens <= usage.outputTokens, 'Reasoning is a subset of output tokens');
  assert.ok(usage.cachedInputTokens <= usage.inputTokens, 'Cached input exceeds input tokens');
  sum(usage.inputTokens, usage.outputTokens, label + '.totalTokens');
}

export function parseTrace(raw) {
  const events = raw.toString('utf8').split(/\r?\n/).filter(line => line.trim()).map(strictJson);
  assert.ok(events.length > 0, 'Empty trace');
  assert.ok(events.every(e => e && typeof e.type === 'string'), 'Malformed trace event');
  const permitted = new Set(['thread.started', 'turn.started', 'item.started', 'item.updated', 'item.completed', 'turn.completed']);
  assert.ok(events.every(e => permitted.has(e.type)), 'Unexpected or failed CLI event');
  assert.equal(events[0].type, 'thread.started');
  assert.equal(events[1]?.type, 'turn.started');
  assert.equal(events.filter(e => e.type === 'thread.started').length, 1, 'Expected one fresh CLI thread');
  assert.equal(events.filter(e => e.type === 'turn.started').length, 1, 'Expected one answer-only turn');
  assert.ok(!events.some(e => ['turn.failed', 'error'].includes(e.type)), 'Provider failed; usage may be incomplete');
  const items = events.filter(e => e.type.startsWith('item.'));
  assert.ok(items.every(e => ['agent_message', 'reasoning'].includes(e.item?.type)), 'Prohibited tool or unknown item in trace');
  const turns = events.filter(e => e.type === 'turn.completed');
  assert.equal(turns.length, 1, 'Expected exactly one complete usage report');
  assert.equal(events.at(-1).type, 'turn.completed', 'Trace has events after completion');
  const usage = emptyUsage();
  const fields = { inputTokens: 'input_tokens', outputTokens: 'output_tokens', reasoningTokens: 'reasoning_output_tokens', cachedInputTokens: 'cached_input_tokens' };
  for (const [key, field] of Object.entries(fields)) {
    assert.ok(Object.hasOwn(turns[0].usage ?? {}, field), 'Missing raw usage field: ' + field);
    usage[key] = turns[0].usage[field];
  }
  checkUsage(usage, 'trace');
  const messages = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message');
  assert.ok(messages.length > 0, 'Missing model answer');
  assert.ok(messages.every(e => typeof e.item.text === 'string'), 'Invalid model answer');
  return { usage, output: messages.at(-1).item.text };
}

// Recompute the route independently from the frozen Java patterns. Deliberately
// fail if the scoring algorithm changes, rather than guessing a new algorithm.
export function routerFromSnapshot(source, version) {
  assert.equal(source.match(/VERSION\s*=\s*"([^"]+)"/)?.[1], version, 'Router policy mismatch');
  const flat = source.replace(/\s+/g, ' ');
  for (const fragment of ['score += 80', 'score += 70', 'score += 30', 'length > 6000', 'length > 1200',
    'score >= 70 ? Effort.HIGH : score >= 30 ? Effort.MEDIUM : simple ? Effort.LOW : Effort.MEDIUM',
    'task.codePointCount(0, task.length())', 'Math.min(score,100)']) {
    assert.ok(flat.includes(fragment), 'Unsupported router scoring; auditor must be updated: ' + fragment);
  }
  const patterns = Object.fromEntries(['HARD', 'MEDIUM', 'SIMPLE'].map(name => {
    const expression = source.match(new RegExp('Pattern ' + name + '\\s*=\\s*Pattern\\.compile\\(([\\s\\S]*?),\\s*Pattern\\.CASE_INSENSITIVE\\)'))?.[1];
    assert.ok(expression, 'Missing frozen router pattern: ' + name);
    const strings = expression.match(/"(?:\\.|[^"\\])*"/g) ?? [];
    assert.ok(strings.length > 0 && /^[\s+]*$/.test(expression.replace(/"(?:\\.|[^"\\])*"/g, '')), 'Unsupported Java pattern expression');
    return [name, new RegExp(strings.map(JSON.parse).join(''), 'i')];
  }));
  return (task, risk) => {
    let score = risk === 'HIGH' ? 80 : 0;
    if (patterns.HARD.test(task)) score += 70;
    if (patterns.MEDIUM.test(task)) score += 30;
    const length = Array.from(task).length;
    if (length > 6000) score += 70; else if (length > 1200) score += 30;
    return { effort: score >= 70 ? 'HIGH' : score >= 30 ? 'MEDIUM' : patterns.SIMPLE.test(task) ? 'LOW' : 'MEDIUM', score: Math.min(score, 100) };
  };
}

function compareDecision(decision, expected, policy) {
  assert.ok(decision, 'Missing route decision');
  assert.equal(decision.policyVersion, policy);
  assert.equal(decision.effort, expected.effort, 'Predicted effort differs from frozen routing policy');
  assert.equal(decision.score, expected.score, 'Predicted score differs from frozen routing policy');
  assert.equal(decision.routingTokens, 0);
  integer(decision.routingMicros, 'routingMicros');
  assert.ok(Array.isArray(decision.reasons) && decision.reasons.length > 0 && decision.reasons.every(r => typeof r === 'string'));
}

function paired(left, right) {
  const result = { bothCorrect: 0, baselineOnlyCorrect: 0, comparisonOnlyCorrect: 0, bothWrong: 0 };
  for (const a of left) {
    const b = right.find(row => row.caseId === a.caseId);
    assert.ok(b, 'Missing paired case');
    result[a.finalPassed ? (b.finalPassed ? 'bothCorrect' : 'baselineOnlyCorrect') : (b.finalPassed ? 'comparisonOnlyCorrect' : 'bothWrong')]++;
  }
  return result;
}
const percentSaving = (baseline, measured) => baseline === 0 ? null : 100 * (baseline - measured) / baseline;
const emptyArm = () => ({ trials: 0, attempts: 0, retries: 0, retriedTrials: 0, firstPass: 0, finalPass: 0,
  ...emptyUsage(), totalTokens: 0, latencyMs: 0, failedAttemptTokens: 0, retryTokens: 0,
  initialEfforts: { LOW: 0, MEDIUM: 0, HIGH: 0 }, rows: [] });

export async function auditRun(directory) {
  const read = relative => fs.readFile(contained(directory, relative));
  const json = async relative => strictJson((await read(relative)).toString('utf8'));
  const manifestBytes = await read('manifest.json'), runBytes = await read('run.json');
  const manifest = strictJson(manifestBytes.toString('utf8')), run = strictJson(runBytes.toString('utf8'));
  assert.equal(manifest.schemaVersion, 'effort-v4-1');
  assert.ok(['development', 'holdout'].includes(manifest.phase));
  assert.equal(manifest.model, 'gpt-5.6-luna');
  assert.equal(typeof manifest.cliVersion, 'string');
  assert.ok(manifest.cliVersion.length > 0);
  assert.equal(manifest.baselinePolicy, 'rules-1.1');
  assert.match(manifest.candidatePolicy, /^rules-1\.(?:[2-9]|[1-9][0-9]+)$/);
  assert.match(manifest.baselineCommit, /^[a-f0-9]{40}$/);
  integer(manifest.tokenBudget, 'tokenBudget'); assert.ok(manifest.tokenBudget > 0);
  assert.equal(run.status, 'COMPLETED', 'Incomplete runs cannot establish quality or savings');
  assert.equal(run.unknownUsage, false, 'Unknown usage invalidates cost comparison');
  assert.equal(run.sourceUnchanged, true, 'Source changed during experiment');
  assert.ok(Number.isFinite(Date.parse(run.startedAt)) && Number.isFinite(Date.parse(run.finishedAt)));
  assert.ok(Date.parse(run.finishedAt) >= Date.parse(run.startedAt));

  assert.ok(Array.isArray(manifest.dataset) && manifest.dataset.length > 0);
  assert.equal(manifest.datasetSha256, sha(JSON.stringify(manifest.dataset) + '\n'), 'Frozen dataset hash mismatch');
  const dataset = new Map();
  for (const c of manifest.dataset) {
    for (const key of ['id', 'title', 'category', 'prompt', 'expectedAnswer']) assert.ok(typeof c[key] === 'string' && c[key].length > 0, 'Missing dataset ' + key);
    assert.ok(!dataset.has(c.id), 'Duplicate dataset case'); dataset.set(c.id, c);
  }
  assert.equal(manifest.plannedTrials, dataset.size * ARMS.length);
  assert.equal(manifest.schedule.length, manifest.plannedTrials);
  assert.deepEqual(run.requests, Array.from({ length: manifest.plannedTrials }, (_, i) => i), 'Missing, reordered, or duplicated request');
  assert.deepEqual(Object.keys(manifest.sourceHashes).sort(), Object.keys(manifest.sourceSnapshots).sort());
  const snapshots = {}, usedSnapshots = new Set();
  for (const [name, digest] of Object.entries(manifest.sourceHashes)) {
    assert.match(digest, /^[a-f0-9]{64}$/);
    const location = manifest.sourceSnapshots[name];
    assert.ok(!usedSnapshots.has(location), 'Duplicate source snapshot'); usedSnapshots.add(location);
    const bytes = await read(location);
    assert.equal(sha(bytes), digest, 'Frozen source hash mismatch: ' + name);
    snapshots[name] = bytes.toString('utf8');
  }
  for (const name of [ROUTER, SERVICE, 'baseline/' + ROUTER, 'baseline/' + SERVICE,
    'backend/src/main/java/dev/effortlab/ModelGateway.java', 'backend/src/main/java/dev/effortlab/AnswerVerifier.java',
    'backend/src/main/resources/answer-instructions.txt', 'scripts/measure-effort-v4.mjs', 'scripts/audit-effort-v4.mjs']) {
    assert.equal(typeof snapshots[name], 'string', 'Required source snapshot absent: ' + name);
  }
  assert.match(snapshots[SERVICE], /current\s*=\s*Effort\.HIGH\s*;/, 'Candidate must retry directly at HIGH');
  assert.match(snapshots['baseline/' + SERVICE], /current\s*=\s*current\.next\(\)\s*;/, 'Legacy must use staged retries');
  const routers = { LEGACY: routerFromSnapshot(snapshots['baseline/' + ROUTER], manifest.baselinePolicy),
    CANDIDATE: routerFromSnapshot(snapshots[ROUTER], manifest.candidatePolicy) };
  routers.HIGH = routers.CANDIDATE;
  routers.LOW = routers.CANDIDATE;
  const expectedNames = manifest.schedule.map((_, i) => String(i).padStart(3, '0') + '.json');
  assert.deepEqual((await fs.readdir(path.join(directory, 'requests'))).sort(), [...expectedNames].sort(), 'Unrecorded or missing request file');
  assert.deepEqual(Object.keys(run.requestHashes).sort(), [...expectedNames].sort(), 'Request hashes do not cover every request');
  const decisions = await json('decisions.json');
  assert.equal(decisions.length, manifest.plannedTrials);
  const arms = Object.fromEntries(ARMS.map(a => [a, emptyArm()]));
  const seen = new Set(), allTraces = new Set();
  let knownTokens = 0, previousStart = Date.parse(run.startedAt);
  for (const [i, plan] of manifest.schedule.entries()) {
    assert.equal(plan.index, i); assert.ok(ARMS.includes(plan.arm));
    assert.equal(plan.risk, plan.arm === 'HIGH' ? 'HIGH' : 'NORMAL');
    const c = dataset.get(plan.caseId); assert.ok(c, 'Unknown scheduled case');
    const pair = c.id + '/' + plan.arm;
    assert.ok(!seen.has(pair), 'Repeated case/arm'); seen.add(pair);
    const bytes = await read('requests/' + expectedNames[i]);
    assert.equal(sha(bytes), run.requestHashes[expectedNames[i]], 'Request hash mismatch: ' + expectedNames[i]);
    const record = strictJson(bytes.toString('utf8'));
    for (const key of ['index', 'caseId', 'arm', 'risk']) assert.equal(record[key], plan[key], 'Request differs from frozen schedule: ' + key);
    assert.equal(record.taskSha256, sha(c.prompt), 'Task differs from frozen dataset');
    const started = Date.parse(record.startedAt);
    assert.ok(Number.isFinite(started) && started >= previousStart && started <= Date.parse(run.finishedAt), 'Invalid request start time');
    previousStart = started;
    const result = record.result;
    assert.ok(result, 'Request result missing');
    assert.equal(result.strategy, ['HIGH', 'LOW'].includes(plan.arm) ? plan.arm : 'ADAPTIVE');
    assert.equal(result.unknownUsage, false); assert.equal(result.error, null);
    assert.ok(['PASS', 'FAIL'].includes(result.verdict), 'Unfinished or provider-failed execution');
    const policy = plan.arm === 'LEGACY' ? manifest.baselinePolicy : manifest.candidatePolicy;
    const predicted = routers[plan.arm](c.prompt, plan.risk);
    compareDecision(result.decision, predicted, policy);
    const preflight = decisions[i];
    for (const key of ['index', 'caseId', 'arm']) assert.equal(preflight[key], plan[key]);
    compareDecision(preflight.decision, predicted, policy);
    assert.ok(Array.isArray(result.attempts) && result.attempts.length > 0);
    assert.equal(record.traceFiles.length, result.attempts.length, 'Every attempted call must have a trace');
    if (['HIGH', 'LOW'].includes(plan.arm)) assert.equal(result.attempts.length, 1);
    const traceMap = new Map();
    for (const trace of record.traceFiles) {
      assert.match(trace.responseId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
      assert.equal(trace.path, 'traces/' + trace.responseId + '.jsonl');
      assert.ok(!traceMap.has(trace.responseId) && !allTraces.has(trace.path), 'Trace reused across attempts');
      traceMap.set(trace.responseId, trace); allTraces.add(trace.path);
    }
    const usage = emptyUsage(), attemptRows = [];
    let latencyMs = 0, effort = ['HIGH', 'LOW'].includes(plan.arm) ? plan.arm : predicted.effort;
    const initialEffort = effort;
    for (const [j, attempt] of result.attempts.entries()) {
      assert.equal(attempt.effort, effort, 'Attempt effort differs from route/retry policy');
      assert.equal(attempt.providerStatus, 'completed');
      const trace = traceMap.get(attempt.responseId); assert.ok(trace, 'Attempt has no matching trace');
      traceMap.delete(attempt.responseId);
      const raw = await read(trace.path); assert.equal(sha(raw), trace.sha256, 'Trace hash mismatch');
      const inspected = parseTrace(raw);
      assert.deepEqual(attempt.usage, inspected.usage, 'Saved usage differs from raw CLI usage');
      assert.equal(attempt.output, inspected.output, 'Saved answer differs from raw model output');
      const passed = normalize(inspected.output) === normalize(c.expectedAnswer);
      assert.equal(attempt.verdict, passed ? 'PASS' : 'FAIL', 'Incorrect exact-answer grading');
      integer(attempt.latencyMs, 'attempt.latencyMs'); latencyMs = sum(latencyMs, attempt.latencyMs, 'latencyMs');
      for (const key of USAGE) usage[key] = sum(usage[key], inspected.usage[key], key);
      const tokens = sum(inspected.usage.inputTokens, inspected.usage.outputTokens, 'attempt.totalTokens');
      attemptRows.push({ effort, passed, ...inspected.usage, totalTokens: tokens, latencyMs: attempt.latencyMs, responseId: attempt.responseId, answer: inspected.output });
      if (j < result.attempts.length - 1) {
        assert.ok(!passed && effort !== 'HIGH', 'Unexpected retry after success or HIGH');
        effort = plan.arm === 'LEGACY' && effort === 'LOW' ? 'MEDIUM' : 'HIGH';
      } else assert.ok(passed || effort === 'HIGH' || plan.arm === 'LOW', 'Failed lower effort is an incomplete adaptive trial');
    }
    assert.equal(traceMap.size, 0);
    checkUsage(result.usage, 'execution'); assert.deepEqual(result.usage, usage);
    const totalTokens = sum(usage.inputTokens, usage.outputTokens, 'execution.totalTokens');
    assert.equal(result.totalTokens, totalTokens); assert.equal(result.latencyMs, latencyMs);
    assert.equal(result.verdict, attemptRows.at(-1).passed ? 'PASS' : 'FAIL');
    assert.ok(knownTokens < manifest.tokenBudget, 'Runner continued after token stop threshold');
    knownTokens = sum(knownTokens, totalTokens, 'run.knownTokens');
    const arm = arms[plan.arm];
    arm.trials++; arm.attempts += attemptRows.length; arm.retries += attemptRows.length - 1;
    arm.retriedTrials += Number(attemptRows.length > 1); arm.initialEfforts[initialEffort]++;
    arm.firstPass += Number(attemptRows[0].passed); arm.finalPass += Number(attemptRows.at(-1).passed);
    for (const key of USAGE) arm[key] = sum(arm[key], usage[key], 'arm.' + key);
    arm.totalTokens = sum(arm.totalTokens, totalTokens, 'arm.totalTokens'); arm.latencyMs = sum(arm.latencyMs, latencyMs, 'arm.latencyMs');
    arm.failedAttemptTokens += attemptRows.filter(a => !a.passed).reduce((n, a) => n + a.totalTokens, 0);
    arm.retryTokens += attemptRows.slice(1).reduce((n, a) => n + a.totalTokens, 0);
    arm.rows.push({ caseId: c.id, title: c.title, category: c.category, firstPassed: attemptRows[0].passed,
      finalPassed: attemptRows.at(-1).passed, initialEffort, retries: attemptRows.length - 1,
      ...usage, totalTokens, latencyMs, attempts: attemptRows });
  }
  assert.equal(seen.size, manifest.plannedTrials);
  assert.equal(run.knownTokens, knownTokens, 'Run total excludes or duplicates usage');
  assert.deepEqual((await fs.readdir(path.join(directory, 'traces'))).map(name => 'traces/' + name).sort(), [...allTraces].sort(), 'Unaccounted or missing trace');
  for (const arm of Object.values(arms)) {
    assert.equal(arm.trials, dataset.size);
    arm.firstPassRate = arm.firstPass / arm.trials; arm.finalPassRate = arm.finalPass / arm.trials;
    arm.meanLatencyMs = arm.latencyMs / arm.trials;
    arm.tokensPerFinalSuccess = arm.finalPass === 0 ? null : arm.totalTokens / arm.finalPass;
  }
  const comparisons = {};
  for (const [baseline, measured] of [['HIGH', 'LOW'], ['HIGH', 'LEGACY'], ['HIGH', 'CANDIDATE'], ['LEGACY', 'CANDIDATE'], ['LOW', 'CANDIDATE']]) {
    const a = arms[baseline], b = arms[measured];
    comparisons[measured + '_vs_' + baseline] = { baseline, measured,
      totalSavingsPercent: percentSaving(a.totalTokens, b.totalTokens), outputSavingsPercent: percentSaving(a.outputTokens, b.outputTokens),
      latencySavingsPercent: percentSaving(a.latencyMs, b.latencyMs), firstPassDifference: b.firstPass - a.firstPass,
      finalPassDifference: b.finalPass - a.finalPass, observedQualityMaintained: b.finalPass >= a.finalPass,
      paired: paired(a.rows, b.rows) };
  }
  const categories = [...new Set([...dataset.values()].map(c => c.category))].map(category => ({ category,
    arms: Object.fromEntries(ARMS.map(name => {
      const rows = arms[name].rows.filter(row => row.category === category);
      return [name, { trials: rows.length, firstPass: rows.filter(r => r.firstPassed).length,
        finalPass: rows.filter(r => r.finalPassed).length, retries: rows.reduce((n, r) => n + r.retries, 0),
        totalTokens: rows.reduce((n, r) => n + r.totalTokens, 0), outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0) }];
    })) }));
  return { status: 'AUDIT_PASS', experimentComplete: true, phase: manifest.phase, runName: manifest.runName,
    measuredAt: run.finishedAt, model: manifest.model, cliVersion: manifest.cliVersion,
    baselinePolicy: manifest.baselinePolicy, candidatePolicy: manifest.candidatePolicy,
    manifestSha256: sha(manifestBytes), runSha256: sha(runBytes), datasetSha256: manifest.datasetSha256,
    plannedTrials: manifest.plannedTrials, knownTokens, tokenBudget: manifest.tokenBudget,
    tokenBudgetExceeded: knownTokens > manifest.tokenBudget, arms, comparisons, categories,
    accounting: 'Total = input + output. Reasoning is already included in output; cached input is already included in input. Every failed answer and retry is included.',
    limitations: ['Synthetic cases; one execution per arm and case. No statistical significance or general routing guarantee.',
      'Retries use a known exact answer in the local verifier. Findings apply to tasks with an equivalent available correctness check.',
      'Raw CLI events establish outputs and usage. Effort is checked against recorded attempts, route decisions and frozen service source; CLI events do not independently report its launch configuration.',
      'Latency comes from service measurements; CLI events do not contain independent timestamps. Dynamic provider input and caching can vary.',
      manifest.phase === 'development' ? 'Development results are used for policy tuning and cannot establish performance on unseen cases.' : 'Holdout from known synthetic families; transfer to other tasks is unmeasured.'],
    checks: ['complete frozen schedule with all four arms per case', 'dataset, request, trace and immutable source snapshot hashes',
      'independent routing prediction and every escalation', 'strict raw JSONL parsing and all four usage fields',
      'plain exact answers and first/final pass grading', 'all failed answers and retries charged', 'no unaccounted request or trace files'] };
}

async function main() {
  assert.equal(process.argv.length, 3, 'Usage: node scripts/audit-effort-v4.mjs development-1');
  const runName = process.argv[2]; assert.match(runName, /^(development|holdout)-[1-9][0-9]*$/);
  const directory = path.join(root, 'results', 'effort-v4', runName);
  try {
    const metrics = await auditRun(directory);
    await fs.writeFile(path.join(directory, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
    console.log(JSON.stringify({ status: metrics.status, phase: metrics.phase, knownTokens: metrics.knownTokens,
      arms: Object.fromEntries(ARMS.map(name => { const a = metrics.arms[name]; return [name, { trials: a.trials,
        firstPass: a.firstPass, finalPass: a.finalPass, retries: a.retries, totalTokens: a.totalTokens, outputTokens: a.outputTokens }]; })),
      comparisons: metrics.comparisons }, null, 2));
  } catch (error) {
    const failure = { status: 'AUDIT_FAIL', experimentComplete: false, runName, auditedAt: new Date().toISOString(), error: String(error) };
    // Replace any stale success metrics; never publish a partial comparison.
    await fs.writeFile(path.join(directory, 'metrics.json'), JSON.stringify(failure, null, 2) + '\n').catch(() => {});
    console.error(JSON.stringify(failure, null, 2)); process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
