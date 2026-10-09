package dev.effortlab;
import static dev.effortlab.Domain.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
    @ParameterizedTest @ValueSource(strings={
        "점화식 a(n)=2*a(n-1)+3, a(0)=1의 20번째 값을 계산하세요.",
        "재귀 수열 F(0)=1, F(n)=3*F(n-1) mod 101에서 F(15)를 구하세요.",
        "재귀수열의 마지막 항을 계산하세요.",
        "Evaluate the RECURRENCE a(n)=2*a(n-1)+3 at n=20.",
        "Solve these recurrences and return the last value.",
        "방향 그래프의 최단 경로 길이를 구하세요.",
        "정점 0에서 7까지 최단거리를 구하세요.",
        "Find the shortest path from A to F.",
        "Calculate shortest-path lengths in the weighted graph."
    })
    void sequentialStateAndPathProblemsStartHigh(String task) {
        assertThat(router.route(task,Risk.NORMAL).effort()).isEqualTo(Effort.HIGH);
    }
    @ParameterizedTest @ValueSource(strings={
        "재귀 함수로 파일 목록을 순회하는 코드를 구현하세요.",
        "Implement a recursive directory listing.",
        "SQL 주문 집계 결과를 계산하세요."
    })
    void ordinaryRecursionAndAggregationRemainMedium(String task) {
        assertThat(router.route(task,Risk.NORMAL).effort()).isEqualTo(Effort.MEDIUM);
    }
    @ParameterizedTest @ValueSource(strings={
        "Uppercase this token: nonrecurrence",
        "Uppercase this token: shortest_pathway"
    })
    void partialEnglishWordsDoNotTriggerNewHardSignals(String task) {
        assertThat(router.route(task,Risk.NORMAL).effort()).isEqualTo(Effort.LOW);
    }
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
        when(gateway.generate(anyString(),eq(Effort.HIGH),eq(Mode.DEMO))).thenReturn(gen("ABC",110,70));
        AtomicLong spend=new AtomicLong();
        var r=evaluator.execute("대문자 변환",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.ADAPTIVE,()->true,spend::addAndGet);
        assertThat(r.verdict()).isEqualTo("PASS");assertThat(r.attempts()).hasSize(2);
        assertThat(r.totalTokens()).isEqualTo(330);assertThat(r.usage().reasoningTokens()).isEqualTo(116);
        assertThat(spend.get()).isEqualTo(330);
        assertThat(r.attempts()).extracting(Attempt::effort).containsExactly(Effort.LOW,Effort.HIGH);
        var order=inOrder(gateway);
        order.verify(gateway).generate("대문자 변환",Effort.LOW,Mode.DEMO);
        order.verify(gateway).generate("대문자 변환",Effort.HIGH,Mode.DEMO);
        order.verifyNoMoreInteractions();
    }
    @Test void failedLowAndHighTerminateAfterTwoCalls() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(gen("wrong",10,20));
        var r=evaluator.execute("대문자 변환",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.ADAPTIVE,()->true,n->{});
        assertThat(r.attempts()).extracting(Attempt::effort).containsExactly(Effort.LOW,Effort.HIGH);
        assertThat(r.totalTokens()).isEqualTo(60);assertThat(r.verdict()).isEqualTo("FAIL");
    }
    @Test void failedMediumRetriesAtHighAndIncludesBothCosts() {
        when(gateway.generate(anyString(),eq(Effort.MEDIUM),any())).thenReturn(gen("wrong",100,40));
        when(gateway.generate(anyString(),eq(Effort.HIGH),any())).thenReturn(gen("42",110,60));
        AtomicLong spend=new AtomicLong();
        var r=evaluator.execute("조건별 합계를 계산하세요.",Risk.NORMAL,Check.EXACT,"42",Mode.DEMO,Strategy.ADAPTIVE,()->true,spend::addAndGet);
        assertThat(r.attempts()).extracting(Attempt::effort).containsExactly(Effort.MEDIUM,Effort.HIGH);
        assertThat(r.verdict()).isEqualTo("PASS");assertThat(r.totalTokens()).isEqualTo(310);
        assertThat(spend.get()).isEqualTo(310);
    }
    @Test void highStartDoesNotRetryAfterFailure() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(gen("wrong",10,20));
        var r=evaluator.execute("점화식의 마지막 항을 계산하세요.",Risk.NORMAL,Check.EXACT,"42",Mode.DEMO,Strategy.ADAPTIVE,()->true,n->{});
        assertThat(r.attempts()).extracting(Attempt::effort).containsExactly(Effort.HIGH);
        assertThat(r.totalTokens()).isEqualTo(30);assertThat(r.verdict()).isEqualTo("FAIL");
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
        when(gateway.generate(anyString(),eq(Effort.HIGH),any())).thenThrow(new ModelGateway.ModelFailure("timeout",true));
        var r=evaluator.execute("大 uppercase",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.ADAPTIVE,()->true,n->{});
        assertThat(r.unknownUsage()).isTrue();assertThat(r.totalTokens()).isEqualTo(30);assertThat(r.verdict()).isEqualTo("ERROR");
    }
    @Test void incompleteResponseCountsTokensAndDoesNotRetryBlindly() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(new Generation("",new Usage(10,100,100,0),2,"x","failed"));
        var r=evaluator.execute("uppercase",Risk.NORMAL,Check.EXACT,"ABC",Mode.DEMO,Strategy.ADAPTIVE,()->true,n->{});
        assertThat(r.totalTokens()).isEqualTo(110);assertThat(r.verdict()).isEqualTo("ERROR");assertThat(r.attempts()).hasSize(1);
    }
}
