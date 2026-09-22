import {useEffect,useState} from 'react';
import {Activity,ArrowDownRight,ArrowRight,Beaker,BookOpen,Check,ChevronRight,Command,Download,FlaskConical,Layers,LoaderCircle,Play,RotateCcw,ShieldCheck,Square,Workflow,Zap} from 'lucide-react';
import {api,downloadJson} from './api';
import type {Decision,Execution,Mode,Report,Status,Strategy,TaskCase} from './types';
const nf=new Intl.NumberFormat('ko-KR');
const num=(n:number|undefined)=>n===undefined?'—':nf.format(Math.round(n));
const strategies:Strategy[]=['DEFAULT_HIGH','HIGH','LOW','ADAPTIVE'];
const armNames:Record<Strategy,string>={DEFAULT_HIGH:'기존 문맥 · high',HIGH:'짧은 문맥 · high',LOW:'짧은 문맥 · low',ADAPTIVE:'짧은 문맥 · 자동'};
const stateNames:Record<string,string>={RUNNING:'실행 중',COMPLETED:'완료',CANCELLED:'중단됨',BUDGET_EXCEEDED:'토큰 기준 도달',ERROR:'오류',INTERRUPTED:'서버 중단'};
function Badge({value}:{value:string}){return <span className={'badge '+value.toLowerCase()}>{value.toLowerCase()}</span>}
export default function App(){
 const [tab,setTab]=useState('workspace'),[status,setStatus]=useState<Status|null>(null),[cases,setCases]=useState<TaskCase[]>([]),[history,setHistory]=useState<Report[]>([]);
 const [task,setTask]=useState(''),[risk,setRisk]=useState(false),[mode,setMode]=useState<Mode>('CODEX'),[check,setCheck]=useState('NONE'),[expected,setExpected]=useState('');
 const [decision,setDecision]=useState<Decision|null>(null),[execution,setExecution]=useState<Execution|null>(null),[report,setReport]=useState<Report|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[caseCount,setCaseCount]=useState(12),[repeats,setRepeats]=useState(1),[budget,setBudget]=useState(350000);
 const [suite,setSuite]=useState('challenge');
 const [reportCases,setReportCases]=useState<TaskCase[]>([]);
 const [selected,setSelected]=useState<string|null>(null);
 const running=report?.status==='RUNNING';
 const arms=strategies.filter(s=>report?.arms[s]);
 useEffect(()=>{Promise.all([api<Status>('/status'),api<TaskCase[]>('/cases'),api<Report[]>('/benchmarks')]).then(([s,c,h])=>{
   setStatus(s);setCases(c);setHistory(h);setTask(c[0]?.prompt||'');setExpected(c[0]?.expectedAnswer||'');setCheck('EXACT');
   if(!s.codexAvailable)setMode('DEMO');if(h.length)setReport(h[0]);
 }).catch(e=>setError(e.message));},[]);
 useEffect(()=>{if(!running||!report)return;let cancelled=false;
 const timer=setInterval(()=>{api<Report>('/benchmarks/'+report.id).then(r=>{if(cancelled)return;setReport(r);if(r.status!=='RUNNING')api<Report[]>('/benchmarks').then(setHistory).catch(()=>{});}).catch(e=>{if(!cancelled)setError(e.message);});},1200);
 return()=>{cancelled=true;clearInterval(timer);};},[running,report?.id]);
 useEffect(()=>{if(!report)return;let cancelled=false;api<TaskCase[]>('/cases?suite='+(report.request.suite||'starter')).then(c=>{if(!cancelled)setReportCases(c)}).catch(()=>{});return()=>{cancelled=true};},[report?.id]);
 async function act(work:()=>Promise<void>){setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'요청에 실패했습니다.');}finally{setBusy(false);}}
 function selectCase(c:TaskCase){setTask(c.prompt);setExpected(c.expectedAnswer);setCheck('EXACT');setDecision(null);setExecution(null);}
 function modeControl(){return <label className="mode-select"><span className={'status-dot '+(mode==='CODEX'?'live':'')}/><select aria-label="실행 모드" value={mode} onChange={e=>setMode(e.target.value as Mode)} disabled={busy||running}>
   <option value="CODEX" disabled={!status?.codexAvailable}>Codex 구독 · 실제 측정</option><option value="DEMO">데모 · 시뮬레이션</option></select></label>}
 const latest=report?.comparable?report:null;
 const selectedTrials=report?.trials.filter(t=>t.caseId===selected)||[];
 return <div className="app">
  <aside className="sidebar">
   <a className="brand" href="#" onClick={e=>{e.preventDefault();setTab('workspace')}}><span className="brand-mark"><Workflow size={24}/></span>effort<span>lab</span></a>
   <div className="workspace-label">PERSONAL WORKSPACE <span>01</span></div>
   <nav>{[{id:'workspace',label:'작업 스튜디오',icon:Command},{id:'benchmark',label:'비교 실험',icon:FlaskConical},{id:'method',label:'설계와 측정 기준',icon:BookOpen}].map(n=><button key={n.id} className={tab===n.id?'nav-item active':'nav-item'} onClick={()=>setTab(n.id)}><n.icon size={18}/>{n.label}{tab===n.id&&<ChevronRight size={15}/>}</button>)}</nav>
   <div className="sidebar-note"><span className="eyebrow">THE PRINCIPLE</span><p>더 적게 쓰고,<br/>충분히 잘 해결하기.</p><div className="mini-flow"><i/><span/><i/><span/><i/></div><small>선택 → 검증 → 필요할 때 재시도</small></div>
   <div className="connection"><span className={'status-dot '+(status?'live':'')}/><div>{status?'로컬 서버 연결됨':'서버 연결 확인 중'}<small>{status?.model||'Spring Boot · React'}</small></div></div>
  </aside>
  <main>
   <header className="topbar"><div>Workspace <ChevronRight size={13}/> <strong>{tab==='workspace'?'작업 스튜디오':tab==='benchmark'?'비교 실험':'설계와 측정 기준'}</strong></div><span className="version">MVP / v0.1</span></header>
   {error&&<div className="error-banner" role="alert">{error}<button aria-label="오류 닫기" onClick={()=>setError('')}>×</button></div>}
   <div className="content">
    <section className="page-heading"><div><span className="eyebrow">{tab==='workspace'?'THINK JUST ENOUGH':tab==='benchmark'?'MEASURE, THEN OPTIMIZE':'BUILT ON EVIDENCE'}</span><h1>{tab==='workspace'?'필요한 만큼만 생각하도록.':tab==='benchmark'?'절약은 숫자로 확인하세요.':'무엇을 줄이고, 무엇을 지킬까.'}</h1><p>{tab==='workspace'?'작업에 맞는 effort를 고르고, 답의 품질과 실제 사용량을 확인하세요.':tab==='benchmark'?'같은 모델, 같은 문제. 네 가지 실행 전략을 공정하게 비교합니다.':'목표는 적은 토큰 자체가 아니라, 같은 품질을 더 적은 총토큰으로 얻는 것입니다.'}</p></div>{modeControl()}</section>
    {tab==='workspace'&&<>
     <section className="stats-grid">
      <Metric icon={<ArrowDownRight size={20}/>} label="문맥 + effort 총토큰 변화" value={(latest?.overallSavingsPercent??latest?.savingsPercent)!=null?(latest!.overallSavingsPercent??latest!.savingsPercent)!.toFixed(2)+'%':'—'} note={latest?(latest.mode==='CODEX'?'Codex 실측 · 기존 문맥 high 대비':'데모 수치 · 실제 절감률 아님'):'비교 실험 후 표시됩니다'}/>
      <Metric icon={<ShieldCheck size={20}/>} label="자동 선택 정답률" value={latest?latest.arms.ADAPTIVE.passRate.toFixed(0)+'%':'—'} note={latest?num(latest.arms.ADAPTIVE.passed)+' / '+num(latest.arms.ADAPTIVE.trials)+'건 · 정답 일치 기준':'정답이 있는 작업만 채점'}/>
      <Metric icon={<Zap size={20}/>} label="effort 선택에 쓴 AI 토큰" value="0" note="로컬 규칙으로 선택 · 모델 호출 없음"/>
     </section>
     <div className="studio-grid"><section className="panel task-panel">
      <div className="panel-heading"><div><span className="step">01</span><h2>작업 입력</h2></div><span className="muted">최대 20,000자</span></div>
      <div className="sample-list">{cases.slice(0,3).map(c=><button key={c.id} onClick={()=>selectCase(c)} disabled={busy||running}><Beaker size={13}/>{c.title}</button>)}</div>
      <label className="sr-only" htmlFor="task">분석할 작업</label><textarea id="task" value={task} maxLength={20000} onChange={e=>{setTask(e.target.value);setDecision(null);setExecution(null);setCheck('NONE');setExpected('')}} placeholder="해결할 작업과 원하는 결과를 구체적으로 적어주세요."/>
      <div className="input-footer"><label className="toggle"><input type="checkbox" checked={risk} onChange={e=>{setRisk(e.target.checked);setDecision(null)}}/>정확도 우선 <ShieldCheck size={14}/></label><span>{num(task.length)}자</span></div>
      <button className="primary full" disabled={!task.trim()||busy} onClick={()=>act(async()=>{setDecision(await api<Decision>('/route',{task,risk:risk?'HIGH':'NORMAL'}));setExecution(null)})}>{busy?<LoaderCircle className="spin" size={17}/>:<Workflow size={17}/>}effort 분석하기<ArrowRight size={16}/></button>
      <p className="helper">분석 버튼은 모델을 호출하지 않습니다.</p>
     </section>
     <section className="panel decision-panel"><div className="panel-heading"><div><span className="step">02</span><h2>실행 전략</h2></div><Layers size={18}/></div>
      {decision?<><div className="effort-result"><span>추천 시작 effort</span><h3>{decision.effort.toLowerCase()}<span>effort</span></h3><p>{decision.effort==='LOW'?'명확한 작업은 가볍게 시작합니다.':decision.effort==='MEDIUM'?'근거가 부족하거나 여러 조건이 있어 충분히 검토합니다.':'복잡한 추론 신호 또는 정확도 우선 조건을 반영했습니다.'}</p></div>
      <div className="effort-scale">{['LOW','MEDIUM','HIGH'].map(e=><div className={e===decision.effort?'selected':''} key={e}><span/>{e.toLowerCase()}</div>)}</div>
      <ul className="reason-list">{decision.reasons.map(r=><li key={r}><Check size={15}/>{r}</li>)}</ul>
      <div className="decision-meta"><span>선택 시간 <strong>{decision.routingMicros} μs</strong></span><span>추가 AI 토큰 <strong>0</strong></span></div>
      </>:<div className="empty-decision"><div className="orbit"><Workflow size={34}/></div><h3>먼저 작업을 분석해 보세요</h3><p>선택한 effort와 판단 근거를<br/>여기에서 확인할 수 있습니다.</p></div>}
     </section></div>
     <section className="panel execute-panel"><div className="panel-heading"><div><span className="step">03</span><h2>실행과 검증</h2></div><span className="muted">{mode==='CODEX'?'실행 시 구독 사용량을 소비합니다':'예제만 실행되는 시뮬레이션'}</span></div>
      <div className="execute-controls"><label>검증 방식<select value={check} onChange={e=>setCheck(e.target.value)}><option value="NONE">검증 없음 · 품질 미확인</option><option value="EXACT">정답과 정확히 일치</option><option value="CONTAINS">필수 문자열 포함</option><option value="JSON">JSON 객체·배열 형식</option></select></label>
      {(check==='EXACT'||check==='CONTAINS')&&<label className="grow">정답 / 필수 문자열<input value={expected} maxLength={4000} onChange={e=>setExpected(e.target.value)} placeholder="모델에 보내지 않고 검증에만 사용합니다"/></label>}
      <button className="primary" disabled={!task.trim()||busy||running||((check==='EXACT'||check==='CONTAINS')&&!expected.trim())} onClick={()=>act(async()=>{const x=await api<Execution>('/execute',{task,risk:risk?'HIGH':'NORMAL',mode,check,expectedAnswer:expected});setExecution(x);setDecision(x.decision)})}>{busy?<LoaderCircle className="spin" size={16}/>:<Play size={16}/>}선택한 방식으로 실행</button></div>
      <p className="helper">{check==='NONE'?'검증 기준이 없으면 정답 여부를 단정하거나 자동 재시도하지 않습니다.':check==='JSON'?'JSON 형식만 검사합니다. 내용의 정확성을 보장하지 않습니다.':'검증에 실패하면 다음 effort로 높입니다. high까지 최대 3회 실행합니다.'}</p>
      {execution&&<div className="execution-result"><div className="result-strip"><Badge value={execution.verdict}/><strong>총 {num(execution.totalTokens)} 토큰</strong><span>{(execution.latencyMs/1000).toFixed(2)}초</span><span>{execution.attempts.length}회 호출</span>{execution.unknownUsage&&<span>일부 사용량 미확인</span>}</div>{execution.error&&<p className="error-text">{execution.error}</p>}{execution.attempts.map((a,i)=><details key={a.responseId} open={i===execution.attempts.length-1}><summary><Badge value={a.effort}/>{i+1}차 시도 · {a.verdict} · {num(a.usage.inputTokens+a.usage.outputTokens)} 토큰</summary><pre>{a.output}</pre></details>)}</div>}
     </section>
    </>}
    {tab==='benchmark'&&<>
     <section className="panel experiment-setup"><div className="panel-heading"><div><span className="step">01</span><h2>비교 실험 설정</h2></div><span className="muted">같은 문제 · 같은 모델 · 새로운 세션</span></div>
      <div className="experiment-fields"><label>문제 세트<select aria-label="문제 세트" value={suite} onChange={e=>setSuite(e.target.value)} disabled={!!running}><option value="challenge">확장 12문제 · 계산·제약·최적화</option><option value="starter">기초 12문제 · 기능 확인</option></select></label><label>예제 작업 수<select value={caseCount} onChange={e=>setCaseCount(+e.target.value)} disabled={!!running}><option value={3}>3개 · 빠른 확인</option><option value={6}>6개 · 소규모 비교</option><option value={12}>12개 · 전체 예제</option></select></label><label>문제별 반복<select value={repeats} onChange={e=>setRepeats(+e.target.value)} disabled={!!running}>{[1,2,3].map(n=><option key={n} value={n}>{n}회</option>)}</select></label><label>총토큰 중단 기준<input type="number" min={1000} max={2000000} step={1000} value={budget} onChange={e=>setBudget(+e.target.value)} disabled={!!running}/></label>
      <button className="primary" disabled={busy||running||!status||budget<1000||budget>2000000} onClick={()=>act(async()=>{setSelected(null);setReport(await api<Report>('/benchmarks',{mode,repeats,caseCount,tokenBudget:budget,suite}))})}>{running?<LoaderCircle className="spin" size={17}/>:<Play size={17}/>}비교 실험 시작</button></div>
      <p className="helper">기본 {caseCount*repeats*4}회 호출 + 자동 선택 재시도. 중단 기준은 호출 사이에 확인하므로 마지막 호출만큼 초과할 수 있습니다.</p>
     </section>
     {report?<><div className="report-heading"><div><span className={'status-dot '+(running?'pulse':'live')}/><strong>{stateNames[report.status]||report.status}</strong><Badge value={report.mode}/><span>{report.model}</span></div><div><span>{report.trials.length} / {report.plannedTrials}건</span>{running&&<button className="secondary compact" onClick={()=>act(async()=>{setReport(await api<Report>('/benchmarks/'+report.id+'/cancel',{}))})}><Square size={13}/>다음 호출부터 중단</button>}<button className="secondary compact" onClick={()=>downloadJson(report,'effort-lab-'+report.id+'.json')}><Download size={14}/>JSON 내보내기</button></div></div>
      <div className="progress-track"><i style={{width:(report.trials.length/report.plannedTrials*100)+'%'}}/></div><div className={'notice '+(report.mode==='DEMO'?'demo-notice':'')}>{report.note}</div>
      {report.error&&<div className="error-banner">{report.error}{report.status==='ERROR'&&!report.unknownUsage&&report.trials.at(-1)?.execution.attempts.length===0&&<button className="secondary compact" disabled={busy} onClick={()=>act(async()=>{setReport(await api<Report>('/benchmarks/'+report.id+'/resume',{}))})}>완료된 호출을 유지하고 재개</button>}</div>}
      {report.comparable && report.arms.ADAPTIVE.passed<report.arms.HIGH.passed && <div className="notice demo-notice">자동 선택의 정답 수가 high보다 적습니다. 토큰이 줄었어도 품질을 유지한 개선으로 볼 수 없습니다.</div>}
      {report.overallSavingsPercent!=null && <p className="helper">기존 문맥 high 대비 문맥 + effort 총토큰 변화: {report.overallSavingsPercent.toFixed(2)}% 감소. 아래 effort 비교 수치와 구분하세요.</p>}
      <section className="comparison-grid">{arms.map(arm=><div key={arm} className={'panel strategy-card '+(arm==='ADAPTIVE'?'featured':'')}><div className="strategy-title"><span>{armNames[arm]}</span>{arm==='ADAPTIVE'?<Workflow size={20}/>:<Layers size={19}/>}</div><div className="token-value">{num(report.arms[arm].totalTokens)}<span>총토큰</span></div><div className="bar-track"><i style={{width:(report.arms[arm].totalTokens/Math.max(...arms.map(a=>report.arms[a].totalTokens),1)*100)+'%'}}/></div><dl><div><dt>정답률</dt><dd>{report.arms[arm].passRate.toFixed(1)}% <small>({report.arms[arm].passed}/{report.arms[arm].trials})</small></dd></div><div><dt>출력 / 추론 토큰</dt><dd>{num(report.arms[arm].usage.outputTokens)} / {num(report.arms[arm].usage.reasoningTokens)}</dd></div><div><dt>캐시 입력 토큰</dt><dd>{num(report.arms[arm].usage.cachedInputTokens)}</dd></div><div><dt>평균 실행 시간</dt><dd>{(report.arms[arm].meanLatencyMs/1000).toFixed(2)}초</dd></div><div><dt>추가 재시도</dt><dd>{report.arms[arm].retries}회</dd></div></dl></div>)}</section>
      <div className="finding"><Activity size={20}/><div><strong>{report.savingsPercent===null?'실험이 모두 끝나면 절감률을 계산합니다.':'동일한 짧은 문맥 high 대비 총토큰 '+(report.savingsPercent>=0?report.savingsPercent.toFixed(2)+'% 감소':Math.abs(report.savingsPercent).toFixed(2)+'% 증가')}</strong><p>{report.comparable?'이 수치는 문맥 축소 효과를 제외한 effort 비교입니다. 정답률이 낮아지면 품질 유지에 성공한 것이 아닙니다. 반복 결과와 실패를 함께 확인하세요.':'중단되거나 사용량이 누락된 실험은 완전한 비교로 표시하지 않습니다.'}</p></div></div>
      <section className="panel table-panel"><div className="panel-heading"><div><h2>작업별 실행 기록</h2></div><span className="muted">행을 선택하면 실제 응답을 확인합니다</span></div><div className="table-scroll"><table><thead><tr><th>작업</th><th>전략</th><th>effort 경로</th><th>총토큰</th><th>검증</th></tr></thead><tbody>{report.trials.map((t,i)=><tr key={i} onClick={()=>setSelected(t.caseId)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setSelected(t.caseId)}}><td><strong>{t.title}</strong><small>{t.category} · {t.repetition}회차</small></td><td>{armNames[t.execution.strategy]}</td><td>{t.execution.attempts.map(a=>a.effort.toLowerCase()).join(' → ')||'—'}</td><td className="mono">{num(t.execution.totalTokens)}</td><td><Badge value={t.execution.verdict}/></td></tr>)}</tbody></table>{!report.trials.length&&<div className="table-empty"><LoaderCircle className="spin" size={20}/> 첫 응답을 기다립니다. 각 호출에 수 초~수 분이 걸릴 수 있습니다.</div>}</div></section>
      {selected&&<section className="panel detail-panel"><div className="panel-heading"><h2>{selectedTrials[0]?.title} · 응답 원문</h2><button className="secondary compact" onClick={()=>setSelected(null)}>닫기</button></div><p>{reportCases.find(c=>c.id===selected)?.prompt}</p><p className="helper">검증 정답: {reportCases.find(c=>c.id===selected)?.expectedAnswer}</p>{selectedTrials.map((t,i)=><div key={i}><strong>{armNames[t.execution.strategy]} · {t.repetition}회차</strong>{t.execution.attempts.map(a=><pre key={a.responseId}>{a.effort}: {a.output}</pre>)}</div>)}</section>}
     </>:<div className="panel large-empty"><FlaskConical size={36}/><h2>아직 비교 실험이 없습니다</h2><p>구독 모드로 실제 사용량을 측정하거나 데모로 흐름을 살펴보세요.</p></div>}
     {history.length>0&&<section className="history"><h2>저장된 실험</h2>{history.map(h=><button key={h.id} disabled={!!running} onClick={()=>{setReport(h);setSelected(null)}}><RotateCcw size={15}/>{new Date(h.createdAt).toLocaleString('ko-KR')}<Badge value={h.mode}/><span>{stateNames[h.status]||h.status}</span><ChevronRight size={16}/></button>)}</section>}
    </>}
    {tab==='method'&&<Method/>}
    <footer>EFFORT LAB <span>적절한 추론, 투명한 측정.</span><span>Local-first · Spring Boot + React</span></footer>
   </div>
  </main>
 </div>
}
function Metric({icon,label,value,note}:{icon:React.ReactNode;label:string;value:string;note:string}){return <div className="metric"><div>{label}{icon}</div><strong>{value}</strong><p>{note}</p></div>}
function Method(){return <div className="method-grid"><section className="panel prose"><span className="eyebrow">01 / PROBLEM</span><h2>모든 작업에 high가 필요할까요?</h2><p>문자 변환과 복잡한 설계 문제에 같은 effort를 쓰면 불필요한 추론이 생길 수 있습니다. effort는 보통 호출하는 프로그램이 지정합니다. 이 앱이 그 선택을 담당합니다.</p><span className="eyebrow">02 / APPROACH</span><h2>선택은 가볍게, 품질은 확인하면서</h2><ol><li><strong>로컬 규칙으로 출발점을 정합니다.</strong> 변환·추출은 low, 계산·구현은 medium, 복잡한 추론 신호나 정확도 우선은 high입니다.</li><li><strong>짧은 답변 전용 문맥으로 같은 모델을 호출합니다.</strong> Codex 구독 로그인을 사용하므로 별도 API 키가 필요하지 않습니다.</li><li><strong>기준이 있을 때 답을 검증합니다.</strong> 실패하면 effort를 높여 재시도하고 모든 호출의 토큰을 합산합니다.</li></ol><p>키워드 규칙은 난이도를 완벽히 이해하지 못합니다. 이 버전은 개선 효과를 검증할 수 있는 출발점입니다.</p></section><section className="panel prose"><span className="eyebrow">03 / MEASUREMENT</span><h2>전체 비용을 숨기지 않습니다</h2><div className="formula">총토큰 = Σ(입력 + 출력)<small>최초 호출과 모든 재시도 포함</small></div><p>추론 토큰은 출력 토큰의 일부로 다루며 다시 더하지 않습니다. Codex 기본 지시문과 캐시 입력도 총토큰에 포함됩니다. 구독의 남은 한도나 결제 금액으로 환산하지 않습니다.</p><p>기존 문맥 high와 짧은 문맥의 high, low, 자동 선택을 비교해 문맥 축소와 effort 선택 효과를 분리합니다. 순서를 순환 배치하고 정답률·응답 시간·추가 재시도를 함께 비교합니다.</p><span className="eyebrow">04 / LIMITS</span><h2>측정 결과를 읽는 기준</h2><ul><li>기초·확장 각 12문제는 소규모 합성 평가입니다. 실제 업무 전체를 대표하지 않습니다.</li><li>정답 일치와 JSON 형식 검사는 서로 다른 품질 기준입니다.</li><li>effort가 높아도 정답은 보장되지 않습니다.</li><li>데모 수치는 실제 모델 사용량이 아닙니다.</li><li>중단·시간 초과로 사용량이 누락되면 절감률을 확정하지 않습니다.</li></ul></section></div>}
