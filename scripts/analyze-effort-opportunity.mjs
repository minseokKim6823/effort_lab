import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Diagnostic only: no model calls, no policy fitting, no v2 files are changed.
const root = new URL('../', import.meta.url);
const resolve = file => new URL(file, root);
const bytes = file => fs.readFile(resolve(file));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const reportBytes = await bytes('results/v2/report.json');
const casesBytes = await bytes('results/v2/cases.json');
const report = JSON.parse(reportBytes), cases = JSON.parse(casesBytes);
const strategies = ['DEFAULT_HIGH', 'HIGH', 'LOW', 'ADAPTIVE'];
const usageKeys = ['inputTokens', 'outputTokens', 'reasoningTokens', 'cachedInputTokens'];
const rawKeys = { inputTokens: 'input_tokens', outputTokens: 'output_tokens', reasoningTokens: 'reasoning_output_tokens', cachedInputTokens: 'cached_input_tokens' };
const zero = () => Object.fromEntries(usageKeys.map(key => [key, 0]));
const plus = (left, right) => Object.fromEntries(usageKeys.map(key => [key, left[key] + right[key]]));
const total = usage => usage.inputTokens + usage.outputTokens;
const sum = values => values.reduce((acc, value) => acc + value, 0);
const percent = (part, whole) => whole === 0 ? null : part / whole * 100;
const saving = (baseline, candidate) => (baseline - candidate) / baseline * 100;
const normalize = answer => answer.trim().normalize('NFC').replace(/\r\n/g, '\n');
const isPassed = trial => trial.execution.verdict === 'PASS';
const rows = report.trials.filter(trial => trial.repetition === 1);
const caseMap = new Map(cases.map(testCase => [testCase.id, testCase]));
assert.equal(cases.length, 12);
assert.equal(caseMap.size, 12);
assert.equal(rows.length, 48);
assert.equal(report.mode, 'CODEX');
for (const strategy of strategies) {
  const selected = rows.filter(trial => trial.execution.strategy === strategy);
  assert.equal(selected.length, 12);
  assert.deepEqual(new Set(selected.map(trial => trial.caseId)), new Set(caseMap.keys()));
}
const seenCalls = new Set(), traces = [], trialDetails = [];
for (const trial of rows) {
  const execution = trial.execution, reference = caseMap.get(trial.caseId);
  assert.ok(reference);
  assert.equal(execution.unknownUsage, false);
  assert.equal(execution.error, null);
  assert.ok(execution.attempts.length > 0);
  let usage = zero();
  const attempts = [];
  for (const [attemptIndex, attempt] of execution.attempts.entries()) {
    assert.ok(!seenCalls.has(attempt.responseId));
    seenCalls.add(attempt.responseId);
    const filename = 'results/v2/traces/' + attempt.responseId + '.jsonl';
    const raw = await bytes(filename);
    const events = raw.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const turns = events.filter(event => event.type === 'turn.completed');
    assert.ok(turns.length > 0);
    assert.ok(!events.some(event => ['turn.failed', 'error'].includes(event.type)));
    assert.ok(events.filter(event => event.type === 'item.completed').every(event => ['agent_message', 'reasoning'].includes(event.item.type)));
    let metered = zero();
    for (const turn of turns) {
      const values = {};
      for (const key of usageKeys) {
        const rawKey = rawKeys[key], present = Object.hasOwn(turn.usage, rawKey);
        if (['inputTokens', 'outputTokens'].includes(key)) assert.ok(present, 'Missing mandatory usage');
        const value = present ? turn.usage[rawKey] : 0;
        assert.ok(Number.isSafeInteger(value) && value >= 0, 'Invalid metered usage');
        values[key] = value;
      }
      assert.ok(values.reasoningTokens <= values.outputTokens);
      assert.ok(values.cachedInputTokens <= values.inputTokens);
      metered = plus(metered, values);
    }
    assert.deepEqual(attempt.usage, metered);
    assert.equal(attempt.providerStatus, 'completed');
    const output = events.filter(event => event.type === 'item.completed' && event.item.type === 'agent_message').at(-1)?.item.text;
    assert.equal(attempt.output, output);
    assert.equal(attempt.verdict, normalize(output) === normalize(reference.expectedAnswer) ? 'PASS' : 'FAIL');
    assert.ok(Number.isSafeInteger(attempt.latencyMs) && attempt.latencyMs >= 0);
    usage = plus(usage, metered);
    traces.push({ path: filename, sha256: sha256(raw), turns: turns.length });
    attempts.push({ index: attemptIndex + 1, effort: attempt.effort, verdict: attempt.verdict, output,
      usage: metered, totalTokens: total(metered), latencyMs: attempt.latencyMs, responseId: attempt.responseId });
  }
  assert.deepEqual(execution.usage, usage);
  assert.equal(execution.totalTokens, total(usage));
  assert.equal(execution.latencyMs, sum(attempts.map(attempt => attempt.latencyMs)));
  assert.equal(execution.verdict, attempts.at(-1).verdict);
  if (execution.strategy !== 'ADAPTIVE') assert.equal(attempts.length, 1);
  trialDetails.push({ caseId: trial.caseId, title: reference.title, category: trial.category, strategy: execution.strategy,
    verdict: execution.verdict, expectedAnswer: reference.expectedAnswer, decision: execution.decision,
    attempts, usage, totalTokens: total(usage) });
}
assert.equal(seenCalls.size, 49);

function zeroReasoningCeiling(usage) {
  // This subtraction is a residual of provider counters, not a separately tokenized answer.
  const nonReasoningOutputResidual = usage.outputTokens - usage.reasoningTokens;
  return {
    hypothesis: 'Remove only reported reasoning tokens while retaining all observed input and other output tokens. Accuracy preservation is not assumed.',
    retainedInputTokens: usage.inputTokens,
    retainedNonReasoningOutputResidual: nonReasoningOutputResidual,
    residualDefinition: 'output_tokens minus reasoning_output_tokens; a derived residual, not a separate measurement of visible answer tokenization',
    hypotheticalTotalTokens: usage.inputTokens + nonReasoningOutputResidual,
    maximumTokensSavedUnderFixedInputAndOtherOutput: usage.reasoningTokens,
    maximumSavingsPercentUnderFixedInputAndOtherOutput: percent(usage.reasoningTokens, total(usage)),
    achieved: false,
  };
}
function summarize(selected) {
  const usage = selected.reduce((acc, trial) => plus(acc, trial.execution.usage), zero());
  return {
    trials: selected.length, passed: selected.filter(isPassed).length,
    passRatePercent: percent(selected.filter(isPassed).length, selected.length),
    calls: sum(selected.map(trial => trial.execution.attempts.length)),
    retries: sum(selected.map(trial => trial.execution.attempts.length - 1)),
    usage, totalTokens: total(usage),
    fractionPercent: { inputOfTotal: percent(usage.inputTokens, total(usage)), outputOfTotal: percent(usage.outputTokens, total(usage)),
      reasoningOfTotal: percent(usage.reasoningTokens, total(usage)), reasoningOfOutput: percent(usage.reasoningTokens, usage.outputTokens) },
    fixedInputZeroReasoningCeiling: zeroReasoningCeiling(usage),
  };
}
const arms = Object.fromEntries(strategies.map(strategy => [strategy, summarize(rows.filter(trial => trial.execution.strategy === strategy))]));
const byCase = (id, strategy) => rows.find(trial => trial.caseId === id && trial.execution.strategy === strategy);
const paired = { bothCorrect: 0, lowOnlyCorrect: 0, highOnlyCorrect: 0, bothWrong: 0 };
const pairDetails = cases.map(reference => {
  const low = byCase(reference.id, 'LOW'), high = byCase(reference.id, 'HIGH');
  const label = isPassed(low) ? (isPassed(high) ? 'bothCorrect' : 'lowOnlyCorrect') : (isPassed(high) ? 'highOnlyCorrect' : 'bothWrong');
  paired[label]++;
  return { caseId: reference.id, title: reference.title, category: reference.category, outcome: label,
    low: { passed: isPassed(low), totalTokens: low.execution.totalTokens, usage: low.execution.usage },
    high: { passed: isPassed(high), totalTokens: high.execution.totalTokens, usage: high.execution.usage },
    observedLowSavingsPercent: saving(high.execution.totalTokens, low.execution.totalTokens) };
});

function lowThenHighBreakEven(ids) {
  const lowRows = ids.map(id => byCase(id, 'LOW')), highRows = ids.map(id => byCase(id, 'HIGH'));
  const lowTotal = sum(lowRows.map(trial => trial.execution.totalTokens));
  const highTotal = sum(highRows.map(trial => trial.execution.totalTokens));
  const lowPassed = lowRows.filter(isPassed).length, requiredPassProbabilityStrictlyGreaterThan = lowTotal / highTotal;
  const observedLowPassProbability = lowPassed / ids.length;
  const estimatedCascadeTokensAtObservedRate = lowTotal + (1 - observedLowPassProbability) * highTotal;
  // The fallback costs below come from independent HIGH runs, not actual live cascade calls.
  const fallbackIds = lowRows.filter(trial => !isPassed(trial)).map(trial => trial.caseId);
  const replayTotal = lowTotal + sum(fallbackIds.map(id => byCase(id, 'HIGH').execution.totalTokens));
  return {
    cases: ids.length, lowTotalTokens: lowTotal, highTotalTokens: highTotal,
    meanLowTokens: lowTotal / ids.length, meanHighTokens: highTotal / ids.length,
    formula: 'C_low + (1-p)*C_high < C_high iff p > C_low/C_high',
    assumption: 'Average HIGH fallback cost equals average unconditional HIGH cost; perfect free correctness verification; no verifier, router, latency, or repair overhead',
    requiredPassProbabilityStrictlyGreaterThan, observedLowPassProbability,
    thresholdWithinProbabilityRange: requiredPassProbabilityStrictlyGreaterThan < 1,
    estimatedCascadeTokensAtObservedRate, estimatedSavingsPercent: saving(highTotal, estimatedCascadeTokensAtObservedRate),
    oracleGatedReplay: { kind: 'COUNTERFACTUAL_DIAGNOSTIC_NOT_A_DEPLOYABLE_POLICY',
      note: 'Labels trigger fallback, and independent recorded HIGH outcomes/costs are replayed. This is not a measured live cascade.',
      fallbackCaseIds: fallbackIds, totalTokens: replayTotal, savingsPercent: saving(highTotal, replayTotal),
      passed: ids.filter(id => isPassed(byCase(id, 'LOW')) || isPassed(byCase(id, 'HIGH'))).length },
  };
}
const categories = [...new Set(cases.map(reference => reference.category))];
const breakEven = { global: lowThenHighBreakEven(cases.map(reference => reference.id)),
  byCategory: Object.fromEntries(categories.map(category => [category, lowThenHighBreakEven(cases.filter(reference => reference.category === category).map(reference => reference.id))])) };

// An optimistic envelope uses outcome labels unavailable to a pre-call router.
const envelopeRows = cases.map(reference => {
  const options = ['LOW', 'HIGH'].map(strategy => byCase(reference.id, strategy));
  const correct = options.filter(isPassed), eligible = correct.length ? correct : options;
  const selected = [...eligible].sort((a, b) => a.execution.totalTokens - b.execution.totalTokens || (a.execution.strategy === 'LOW' ? -1 : 1))[0];
  return { caseId: reference.id, selectedStrategy: selected.execution.strategy, totalTokens: selected.execution.totalTokens,
    passed: isPassed(selected), bothFailed: correct.length === 0 };
});
const envelopeTotal = sum(envelopeRows.map(row => row.totalTokens));
const adaptive = rows.filter(trial => trial.execution.strategy === 'ADAPTIVE');
const retryTrials = adaptive.filter(trial => trial.execution.attempts.length > 1).map(trial => {
  const baseline = byCase(trial.caseId, 'HIGH');
  const first = trial.execution.attempts[0], subsequent = trial.execution.attempts.slice(1);
  return { caseId: trial.caseId, category: trial.category, firstEffort: first.effort, firstVerdict: first.verdict,
    firstAttemptTokens: total(first.usage), retryAttempts: subsequent.length, retryTokens: sum(subsequent.map(attempt => total(attempt.usage))),
    adaptiveTotalTokens: trial.execution.totalTokens, matchedIndependentHighTokens: baseline.execution.totalTokens,
    excessTokensComparedWithIndependentHigh: trial.execution.totalTokens - baseline.execution.totalTokens,
    firstPass: first.verdict === 'PASS', finalPass: isPassed(trial),
    attempts: trialDetails.find(detail => detail.caseId === trial.caseId && detail.strategy === 'ADAPTIVE').attempts };
});
const firstAttemptTokens = sum(adaptive.map(trial => total(trial.execution.attempts[0].usage)));
const retryTokens = sum(retryTrials.map(trial => trial.retryTokens));
const medium = adaptive.filter(trial => trial.execution.attempts[0].effort === 'MEDIUM');
const mediumFirstTokens = sum(medium.map(trial => total(trial.execution.attempts[0].usage)));
const mediumMatchedHigh = sum(medium.map(trial => byCase(trial.caseId, 'HIGH').execution.totalTokens));
const mediumFinal = sum(medium.map(trial => trial.execution.totalTokens));
const output = {
  status: 'PARTIAL_SOURCE_DIAGNOSTIC_AUDIT_PASS',
  source: { reportId: report.id, model: report.model, status: report.status, fullExperimentComplete: false,
    fullExperimentPlannedTrials: report.plannedTrials, fullExperimentRecordedTrials: report.trials.length,
    fullExperimentUnknownUsage: report.unknownUsage, selectedRepetition: 1, selectedCases: 12, selectedTrials: rows.length,
    verifiedRawCalls: seenCalls.size, excludedLaterRepetitionTrials: report.trials.length - rows.length,
    selection: 'All 12 cases and all 4 arms in the first fully completed repetition, including all incorrect answers. Later incomplete repetition is excluded from every primary metric.',
    reportSha256: sha256(reportBytes), casesSha256: sha256(casesBytes) },
  interpretation: {
    scope: 'One observed draw per fixed arm and case, plus actual adaptive retries, in 12 known synthetic cases. This is exploratory retrospective analysis, not held-out policy evaluation.',
    cost: 'Provider-reported input + output tokens; reasoning is included in output, cached input is included in input. No money or subscription-quota conversion.',
    ceilings: 'Fixed-input reasoning-removal ceilings are accounting counterfactuals, not proven attainable savings or preserved correctness.',
    oracle: 'Outcome-aware selection and fallback require ground-truth labels and therefore cannot be used as evidence that a deployable router reaches these numbers.',
    selectionWarning: 'Do not select a policy using these labels and then present its replay on these same 12 cases as a new measured improvement.',
  },
  arms,
  lowComparedWithHigh: { totalSavingsPercent: saving(arms.HIGH.totalTokens, arms.LOW.totalTokens),
    outputSavingsPercent: saving(arms.HIGH.usage.outputTokens, arms.LOW.usage.outputTokens),
    paired, cases: pairDetails },
  lowThenHighRetryBreakEven: breakEven,
  oracleCandidateEnvelope: {
    kind: 'ORACLE_DIAGNOSTIC_NOT_DEPLOYABLE_NOT_A_NEW_MODEL_RUN',
    selectionRule: 'Choose cheaper correct LOW/HIGH observed response; when both fail, choose cheaper observed response and retain FAIL. Stable tie favors LOW.',
    totalTokens: envelopeTotal, passed: envelopeRows.filter(row => row.passed).length,
    bothFailedCaseIds: envelopeRows.filter(row => row.bothFailed).map(row => row.caseId),
    savingsPercentVersusHigh: saving(arms.HIGH.totalTokens, envelopeTotal),
    savingsPercentVersusLow: saving(arms.LOW.totalTokens, envelopeTotal),
    excludedCases: 0, rows: envelopeRows },
  adaptiveRetries: {
    firstAttemptTokens, retryTokens, finalTotalTokens: arms.ADAPTIVE.totalTokens,
    retryShareOfActualTotalPercent: percent(retryTokens, arms.ADAPTIVE.totalTokens),
    increaseRelativeToFirstAttemptsPercent: percent(retryTokens, firstAttemptTokens),
    initialPassed: adaptive.filter(trial => trial.execution.attempts[0].verdict === 'PASS').length,
    finalPassed: arms.ADAPTIVE.passed,
    mediumFirstAttempts: { cases: medium.length, passed: medium.filter(trial => trial.execution.attempts[0].verdict === 'PASS').length,
      firstAttemptTokens: mediumFirstTokens, matchedIndependentHighTokens: mediumMatchedHigh,
      firstAttemptSavingsPercentVersusHigh: saving(mediumMatchedHigh, mediumFirstTokens),
      meanCostBreakEvenSuccessProbabilityStrictlyGreaterThan: mediumFirstTokens / mediumMatchedHigh,
      actualAdaptiveTotalTokens: mediumFinal, actualRetryTokens: mediumFinal - mediumFirstTokens,
      actualSavingsPercentVersusMatchedHigh: saving(mediumMatchedHigh, mediumFinal),
      comparisonNote: 'Independent HIGH responses are a comparison, not the same random generation as adaptive retries.' },
    retryTrials,
  },
  audit: { checks: ['12 cases in each of 4 arms', 'all 49 actual model calls verified against raw JSONL',
    'nonnegative safe-integer usage', 'reasoning <= output and cached <= input',
    'known usage only in selected repetition', 'raw outputs and exact grading including all failures',
    'attempt sums equal execution usage and latency', 'no repeated response IDs', 'no tool calls', 'all actual retry costs retained'],
    traces },
  trials: trialDetails,
};
assert.equal(output.adaptiveRetries.firstAttemptTokens + output.adaptiveRetries.retryTokens, arms.ADAPTIVE.totalTokens);
const rendered = JSON.stringify(output, null, 2) + '\n';
const flags = process.argv.slice(2);
assert.ok(flags.every(flag => flag === '--check'), 'Only --check is supported');
if (flags.includes('--check')) assert.equal(await fs.readFile(resolve('results/research/effort-opportunity.json'), 'utf8'), rendered);
else {
  await fs.mkdir(resolve('results/research/'), { recursive: true });
  await fs.writeFile(resolve('results/research/effort-opportunity.json'), rendered, 'utf8');
}
console.log(JSON.stringify({ status: output.status, verifiedCalls: seenCalls.size,
  highTotal: arms.HIGH.totalTokens, highInputFractionPercent: arms.HIGH.fractionPercent.inputOfTotal,
  fixedInputZeroReasoningMaximumSavingsPercent: arms.HIGH.fixedInputZeroReasoningCeiling.maximumSavingsPercentUnderFixedInputAndOtherOutput,
  observedLowSavingsPercent: output.lowComparedWithHigh.totalSavingsPercent, paired,
  lowRetryBreakEven: breakEven.global.requiredPassProbabilityStrictlyGreaterThan,
  oracleEnvelope: { tokens: envelopeTotal, passed: output.oracleCandidateEnvelope.passed, savingsPercent: output.oracleCandidateEnvelope.savingsPercentVersusHigh },
  medium: output.adaptiveRetries.mediumFirstAttempts }, null, 2));
