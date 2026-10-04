import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const highDir = 'results/v3', lowDir = 'results/effort-followup';
const file = name => path.join(root, name);
const bytes = name => fs.readFile(file(name));
const json = async name => JSON.parse(await fs.readFile(file(name), 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => value.trim().normalize('NFC').replace(/\r\n/g, '\n');
const highManifestBytes = await bytes(highDir + '/manifest.json');
const highRunBytes = await bytes(highDir + '/run.json');
const highManifest = JSON.parse(highManifestBytes), highRun = JSON.parse(highRunBytes);
const lowManifest = await json(lowDir + '/manifest.json'), lowRun = await json(lowDir + '/run.json');
const casesBytes = await bytes(highDir + '/cases.json'), cases = JSON.parse(casesBytes);

assert.equal(highRun.status, 'COMPLETED');
assert.equal(highRun.unknownUsage, false);
assert.equal(highRun.requests.length, 30);
assert.equal(new Set(highRun.requests).size, 30);
assert.equal(lowRun.status, 'COMPLETED', 'Incomplete LOW run cannot establish savings');
assert.equal(lowRun.unknownUsage, false);
assert.deepEqual(lowRun.requests, Array.from({ length: 24 }, (_, i) => i));
assert.equal(lowManifest.schemaVersion, 'effort-followup-1');
assert.equal(lowManifest.baselineManifestSha256, sha(highManifestBytes));
assert.equal(lowManifest.baselineRunSha256, sha(highRunBytes));
assert.equal(lowManifest.datasetSha256, sha(casesBytes));
assert.equal(highManifest.datasetSha256, sha(casesBytes));
assert.equal(lowManifest.model, highManifest.model);
assert.equal(lowManifest.cliVersion, highManifest.cliVersion);
assert.equal(lowManifest.context, highManifest.context);
assert.equal(lowManifest.effort, 'LOW');
assert.equal(highManifest.effort, 'HIGH');
assert.equal(lowManifest.plannedCalls, 24);
assert.equal(lowManifest.schedule.length, 24);
assert.equal(cases.length, 24);
assert.equal(new Set(cases.map(c => c.id)).size, 24);
assert.equal(lowManifest.instructionsSha256, highManifest.sourceHashes['backend/src/main/resources/answer-instructions.txt']);
for (const [name, digest] of Object.entries(lowManifest.sourceHashes)) {
  assert.equal(sha(await bytes(name)), digest, 'Changed experiment source: ' + name);
}

function usageFrom(events) {
  assert.ok(!events.some(e => e.type === 'turn.failed' || e.type === 'error'));
  assert.ok(events.filter(e => e.type === 'item.completed').every(e => ['agent_message', 'reasoning'].includes(e.item?.type)));
  const turns = events.filter(e => e.type === 'turn.completed');
  assert.ok(turns.length > 0, 'Missing usage');
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 };
  const fields = { inputTokens: 'input_tokens', outputTokens: 'output_tokens', reasoningTokens: 'reasoning_output_tokens', cachedInputTokens: 'cached_input_tokens' };
  for (const turn of turns) {
    for (const [key, name] of Object.entries(fields)) {
      if (['inputTokens', 'outputTokens'].includes(key)) assert.ok(Object.hasOwn(turn.usage ?? {}, name), 'Missing ' + name);
      const amount = turn.usage?.[name] ?? 0;
      assert.ok(Number.isSafeInteger(amount) && amount >= 0, 'Invalid ' + name);
      usage[key] += amount;
      assert.ok(Number.isSafeInteger(usage[key]));
    }
  }
  assert.ok(usage.reasoningTokens <= usage.outputTokens);
  assert.ok(usage.cachedInputTokens <= usage.inputTokens);
  return usage;
}
async function trace(name) {
  const raw = await bytes(name);
  const events = raw.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const usage = usageFrom(events);
  const output = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').at(-1)?.item.text;
  assert.equal(typeof output, 'string');
  return { raw, usage, output };
}
function answer(output, id) {
  const parsed = JSON.parse(output);
  assert.ok(parsed && !Array.isArray(parsed));
  assert.deepEqual(Object.keys(parsed), ['answers']);
  assert.ok(Array.isArray(parsed.answers) && parsed.answers.length === 1);
  const item = parsed.answers[0];
  assert.deepEqual(Object.keys(item).sort(), ['answer', 'id']);
  assert.equal(item.id, id);
  assert.equal(typeof item.answer, 'string');
  return item.answer;
}
const empty = () => ({ calls: 0, passed: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0, totalTokens: 0, latencyMs: 0, rows: [] });
const arms = { SINGLE_HIGH: empty(), SINGLE_LOW: empty() };
const ids = { SINGLE_HIGH: new Set(), SINGLE_LOW: new Set() };
const paired = { bothCorrect: 0, highOnlyCorrect: 0, lowOnlyCorrect: 0, bothWrong: 0 };
for (const [index, c] of cases.entries()) {
  const plan = lowManifest.schedule[index];
  assert.equal(plan.index, index);
  assert.equal(plan.caseId, c.id);
  assert.ok(!ids.SINGLE_LOW.has(c.id));
  const sourceBytes = await bytes(plan.sourcePath);
  assert.equal(sha(sourceBytes), plan.sourceSha256);
  const source = JSON.parse(sourceBytes);
  const highIndex = highManifest.schedule.findIndex(p => p.arm === 'SINGLE_HIGH' && p.caseIds.length === 1 && p.caseIds[0] === c.id);
  assert.ok(highRun.requests.includes(highIndex));
  assert.equal(plan.sourcePath, highDir + '/requests/' + String(highIndex).padStart(2, '0') + '.json');
  const highCall = source.result.calls[0];
  assert.equal(source.arm, 'SINGLE_HIGH');
  assert.equal(source.result.status, 'COMPLETED');
  assert.equal(source.result.unknownUsage, false);
  assert.equal(source.result.calls.length, 1);
  assert.deepEqual(highCall.taskIds, [c.id]);
  assert.equal(highCall.generation.responseId, plan.sourceResponseId);
  assert.equal(sha(highCall.prompt), plan.promptSha256);
  assert.equal(sha(highCall.prompt + lowManifest.stdinSuffix), plan.stdinSha256);
  const delimiter = 'Tasks:\n';
  assert.deepEqual(JSON.parse(highCall.prompt.slice(highCall.prompt.indexOf(delimiter) + delimiter.length)), [{ id: c.id, task: c.prompt }]);

  const low = await json(lowDir + '/requests/' + String(index).padStart(2, '0') + '.json');
  assert.equal(low.index, index);
  assert.equal(low.caseId, c.id);
  assert.equal(low.effort, 'LOW');
  assert.equal(low.model, lowManifest.model);
  assert.equal(low.sourcePath, plan.sourcePath);
  assert.equal(low.prompt, highCall.prompt);
  assert.equal(low.promptSha256, plan.promptSha256);
  assert.equal(low.stdinSha256, plan.stdinSha256);
  assert.equal(low.result.status, 'COMPLETED');
  assert.equal(low.result.unknownUsage, false);
  assert.equal(low.result.process.exitCode, 0);
  assert.equal(low.result.process.timedOut, false);
  assert.equal(low.result.process.interrupted, false);
  assert.equal(low.result.error, null);
  assert.ok(!ids.SINGLE_HIGH.has(c.id));
  for (const [armName, record, responseId, tracePath] of [
    ['SINGLE_HIGH', source, highCall.generation.responseId, highDir + '/traces/' + highCall.generation.responseId + '.jsonl'],
    ['SINGLE_LOW', low, low.result.responseId, low.result.tracePath]
  ]) {
    assert.equal(tracePath, (armName === 'SINGLE_LOW' ? lowDir : highDir) + '/traces/' + responseId + '.jsonl');
    const inspected = await trace(tracePath);
    const savedUsage = armName === 'SINGLE_LOW' ? low.result.usage : highCall.generation.usage;
    assert.deepEqual(inspected.usage, savedUsage);
    if (armName === 'SINGLE_LOW') {
      assert.equal(sha(inspected.raw), low.result.traceSha256);
      assert.equal(inspected.output, low.result.output);
    } else {
      assert.deepEqual(inspected.usage, source.result.usage);
      assert.equal(inspected.output, highCall.generation.output);
    }
    const actual = answer(inspected.output, c.id);
    const passed = normalize(actual) === normalize(c.expectedAnswer);
    const verdict = passed ? 'PASS' : 'FAIL';
    if (armName === 'SINGLE_LOW') {
      assert.deepEqual(low.result.parsed, { id: c.id, answer: actual });
      assert.equal(low.result.verdict, verdict);
    } else {
      assert.equal(source.result.items.find(i => i.id === c.id)?.verdict, verdict);
    }
    const arm = arms[armName];
    arm.calls++;
    arm.passed += Number(passed);
    for (const key of Object.keys(inspected.usage)) arm[key] += inspected.usage[key];
    arm.totalTokens += inspected.usage.inputTokens + inspected.usage.outputTokens;
    arm.latencyMs += armName === 'SINGLE_LOW' ? low.result.latencyMs : highCall.generation.latencyMs;
    arm.rows.push({ id: c.id, title: c.title, category: c.category, passed, answer: actual,
      inputTokens: inspected.usage.inputTokens, outputTokens: inspected.usage.outputTokens,
      reasoningTokens: inspected.usage.reasoningTokens, cachedInputTokens: inspected.usage.cachedInputTokens });
    ids[armName].add(c.id);
    assert.equal(record.result.totalTokens, inspected.usage.inputTokens + inspected.usage.outputTokens);
  }
  const highPass = arms.SINGLE_HIGH.rows.at(-1).passed, lowPass = arms.SINGLE_LOW.rows.at(-1).passed;
  paired[highPass ? (lowPass ? 'bothCorrect' : 'highOnlyCorrect') : (lowPass ? 'lowOnlyCorrect' : 'bothWrong')]++;
}
assert.equal(arms.SINGLE_HIGH.calls, 24);
assert.equal(arms.SINGLE_LOW.calls, 24);
assert.equal(lowRun.knownTokens, arms.SINGLE_LOW.totalTokens);
assert.equal(highRun.knownTokens, (await json(highDir + '/metrics.json')).arms.BATCH_HIGH.totalTokens + arms.SINGLE_HIGH.totalTokens);
const categories = [...new Set(cases.map(c => c.category))].map(category => {
  const items = cases.filter(c => c.category === category);
  return { category, count: items.length, high: { passed: arms.SINGLE_HIGH.rows.filter(r => r.category === category && r.passed).length,
    tokens: arms.SINGLE_HIGH.rows.filter(r => r.category === category).reduce((n, r) => n + r.inputTokens + r.outputTokens, 0) },
    low: { passed: arms.SINGLE_LOW.rows.filter(r => r.category === category && r.passed).length,
      tokens: arms.SINGLE_LOW.rows.filter(r => r.category === category).reduce((n, r) => n + r.inputTokens + r.outputTokens, 0) } };
});
const savingsPercent = 100 * (arms.SINGLE_HIGH.totalTokens - arms.SINGLE_LOW.totalTokens) / arms.SINGLE_HIGH.totalTokens;
const metrics = { status: 'AUDIT_PASS', experimentComplete: true, measuredAt: lowRun.finishedAt,
  model: lowManifest.model, cliVersion: lowManifest.cliVersion,
  scope: 'Exploratory follow-up on 24 fixed synthetic cases. HIGH completed before LOW; one call per case and arm, with no retries.',
  arms, paired, categories, totalSavingsPercent: savingsPercent,
  observedQualityMaintained: arms.SINGLE_LOW.passed >= arms.SINGLE_HIGH.passed,
  reasoningOnlyMaximumSavingsPercent: 100 * (arms.SINGLE_HIGH.reasoningTokens / arms.SINGLE_HIGH.totalTokens),
  limitations: 'Order, time, and prompt cache are confounded. One draw per arm and case; no general routing claim or statistical significance.',
  checks: ['frozen case and baseline hashes', 'source and instruction hashes', 'all 24 LOW records and 24 HIGH records',
    'raw JSONL usage and outputs', 'identical prompts and answer grading', 'all known token costs', 'no tools or failed turns'] };
await fs.writeFile(file(lowDir + '/metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
console.log(JSON.stringify({ status: metrics.status, high: { tokens: arms.SINGLE_HIGH.totalTokens, passed: arms.SINGLE_HIGH.passed },
  low: { tokens: arms.SINGLE_LOW.totalTokens, passed: arms.SINGLE_LOW.passed }, savingsPercent, paired }, null, 2));
