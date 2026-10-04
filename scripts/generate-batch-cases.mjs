import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Freeze instances before evaluation. These integer oracles never call a model.
const seeds = [20260927, 20260928], cases = [];
const permutations = a => a.length ? a.flatMap((v, i) => permutations(a.filter((_, j) => j !== i)).map(tail => [v, ...tail])) : [[]];
const p8 = permutations([1, 2, 3, 4, 5, 6, 7, 8]);
const p7 = permutations([0, 1, 2, 3, 4, 5, 6]);
const p5 = permutations([0, 1, 2, 3, 4]);

for (const [instance, initialSeed] of seeds.entries()) {
  let state = initialSeed;
  const random = upper => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % upper; };
  const shuffle = values => {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = random(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const add = (family, title, category, prompt, answer, effort) => cases.push({
    id: 'b' + String(instance * 12 + family).padStart(2, '0'),
    title: title + ' · ' + (instance + 1), category, prompt,
    expectedAnswer: String(answer), demoMinimum: effort,
  });

  const product = 'shipment-' + (1000 + random(9000)).toString(36) + '-' + (10000 + random(90000)).toString(36) + '-rev-' + (instance ? 'f' : 'd');
  add(1, '제품 코드 변환', '변환', "다음 문자열을 대문자로 변환하세요: '" + product + "'. 문자열만 출력하세요.", product.toUpperCase(), 'LOW');

  const rows = Array.from({ length: 16 }, (_, i) => [(i + instance) % 4 === 0 ? 'cancelled' : 'paid', 150 + random(950), 1 + random(6)]);
  const minQuantity = 3 + instance;
  const orderTotal = rows.filter(r => r[0] === 'paid' && r[2] >= minQuantity).reduce((sum, r) => sum + r[1] * r[2], 0);
  add(2, '주문 조건 집계', '계산', 'SQL 집계 결과를 계산하세요. orders(status,price,quantity)의 행은 ' + JSON.stringify(rows) + " 입니다. SELECT SUM(price*quantity) FROM orders WHERE status='paid' AND quantity>=" + minQuantity + '; 정수만 출력하세요.', orderTotal, 'MEDIUM');

  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
  const [before1, after1, before2, after2, separate1, separate2] = digits;
  const forbiddenFirst = digits[instance ? 4 : 0];
  const validPermutations = p8.filter(order =>
    order.indexOf(before1) < order.indexOf(after1) && order.indexOf(before2) < order.indexOf(after2)
    && Math.abs(order.indexOf(separate1) - order.indexOf(separate2)) !== 1 && order[0] !== forbiddenFirst).length;
  add(3, '순열 제약의 경우의 수', '조합 추론', '제약 충족 문제: 1부터 8까지의 숫자를 각각 한 번 사용해 일렬로 나열합니다. ' + before1 + '은 ' + after1 + '보다 앞, ' + before2 + '는 ' + after2 + '보다 앞에 있어야 합니다. ' + separate1 + '과 ' + separate2 + '는 서로 인접하면 안 되고 첫 숫자는 ' + forbiddenFirst + '일 수 없습니다. 조건을 모두 만족하는 순열의 경우의 수를 정수로 출력하세요. 답만 출력하고 설명이나 코드 블록은 쓰지 마세요.', validPermutations, 'HIGH');

  const contacts = [true, false, true, true, false, instance === 1].map((active, i) => ({
    email: 'team' + (initialSeed % 100) + '-' + (i + 2) + '@example.org', active,
  }));
  add(4, '필드 추출', '변환', '다음 JSON 배열에서 active가 true인 객체의 email만 원래 순서대로 추출하세요. 공백 없이 쉼표로 연결하고 따옴표는 쓰지 마세요. ' + JSON.stringify(contacts), contacts.filter(c => c.active).map(c => c.email).join(','), 'LOW');

  const f0 = 3 + random(8), f1 = 7 + random(10), c1 = 3 + instance, c2 = 3 - instance;
  const modulus = instance ? 1013 : 1009, index = 17 + random(4);
  let previous = f0, current = f1;
  for (let n = 2; n <= index; n++) [previous, current] = [current, (c1 * current + c2 * previous) % modulus];
  const recurrenceMemo = [f0, f1];
  const recurrence = n => recurrenceMemo[n] ??= (c1 * recurrence(n - 1) + c2 * recurrence(n - 2)) % modulus;
  assert.equal(current, recurrence(index));
  add(5, '모듈러 점화식', '계산', '재귀 수열 F(0)=' + f0 + ', F(1)=' + f1 + ', F(n)=(' + c1 + '*F(n-1)+' + c2 + '*F(n-2)) mod ' + modulus + ' 입니다. F(' + index + ')을 계산하여 정수만 출력하세요.', current, 'MEDIUM');

  const items = Array.from({ length: 10 }, () => [3 + random(12), 8 + random(39)]), capacity = 31 + instance * 3;
  let knapsackBest = 0;
  for (let mask = 0; mask < 1 << items.length; mask++) {
    let weight = 0, value = 0;
    items.forEach((item, i) => { if (mask & (1 << i)) { weight += item[0]; value += item[1]; } });
    if (weight <= capacity) knapsackBest = Math.max(knapsackBest, value);
  }
  const knapsackDp = Array(capacity + 1).fill(0);
  for (const [weight, value] of items) for (let remaining = capacity; remaining >= weight; remaining--)
    knapsackDp[remaining] = Math.max(knapsackDp[remaining], knapsackDp[remaining - weight] + value);
  assert.equal(knapsackBest, knapsackDp[capacity], 'Independent knapsack oracles disagree');
  add(6, '0/1 배낭 최적화', '최적화', '0/1 배낭 최적화 문제: 각 물건은 최대 한 번만 선택할 수 있습니다. (무게,가치) 목록은 ' + JSON.stringify(items) + '이고 용량은 ' + capacity + '입니다. 총무게가 용량 이하인 선택의 최대 총가치를 정수만 출력하세요.', knapsackBest, 'HIGH');

  const numbers = Array.from({ length: 15 }, () => random(141) - 70);
  numbers[14] = numbers[2];
  add(7, '음수 포함 정렬', '변환', '정수를 오름차순 정렬하세요: ' + numbers.join(',') + '. 중복도 유지하고 공백 없이 쉼표로 연결한 숫자만 출력하세요.', [...numbers].sort((a, b) => a - b).join(','), 'LOW');

  const edgePairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 4], [2, 3], [2, 4], [3, 5], [4, 5], [4, 6], [5, 6], [5, 7], [6, 7]];
  const edges = edgePairs.map(([from, to]) => [from, to, 2 + random(19)]);
  const distance = Array(8).fill(Infinity); distance[0] = 0;
  for (let iteration = 0; iteration < 7; iteration++) for (const [from, to, weight] of edges)
    distance[to] = Math.min(distance[to], distance[from] + weight);
  const matrix = Array.from({ length: 8 }, (_, from) => Array.from({ length: 8 }, (_, to) => from === to ? 0 : Infinity));
  for (const [from, to, weight] of edges) matrix[from][to] = weight;
  for (let via = 0; via < 8; via++) for (let from = 0; from < 8; from++) for (let to = 0; to < 8; to++)
    matrix[from][to] = Math.min(matrix[from][to], matrix[from][via] + matrix[via][to]);
  assert.equal(distance[7], matrix[0][7]);
  add(8, '가중 그래프 경로', '계산', '최단 경로 알고리즘 문제: 정점은 0부터 7, 방향 간선 (출발,도착,가중치)는 ' + JSON.stringify(edges) + ' 입니다. 정점 0에서 7까지 최단 거리만 정수로 출력하세요.', distance[7], 'MEDIUM');

  const labels = shuffle([0, 1, 2, 3, 4, 5, 6]);
  const baseConstraints = instance
    ? [[0, 2], [1, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 6]]
    : [[0, 2], [0, 3], [1, 3], [1, 4], [2, 5], [3, 5], [4, 6], [5, 6]];
  const constraints = baseConstraints.map(([from, to]) => [labels[from], labels[to]]);
  const topologicalOrders = p7.filter(order => constraints.every(([from, to]) => order.indexOf(from) < order.indexOf(to))).length;
  const counts = Array(128).fill(0); counts[0] = 1;
  for (let mask = 0; mask < 128; mask++) for (let next = 0; next < 7; next++)
    if (!(mask & (1 << next)) && constraints.filter(edge => edge[1] === next).every(edge => mask & (1 << edge[0])))
      counts[mask | (1 << next)] += counts[mask];
  assert.equal(topologicalOrders, counts[127], 'Independent topological-order oracles disagree');
  add(9, '선행 작업 일정 수', '조합 추론', '제약 충족 문제: 작업 0부터 6까지를 각각 한 번, 한 번에 하나씩 수행합니다. 선행 관계 (먼저,나중)는 ' + JSON.stringify(constraints) + ' 입니다. 모든 선행 관계를 만족하는 전체 실행 순서의 경우의 수를 정수로 출력하세요.', topologicalOrders, 'HIGH');

  const source = (instance ? 'DELTA' : 'OMEGA') + '__Shipment---' + (2000 + random(8000)) + '..' + (instance ? 'Node' : 'Package');
  add(10, '기호 정규화', '변환', "문자열 '" + source + "'에서 영문은 소문자로 변환하고, 연속된 영숫자 아닌 문자들을 각각 하이픈 하나로 바꾸세요. 결과만 출력하세요.", source.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'LOW');

  const prices = Array.from({ length: 8 }, () => 120 + random(640));
  const oddDiscount = instance ? 18 : 20, evenDiscount = instance ? 7 : 12;
  const discountedTotal = prices.reduce((sum, price, position) => sum + Math.floor(price * (100 - (position % 2 === 0 ? oddDiscount : evenDiscount)) / 100), 0);
  add(11, '반올림 없는 할인 집계', '계산', '조건별 계산: 가격 목록은 ' + prices.join(',') + ' 입니다. 1부터 센 홀수 위치의 상품은 ' + oddDiscount + '% 할인, 짝수 위치는 ' + evenDiscount + '% 할인합니다. 상품별 할인 후 가격에서 소수점 이하는 버린 뒤 합산합니다. 최종 합계만 정수로 출력하세요.', discountedTotal, 'MEDIUM');

  const costs = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 8 + random(37)));
  const minimumAssignment = Math.min(...p5.map(order => order.reduce((sum, column, row) => sum + costs[row][column], 0)));
  add(12, '작업 배정 최적화', '최적화', '최적화 문제: 직원 5명에게 작업 5개를 하나씩 배정합니다. 직원과 작업은 각각 정확히 한 번 사용합니다. 비용 행렬은 행이 직원, 열이 작업 순서로 ' + JSON.stringify(costs) + ' 입니다. 가능한 배정 중 최소 총비용만 정수로 출력하세요.', minimumAssignment, 'HIGH');
}

assert.equal(cases.length, 24);
assert.equal(new Set(cases.map(c => c.prompt)).size, 24);
assert.equal(new Set(cases.map(c => c.id)).size, 24);
const root = new URL('../', import.meta.url);
const previousCases = JSON.parse(await fs.readFile(new URL('backend/src/main/resources/challenge-cases.json', root), 'utf8'));
assert.ok(cases.every(c => !previousCases.some(previous => previous.prompt === c.prompt)), 'Existing v2 prompt reused');
const output = JSON.stringify(cases, null, 2) + '\n';
const target = new URL('results/v3/cases.json', root);
const flags = process.argv.slice(2);
assert.ok(flags.every(flag => ['--check', '--write'].includes(flag)), 'Only --check or --write is supported');
assert.ok(!(flags.includes('--check') && flags.includes('--write')), '--check and --write are mutually exclusive');
let existing;
try { existing = await fs.readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (flags.includes('--check')) assert.equal(existing, output, 'Frozen dataset differs from generator output');
else if (existing !== undefined && existing !== output && !flags.includes('--write'))
  throw new Error('Refusing to overwrite a different frozen dataset. Review the change and explicitly pass --write.');
else if (existing !== output) {
  await fs.mkdir(new URL('results/v3/', root), { recursive: true });
  await fs.writeFile(target, output, 'utf8');
}
console.log(JSON.stringify({ status: 'PASS', cases: cases.length, seeds, sha256: createHash('sha256').update(output).digest('hex'), independentOracles: ['knapsack', 'topological orders', 'recurrence', 'shortest path'] }));
