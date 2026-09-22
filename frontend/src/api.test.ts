import {afterEach,expect,it,vi} from 'vitest';
import {api} from './api';
afterEach(()=>vi.unstubAllGlobals());
it('surfaces actionable server errors',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({message:'다른 작업이 실행 중입니다.'})}));await expect(api('/execute',{})).rejects.toThrow('다른 작업이 실행 중입니다.');});
it('handles non-json server failures',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:502,json:async()=>{throw new Error('html')}}));await expect(api('/status')).rejects.toThrow('502');});
