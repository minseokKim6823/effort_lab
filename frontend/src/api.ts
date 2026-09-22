export async function api<T>(path:string,body?:unknown):Promise<T>{
 const res=await fetch('/api'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.message||'서버 요청에 실패했습니다. ('+res.status+')');}
 return res.json();
}
export function downloadJson(data:unknown,name:string){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
