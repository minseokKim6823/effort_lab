import {useEffect,useState} from 'react';
import {Beaker,Download,Layers,LoaderCircle,Play} from 'lucide-react';
import {api,downloadJson} from './api';
import type {BatchItemInput,BatchReport,Mode,TaskCase} from './types';
import './batch.css';

const count=(n:number)=>new Intl.NumberFormat('ko-KR').format(n);
const states={COMPLETED:'완료',ERROR:'오류',BUDGET_EXCEEDED:'토큰 기준 도달'};
function readItems(source:string):BatchItemInput[]{
 let value:unknown;
 try{value=JSON.parse(source);}catch{throw new Error('작업 목록을 올바른 JSON 배열로 입력해주세요.');}
 if(!Array.isArray(value)||value.length<1||value.length>24)throw new Error('한 번에 1~24개의 작업을 입력해주세요.');
 const ids=new Set<string>();
 for(const item of value){
  if(!item||typeof item!=='object'||typeof item.id!=='string'||!item.id.trim()||ids.has(item.id))throw new Error('각 작업에는 중복되지 않는 id가 필요합니다.');
  ids.add(item.id);
  if(typeof item.task!=='string'||!item.task.trim()||item.task.length>8000)throw new Error(item.id+': 작업은 1~8,000자로 입력해주세요.');
  if(!['NONE','EXACT','CONTAINS','JSON'].includes(item.check))throw new Error(item.id+': check는 NONE, EXACT, CONTAINS, JSON 중 하나여야 합니다.');
  if((item.check==='EXACT'||item.check==='CONTAINS')&&(typeof item.expectedAnswer!=='string'||!item.expectedAnswer.trim()))throw new Error(item.id+': 선택한 검증 방식에는 expectedAnswer가 필요합니다.');
  if(item.expectedAnswer!==undefined&&(typeof item.expectedAnswer!=='string'||item.expectedAnswer.length>4000))throw new Error(item.id+': expectedAnswer는 최대 4,000자 문자열이어야 합니다.');
 }
 return value;
}
export default function BatchPanel({mode,disabled,onBusyChange}:{mode:Mode;disabled:boolean;onBusyChange:(busy:boolean)=>void}){
 const [source,setSource]=useState('[]'),[examples,setExamples]=useState<BatchItemInput[]>([]);
 const [batchSize,setBatchSize]=useState(4),[budget,setBudget]=useState(100000);
 const [report,setReport]=useState<BatchReport|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
 useEffect(()=>{let cancelled=false;api<TaskCase[]>('/cases').then(c=>{
  if(cancelled)return;
  const items=c.slice(0,4).map(v=>({id:v.id,task:v.prompt,check:'EXACT' as const,expectedAnswer:v.expectedAnswer}));
  setExamples(items);setSource(JSON.stringify(items,null,2));
 }).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true};},[]);
 async function run(){
  setError('');
  let items:BatchItemInput[];
  try{items=readItems(source);}catch(e){setError((e as Error).message);return;}
  setPending(true);onBusyChange(true);setReport(null);
  try{setReport(await api<BatchReport>('/batch',{mode,batchSize,tokenBudget:budget,items}));}
  catch(e){setError(e instanceof Error?e.message:'묶음 실행에 실패했습니다.');}
  finally{setPending(false);onBusyChange(false);}
 }
 const locked=disabled||pending;
 const validBudget=Number.isInteger(budget)&&budget>=1000&&budget<=2000000;
 return <div className="batch-panel">
  <section className="panel">
   <div className="panel-heading"><div><Layers size={19}/><h2>독립 작업 묶음 실행</h2></div><span className="badge high">high 고정</span></div>
   <p className="batch-intro">서로 독립적인 짧은 작업을 한 호출에 모아 반복되는 입력 문맥을 줄입니다. 1개씩 실행과 묶음 실행 모두 같은 high effort를 사용합니다.</p>
   <div className="sample-list"><button disabled={locked||!examples.length} onClick={()=>{setSource(JSON.stringify(examples,null,2));setReport(null);setError('')}}><Beaker size={13}/>기초 예제 4개 불러오기</button></div>
   <label className="batch-label" htmlFor="batch-items">작업 목록 · JSON 배열</label>
   <textarea id="batch-items" className="batch-source" spellCheck={false} value={source} disabled={locked} onChange={e=>setSource(e.target.value)} aria-describedby="batch-input-help"/>
   <p id="batch-input-help" className="helper">최대 24개. 각 작업에 id, task, check를 입력하세요. EXACT·CONTAINS의 expectedAnswer는 검증에만 사용합니다. 이전 답변이나 외부 파일에 의존하는 작업은 분리해주세요.</p>
   <div className="batch-controls">
    <label>호출당 최대 작업 수<select value={batchSize} onChange={e=>setBatchSize(+e.target.value)} disabled={locked}><option value={1}>1개 · 개별 실행 기준</option><option value={2}>2개씩 묶음</option><option value={3}>3개씩 묶음</option><option value={4}>4개씩 묶음</option></select></label>
    <label>총토큰 중단 기준<input type="number" value={budget} min={1000} max={2000000} step={1000} disabled={locked} onChange={e=>setBudget(+e.target.value)}/></label>
    <button className="primary" disabled={locked||!validBudget} onClick={run}>{pending?<LoaderCircle size={16} className="spin"/>:<Play size={16}/>}묶음 실행 시작</button>
   </div>
   <p className="helper">묶음당 입력 작업은 합계 8,000자 이내로 나뉩니다. effort 선택용 AI 호출과 자동 재시도는 없습니다. 중단 기준은 호출 사이에 확인하므로 마지막 호출만큼 초과할 수 있습니다.</p>
   {mode==='DEMO'&&<div className="notice demo-notice batch-notice">데모는 화면과 검증 흐름을 확인하는 시뮬레이션입니다. 실제 모델의 성능이나 절감률을 나타내지 않습니다.</div>}
  </section>
  {error&&<div className="error-banner" role="alert">{error}</div>}
  {report&&<section className="panel batch-results">
   <div className="panel-heading"><div><h2>묶음 실행 결과</h2><span className={'badge '+report.status.toLowerCase()}>{states[report.status]}</span><span className={'badge '+report.mode.toLowerCase()}>{report.mode}</span></div><button className="secondary compact" onClick={()=>downloadJson(report,'effort-lab-batch-'+report.id+'.json')}><Download size={14}/>JSON 내보내기</button></div>
   <div className="result-strip"><strong>{report.unknownUsage?'확인된 ':'총 '}{count(report.totalTokens)} 토큰</strong><span>사용량 확인된 호출 {report.calls.length}회</span><span>정답 {report.items.filter(i=>i.verdict==='PASS').length} / {report.items.length}개</span><span>{(report.latencyMs/1000).toFixed(2)}초</span></div>
   <p className="helper">{report.model} · {report.policyVersion} · 토큰은 호출 단위로 측정합니다. 작업별 비용을 임의로 나누지 않습니다.</p>
   {report.unknownUsage&&<p className="notice demo-notice batch-notice">일부 호출의 사용량을 확인하지 못했습니다. 표시된 합계를 전체 비용이나 절감률로 해석할 수 없습니다.</p>}
   {report.error&&<p className="error-text" role="alert">{report.error}</p>}
   <div className="batch-outputs">{report.items.map(item=><article className="batch-output" key={item.id}><div><strong>{item.id}</strong><span className={'badge '+item.verdict.toLowerCase()}>{item.verdict}</span></div><pre>{item.output||'응답 없음'}</pre></article>)}</div>
   <h3 className="batch-subheading">호출별 실제 사용량</h3>
   {report.calls.map((call,index)=><details key={index}><summary>{index+1}차 호출 · {call.taskIds.join(', ')} · {count(call.generation.usage.inputTokens+call.generation.usage.outputTokens)} 토큰</summary><p className="helper">입력 {count(call.generation.usage.inputTokens)} · 출력 {count(call.generation.usage.outputTokens)} · 추론 {count(call.generation.usage.reasoningTokens)} · 캐시 입력 {count(call.generation.usage.cachedInputTokens)}</p>{call.parseError&&<p className="error-text">{call.parseError}</p>}<pre>{call.generation.output}</pre></details>)}
  </section>}
 </div>
}
