package dev.effortlab;

import static dev.effortlab.Domain.*;
import java.util.*;
import org.springframework.stereotype.Service;

@Service
public class JevService {
    public static final String VERSION="jev-1.0";
    private final JevGateway gateway;
    private final EvaluationService evaluator;
    private final BenchmarkService benchmark;

    public JevService(JevGateway gateway,EvaluationService evaluator,BenchmarkService benchmark) {
        this.gateway=gateway;this.evaluator=evaluator;this.benchmark=benchmark;
    }
    public record Status(boolean configured,String model,String policyVersion) {}
    public record Routing(String provider,String model,String policyVersion,Map<Effort,Double> probabilities,
        Double confidence,Usage usage,long totalTokens,long latencyMs,String traceId,boolean skipped) {}
    public record RouteResult(Decision decision,Routing routing,String error,boolean unknownUsage) {}
    public record Result(Strategy strategy,Decision decision,List<Attempt> attempts,Usage usage,
        long totalTokens,long latencyMs,String verdict,String error,boolean unknownUsage,
        Routing routing,Usage generationUsage) {}

    public Status status() {return new Status(gateway.configured(),JevGateway.MODEL,VERSION);}
    public RouteResult route(RouteRequest request) {
        // Share the existing lock, but a routing-only call does not need Codex installed.
        return benchmark.exclusively(Mode.DEMO,()->routeUnlocked(request.task(),request.risk()));
    }
    public Result single(ExecuteRequest request) {
        if(request.mode()!=Mode.CODEX)
            throw new IllegalArgumentException("Jev는 실제 API를 호출합니다. Codex 실제 측정 모드를 선택하세요.");
        if(request.strategy()!=Strategy.ADAPTIVE)
            throw new IllegalArgumentException("Jev 실행은 자동 effort 전략만 지원합니다.");
        if((request.check()==Check.EXACT || request.check()==Check.CONTAINS)
            && (request.expectedAnswer()==null || request.expectedAnswer().isBlank()))
            throw new IllegalArgumentException("정답 또는 필수 문자열을 입력하세요.");
        return benchmark.exclusively(request.mode(),()->{
            RouteResult selected=routeUnlocked(request.task(),request.risk());
            Routing routing=selected.routing();
            if(selected.error()!=null)
                return new Result(Strategy.ADAPTIVE,null,List.of(),routing.usage(),routing.totalTokens(),
                    routing.latencyMs(),"ERROR",selected.error(),selected.unknownUsage(),routing,Usage.zero());
            Execution execution=evaluator.executeWithDecision(request.task(),request.check(),request.expectedAnswer(),
                request.mode(),Strategy.ADAPTIVE,selected.decision(),()->true,n->{});
            Usage all=routing.usage().plus(execution.usage());
            return new Result(Strategy.ADAPTIVE,execution.decision(),execution.attempts(),all,all.totalTokens(),
                routing.latencyMs()+execution.latencyMs(),execution.verdict(),execution.error(),
                execution.unknownUsage(),routing,execution.usage());
        });
    }
    private RouteResult routeUnlocked(String task,Risk risk) {
        if(risk==Risk.HIGH) {
            Routing routing=new Routing("RISK_OVERRIDE",null,VERSION,Map.of(),null,Usage.zero(),0,0,null,true);
            Decision decision=new Decision(Effort.HIGH,80,List.of("정확도 우선으로 high를 선택했습니다. Jev 호출은 생략했습니다."),VERSION,0,0);
            return new RouteResult(decision,routing,null,false);
        }
        try {
            JevGateway.Decision classified=gateway.decide(task);
            Usage usage=classified.usage();
            Routing routing=new Routing("TYPESAFE_JEV",classified.model(),VERSION,classified.probabilities(),
                classified.confidence(),usage,usage.totalTokens(),classified.latencyMs(),classified.traceId(),false);
            Decision decision=new Decision(classified.effort(),0,List.of(
                "Jev가 작업을 분류하여 "+classified.effort().name().toLowerCase(Locale.ROOT)+"를 선택했습니다.",
                "분류 confidence는 답변의 정답 확률이 아닙니다."),VERSION,
                classified.latencyMs()*1000,usage.totalTokens());
            return new RouteResult(decision,routing,null,false);
        } catch(JevGateway.JevFailure failure) {
            Routing routing=new Routing("TYPESAFE_JEV",JevGateway.MODEL,VERSION,Map.of(),null,
                failure.knownUsage,failure.knownUsage.totalTokens(),failure.latencyMs,failure.traceId,false);
            return new RouteResult(null,routing,failure.getMessage(),failure.unknownUsage);
        }
    }
}
