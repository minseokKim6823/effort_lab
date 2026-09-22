package dev.effortlab;
import static dev.effortlab.Domain.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
class CoreTest {
    final EffortRouter router=new EffortRouter();
    final AnswerVerifier verifier=new AnswerVerifier();
    final ModelGateway gateway=mock(ModelGateway.class);
    final EvaluationService evaluator=new EvaluationService(router,gateway,verifier);
    @Test void simpleStartsLowWithoutModelTokens() {
        var d=router.route("문자열을 대문자로 변환: abc",Risk.NORMAL);
        assertThat(d.effort()).isEqualTo(Effort.LOW);assertThat(d.routingTokens()).isZero();
    }
    @Test void highRiskOverridesSimpleTask() {assertThat(router.route("대문자 변환",Risk.HIGH).effort()).isEqualTo(Effort.HIGH);}
    @Test void shortUnknownDoesNotMeanEasy() {assertThat(router.route("이 명제는 참인가?",Risk.NORMAL).effort()).isEqualTo(Effort.MEDIUM);}
    @Test void hardSignalDominatesSimpleKeyword() {assertThat(router.route("분산 트랜잭션 불변식 증명 후 요약",Risk.NORMAL).effort()).isEqualTo(Effort.HIGH);}
    @Test void longContextRaisesEffort() {assertThat(router.route("추출 "+"가".repeat(7000),Risk.NORMAL).effort()).isEqualTo(Effort.HIGH);}
    @Test void unverifiedIsNotSuccess() {assertThat(verifier.verify("anything",Check.NONE,null)).isEqualTo("UNVERIFIED");}
    @Test void exactDoesNotAcceptExtraExplanation() {assertThat(verifier.verify("42 because...",Check.EXACT,"42")).isEqualTo("FAIL");}
    @Test void exactNormalizesOnlyOuterWhitespace() {assertThat(verifier.verify(" 42\n",Check.EXACT,"42")).isEqualTo("PASS");}
    @Test void jsonAcceptsObjectsButNotScalar() {
        assertThat(verifier.verify("{\"ok\":true}",Check.JSON,null)).isEqualTo("PASS");
        assertThat(verifier.verify("42",Check.JSON,null)).isEqualTo("FAIL");
    }
    @Test void emptyExpectedAnswerIsRejected() {assertThatThrownBy(()->verifier.verify("x",Check.EXACT,"")).isInstanceOf(IllegalArgumentException.class);}
    private Generation gen(String output,long input,long out) {return new Generation(output,new Usage(input,out,Math.max(0,out-2),0),5,"test","completed");}
    @Test void retryIncludesFailedInputAndReasoningOnlyOnce() {
        when(gateway.generate(anyString(),eq(Effort.LOW),eq(Mode.DEMO))).thenReturn(gen("wrong",100,50));
        when(gateway.generate(anyString(),eq(Effort.MEDIUM),eq(Mode.DEMO))).thenReturn(gen("ABC",110,70));
        AtomicLong spend=new AtomicLong();
        var r=evaluator.execute("대문자 변환",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.ADAPTIVE,()->true,spend::addAndGet);
        assertThat(r.verdict()).isEqualTo("PASS");assertThat(r.attempts()).hasSize(2);
        assertThat(r.totalTokens()).isEqualTo(330);assertThat(r.usage().reasoningTokens()).isEqualTo(116);
        assertThat(spend.get()).isEqualTo(330);
    }
    @Test void failedHighTerminatesAfterThreeCalls() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(gen("wrong",10,20));
        var r=evaluator.execute("대문자 변환",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.ADAPTIVE,()->true,n->{});
        assertThat(r.attempts()).hasSize(3);assertThat(r.totalTokens()).isEqualTo(90);assertThat(r.verdict()).isEqualTo("FAIL");
    }
    @Test void staticLowDoesNotRetry() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(gen("wrong",10,20));
        var r=evaluator.execute("대문자 변환",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.LOW,()->true,n->{});
        assertThat(r.attempts()).hasSize(1);
    }
    @Test void noVerifierDoesNotRetry() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(gen("unchecked",10,20));
        var r=evaluator.execute("대문자 변환",Risk.NORMAL,Check.NONE,null,Mode.DEMO,Strategy.ADAPTIVE,()->true,n->{});
        assertThat(r.attempts()).hasSize(1);assertThat(r.verdict()).isEqualTo("UNVERIFIED");
    }
    @Test void budgetStopsBeforeRetryAndKeepsSpentUsage() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(gen("wrong",10,20));
        AtomicLong spend=new AtomicLong();
        var r=evaluator.execute("대문자 변환",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.ADAPTIVE,()->spend.get()<20,spend::addAndGet);
        assertThat(r.attempts()).hasSize(1);assertThat(r.totalTokens()).isEqualTo(30);
    }
    @Test void unknownUsageOnRetryKeepsEarlierCosts() {
        when(gateway.generate(anyString(),eq(Effort.LOW),any())).thenReturn(gen("wrong",10,20));
        when(gateway.generate(anyString(),eq(Effort.MEDIUM),any())).thenThrow(new ModelGateway.ModelFailure("timeout",true));
        var r=evaluator.execute("大 uppercase",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.ADAPTIVE,()->true,n->{});
        assertThat(r.unknownUsage()).isTrue();assertThat(r.totalTokens()).isEqualTo(30);assertThat(r.verdict()).isEqualTo("ERROR");
    }
    @Test void incompleteResponseCountsTokensAndDoesNotRetryBlindly() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(new Generation("",new Usage(10,100,100,0),2,"x","failed"));
        var r=evaluator.execute("uppercase",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.ADAPTIVE,()->true,n->{});
        assertThat(r.totalTokens()).isEqualTo(110);assertThat(r.verdict()).isEqualTo("ERROR");assertThat(r.attempts()).hasSize(1);
    }
}
