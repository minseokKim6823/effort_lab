import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
// Frozen before model runs. Integer oracles never call a model.
let seed=20260923; const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n};
const cases=[];
function add(id,title,category,prompt,answer,effort){cases.push({id,title,category,prompt,expectedAnswer:String(answer),demoMinimum:effort})}
const suffix=' 답만 출력하고 설명이나 코드 블록은 쓰지 마세요.';
add('c01','제품 코드 변환','변환',"다음 문자열을 대문자로 변환하세요: 'invoice-az29-qx71-rev-b'. 문자열만 출력하세요.",'INVOICE-AZ29-QX71-REV-B','LOW');
const rows=Array.from({length:16},(_,i)=>[i%3===0?'cancelled':'paid',100+random(900),1+random(5)]);
add('c02','주문 조건 집계','계산',`SQL 집계 결과를 계산하세요. orders(status,price,quantity)의 행은 ${JSON.stringify(rows)} 입니다. SELECT SUM(price*quantity) FROM orders WHERE status='paid' AND quantity>=3; 정수만 출력하세요.`,rows.filter(r=>r[0]==='paid'&&r[2]>=3).reduce((s,r)=>s+r[1]*r[2],0),'MEDIUM');
const permutations=a=>a.length?a.flatMap((v,i)=>permutations(a.filter((_,j)=>j!==i)).map(t=>[v,...t])):[[]];
const p8=permutations([1,2,3,4,5,6,7,8]);const valid=p8.filter(p=>p.indexOf(1)<p.indexOf(4)&&p.indexOf(2)<p.indexOf(5)&&Math.abs(p.indexOf(3)-p.indexOf(6))!==1&&p[0]!==8);
add('c03','순열 제약의 경우의 수','조합 추론','제약 충족 문제: 1부터 8까지의 숫자를 각각 한 번 사용해 일렬로 나열합니다. 1은 4보다 앞, 2는 5보다 앞에 있어야 합니다. 3과 6은 서로 인접하면 안 되고 첫 숫자는 8일 수 없습니다. 조건을 모두 만족하는 순열의 경우의 수를 정수로 출력하세요.'+suffix,valid.length,'HIGH');
add('c04','필드 추출','변환','다음 JSON 배열에서 active가 true인 객체의 email만 원래 순서대로 추출하세요. 공백 없이 쉼표로 연결하고 따옴표는 쓰지 마세요. [{"email":"a@example.com","active":false},{"email":"b@example.com","active":true},{"email":"c@example.com","active":true},{"email":"d@example.com","active":false},{"email":"e@example.com","active":true}]','b@example.com,c@example.com,e@example.com','LOW');
let a=2,b=5;for(let i=2;i<=18;i++){[a,b]=[b,(3*b+2*a)%997]}
add('c05','모듈러 점화식','계산','재귀 수열 F(0)=2, F(1)=5, F(n)=(3*F(n-1)+2*F(n-2)) mod 997 입니다. F(18)을 계산하여 정수만 출력하세요.',b,'MEDIUM');
const items=Array.from({length:10},()=>[2+random(12),5+random(35)]),capacity=29;
let best=0;for(let mask=0;mask<1<<items.length;mask++){let w=0,v=0;items.forEach((x,i)=>{if(mask&(1<<i)){w+=x[0];v+=x[1]}});if(w<=capacity)best=Math.max(best,v)}
const dp=Array(capacity+1).fill(0);for(const[w,v]of items)for(let j=capacity;j>=w;j--)dp[j]=Math.max(dp[j],dp[j-w]+v);assert.equal(best,dp[capacity]);
add('c06','0/1 배낭 최적화','최적화',`0/1 배낭 최적화 문제: 각 물건은 최대 한 번만 선택할 수 있습니다. (무게,가치) 목록은 ${JSON.stringify(items)}이고 용량은 ${capacity}입니다. 총무게가 용량 이하인 선택의 최대 총가치를 정수만 출력하세요.`,best,'HIGH');
const nums=Array.from({length:15},()=>random(101)-50);
add('c07','음수 포함 정렬','변환',`정수를 오름차순 정렬하세요: ${nums.join(',')}. 중복도 유지하고 공백 없이 쉼표로 연결한 숫자만 출력하세요.`,[...nums].sort((a,b)=>a-b).join(','),'LOW');
const edges=[[0,1,7],[0,2,13],[0,3,20],[1,2,3],[1,4,12],[2,3,4],[2,4,5],[3,5,6],[4,5,2],[4,6,9],[5,6,3],[5,7,11],[6,7,2]];
const dist=Array(8).fill(Infinity);dist[0]=0;for(let i=0;i<8;i++)for(const[u,v,w]of edges)dist[v]=Math.min(dist[v],dist[u]+w);
add('c08','가중 그래프 경로','계산',`최단 경로 알고리즘 문제: 정점은 0부터 7, 방향 간선 (출발,도착,가중치)는 ${JSON.stringify(edges)} 입니다. 정점 0에서 7까지 최단 거리만 정수로 출력하세요.`,dist[7],'MEDIUM');
const constraints=[[0,3],[1,3],[1,4],[2,4],[3,5],[4,5],[2,6]];
const orders=permutations([0,1,2,3,4,5,6]).filter(p=>constraints.every(([x,y])=>p.indexOf(x)<p.indexOf(y))).length;
const counts=Array(128).fill(0);counts[0]=1;for(let mask=0;mask<128;mask++)for(let n=0;n<7;n++)if(!(mask&(1<<n))&&constraints.filter(e=>e[1]===n).every(e=>mask&(1<<e[0])))counts[mask|(1<<n)]+=counts[mask];assert.equal(orders,counts[127]);
add('c09','선행 작업 일정 수','조합 추론',`제약 충족 문제: 작업 0부터 6까지를 각각 한 번, 한 번에 하나씩 수행합니다. 선행 관계 (먼저,나중)는 ${JSON.stringify(constraints)} 입니다. 모든 선행 관계를 만족하는 전체 실행 순서의 경우의 수를 정수로 출력하세요.`,orders,'HIGH');
add('c10','기호 정규화','변환',"문자열 'ALPHA__Beta---2026..Gamma'에서 영문은 소문자로 변환하고, 연속된 영숫자 아닌 문자들을 각각 하이픈 하나로 바꾸세요. 결과만 출력하세요.",'alpha-beta-2026-gamma','LOW');
const prices=[127,349,218,503,76,415,289,642];const total=prices.reduce((s,p,i)=>s+Math.floor(p*(i%2===0?85:90)/100),0);
add('c11','반올림 없는 할인 집계','계산',`조건별 계산: 가격 목록은 ${prices.join(',')} 입니다. 1부터 센 홀수 위치의 상품은 15% 할인, 짝수 위치는 10% 할인합니다. 상품별 할인 후 가격에서 소수점 이하는 버린 뒤 합산합니다. 최종 합계만 정수로 출력하세요.`,total,'MEDIUM');
const costs=Array.from({length:5},()=>Array.from({length:5},()=>5+random(30)));const assignment=permutations([0,1,2,3,4]).map(p=>p.reduce((s,col,row)=>s+costs[row][col],0));const optimum=Math.min(...assignment);
add('c12','작업 배정 최적화','최적화',`최적화 문제: 직원 5명에게 작업 5개를 하나씩 배정합니다. 직원과 작업은 각각 정확히 한 번 사용합니다. 비용 행렬은 행이 직원, 열이 작업 순서로 ${JSON.stringify(costs)} 입니다. 가능한 배정 중 최소 총비용만 정수로 출력하세요.`,optimum,'HIGH');
assert.equal(cases.length,12);
const output=JSON.stringify(cases,null,2)+'\n';
const target='backend/src/main/resources/challenge-cases.json';
if(process.argv.includes('--check'))assert.equal(await fs.readFile(target,'utf8'),output);else await fs.writeFile(target,output);
console.log('Frozen challenge dataset: 12 cases; independent knapsack/topological oracles agree.');
