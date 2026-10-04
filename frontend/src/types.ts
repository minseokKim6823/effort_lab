export type Effort='LOW'|'MEDIUM'|'HIGH';
export type Mode='DEMO'|'CODEX';
export type Strategy='DEFAULT_HIGH'|'HIGH'|'LOW'|'ADAPTIVE';
export interface Decision{effort:Effort;score:number;reasons:string[];policyVersion:string;routingMicros:number;routingTokens:number}
export interface Usage{inputTokens:number;outputTokens:number;reasoningTokens:number;cachedInputTokens:number}
export interface Attempt{effort:Effort;output:string;usage:Usage;latencyMs:number;responseId:string;providerStatus:string;verdict:string}
export interface Execution{strategy:Strategy;decision:Decision;attempts:Attempt[];usage:Usage;totalTokens:number;latencyMs:number;verdict:string;error:string|null;unknownUsage:boolean}
export interface TaskCase{id:string;title:string;category:string;prompt:string;expectedAnswer:string;demoMinimum:Effort}
export interface Trial{caseId:string;title:string;category:string;repetition:number;execution:Execution}
export interface Arm{trials:number;passed:number;retries:number;usage:Usage;totalTokens:number;passRate:number;meanLatencyMs:number;tokensPerSuccess:number|null}
export interface Report{id:string;createdAt:string;status:string;mode:Mode;model:string;policyVersion:string;datasetVersion:string;request:{repeats:number;caseCount:number;tokenBudget:number;suite?:string};plannedTrials:number;trials:Trial[];arms:Record<Strategy,Arm>;savingsPercent:number|null;overallSavingsPercent?:number|null;contextPolicy?:string;comparable:boolean;note:string;error:string|null;unknownUsage:boolean}

export type Check='NONE'|'EXACT'|'CONTAINS'|'JSON';
export interface BatchItemInput{id:string;task:string;check:Check;expectedAnswer?:string}
export interface BatchItemResult{id:string;output:string;verdict:'PASS'|'FAIL'|'UNVERIFIED'|'ERROR'|'STOPPED';callId:string|null}
export interface Generation{output:string;usage:Usage;latencyMs:number;responseId:string;providerStatus:string}
export interface BatchCall{taskIds:string[];prompt:string;generation:Generation;parseError:string|null}
export interface BatchReport{id:string;createdAt:string;mode:Mode;model:string;policyVersion:string;status:'COMPLETED'|'ERROR'|'BUDGET_EXCEEDED';batchSize:number;plannedCalls?:number;items:BatchItemResult[];calls:BatchCall[];usage:Usage;totalTokens:number;latencyMs:number;unknownUsage:boolean;error:string|null}

export interface Status{codexAvailable:boolean;model:string;busy:boolean;policyVersion:string;datasetVersion:string}
