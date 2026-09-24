const $=id=>document.getElementById(id);
const names={DEFAULT_HIGH:'기존 문맥 · high',HIGH:'짧은 문맥 · high',LOW:'짧은 문맥 · low',ADAPTIVE:'짧은 문맥 · 자동'};
const nf=new Intl.NumberFormat('ko-KR');
const change=n=>Math.abs(n).toFixed(2)+'% '+(n>=0?'감소':'증가');
try{
 const response=await fetch('./metrics.json');if(!response.ok)throw Error('측정 파일을 불러올 수 없습니다.');
 const m=await response.json();
 $('overall').textContent=change(m.contextSavingsPercent);$('quality').textContent=m.arms.HIGH.passRate.toFixed(1)+'%';
 $('quality-detail').textContent=m.arms.HIGH.passed+' / '+m.arms.HIGH.trials+'건 · 정답 일치 검증';
 $('model-label').textContent=m.model+' · 완료된 1회차 12문제 · '+m.trials+'개 전략 실행';
 $('context-effect').textContent=change(m.contextSavingsPercent);$('effort-effect').textContent=change(m.effortSavingsPercent);
 $('conclusion').textContent=m.conclusion;
 function render(){
  const key=$('metric-select').value;
  const value=arm=>key==='totalTokens'?arm.totalTokens:arm.usage[key];
  const maximum=Math.max(...Object.values(m.arms).map(value),1);
  $('bars').replaceChildren(...Object.entries(names).map(([id,label])=>{
   const arm=m.arms[id],row=document.createElement('div');row.className='bar-row';
   const name=document.createElement('div');name.className='bar-label';name.append(document.createTextNode(label));
   const note=document.createElement('small');note.textContent='정답 '+arm.passed+'/'+arm.trials+' · 재시도 '+arm.retries+'회';name.append(note);
   const track=document.createElement('div');track.className='bar-track';const fill=document.createElement('div');fill.className='bar-fill';fill.style.width=value(arm)/maximum*100+'%';track.append(fill);
   const number=document.createElement('div');number.className='bar-value';number.textContent=nf.format(value(arm));row.append(name,track,number);return row;
  }));
 }
 $('metric-select').addEventListener('change',render);render();
}catch(e){$('conclusion').textContent='측정 데이터를 불러오지 못했습니다. 아래 GitHub 실측 보고서에서 확인해 주세요.';console.error(e.message);}
