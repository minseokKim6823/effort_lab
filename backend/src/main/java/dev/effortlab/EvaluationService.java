package dev.effortlab;
import static dev.effortlab.Domain.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import java.util.function.LongConsumer;
import org.springframework.stereotype.Service;
@Service
public class EvaluationService {
    private final EffortRouter router;
    private final ModelGateway gateway;
    private final AnswerVerifier verifier;
    public EvaluationService(EffortRouter router,ModelGateway gateway,AnswerVerifier verifier) {
        this.router=router;this.gateway=gateway;this.verifier=verifier;
    }
    public Execution execute(String task,Risk risk,Check check,String expected,Mode mode,
        Strategy strategy,BooleanSupplier canContinue,LongConsumer spend) {
        if((check==Check.EXACT || check==Check.CONTAINS) && (expected==null || expected.isBlank()))
            throw new IllegalArgumentException("정답 또는 필수 문자열을 입력하세요.");
        Decision decision=router.route(task,risk);
        Effort current=strategy==Strategy.ADAPTIVE ? decision.effort() : strategy==Strategy.LOW ? Effort.LOW : Effort.HIGH;
        List<Attempt> attempts=new ArrayList<>();
        Usage usage=Usage.zero(); long elapsed=0; String verdict="STOPPED",error=null;boolean unknown=false;
        while(canContinue.getAsBoolean()) {
            Generation result;
            try {result=strategy==Strategy.DEFAULT_HIGH ? gateway.generateDefault(task,current,mode) : gateway.generate(task,current,mode);}
            catch(ModelGateway.ModelFailure e) { error=e.getMessage();unknown=e.unknownUsage;verdict="ERROR";break; }
            String checked=result.providerStatus().equals("completed") ? verifier.verify(result.output(),check,expected) : "FAIL";
            attempts.add(new Attempt(current,result.output(),result.usage(),result.latencyMs(),
                result.responseId(),result.providerStatus(),checked));
            usage=usage.plus(result.usage());elapsed+=result.latencyMs();spend.accept(result.usage().totalTokens());
            verdict=checked;
            if(!result.providerStatus().equals("completed")) {error="모델 호출이 정상 종료되지 않았거나 도구를 사용했습니다.";verdict="ERROR";break;}
            if(!checked.equals("FAIL") || strategy!=Strategy.ADAPTIVE || current==Effort.HIGH) break;
            current=current.next();
        }
        return new Execution(strategy,decision,List.copyOf(attempts),usage,usage.totalTokens(),elapsed,verdict,error,unknown);
    }
}
