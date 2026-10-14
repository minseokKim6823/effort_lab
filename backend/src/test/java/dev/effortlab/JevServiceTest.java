package dev.effortlab;

import static dev.effortlab.Domain.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;

/** Jev chooses the initial effort; the real evaluator verifies and meters Codex attempts. */
class JevServiceTest {
    private final JevGateway jev=mock(JevGateway.class);
    private final ModelGateway codex=mock(ModelGateway.class);
    private final EffortRouter rules=spy(new EffortRouter());
    private final EvaluationService evaluator=new EvaluationService(rules,codex,new AnswerVerifier());
    private final BenchmarkService benchmark=new BenchmarkService(new BenchmarkCases(),evaluator,codex,
        mock(ExperimentStore.class));
    private final JevService service=new JevService(jev,evaluator,benchmark);
    private static final Usage ROUTING_USAGE=new Usage(120,8,0,0);
    private static final Usage FIRST_USAGE=new Usage(200,40,30,50);
    private static final Usage RETRY_USAGE=new Usage(210,60,45,70);
    private static final String EXPECTED="private-oracle-7f913";

    @BeforeEach void available() {when(codex.available()).thenReturn(true);}
    @AfterEach void close() {benchmark.close();}

    private JevGateway.Decision choice(Effort effort) {
        Map<Effort,Double> probabilities=Map.of(Effort.LOW,effort==Effort.LOW?0.8:0.1,
            Effort.MEDIUM,effort==Effort.MEDIUM?0.8:0.1,Effort.HIGH,effort==Effort.HIGH?0.8:0.1);
        return new JevGateway.Decision(effort,probabilities,0.7,JevGateway.MODEL,ROUTING_USAGE,17,"jev-trace");
    }
    private ExecuteRequest request(String task) {
        return new ExecuteRequest(task,Risk.NORMAL,Mode.CODEX,Check.EXACT,EXPECTED);
    }
    private Generation generation(String answer,Usage usage,long latency,String id) {
        return new Generation(answer,usage,latency,id,"completed");
    }
    private void noGeneration() {
        verify(codex,never()).generate(anyString(),any(),any());
        verify(codex,never()).generateDefault(anyString(),any(),any());
    }

    @ParameterizedTest @EnumSource(Effort.class)
    void jevInitialEffortReachesCodexWithoutLocalRuleOverride(Effort effort) {
        // Deliberately disagree with the local rules for every selected effort.
        String task=effort==Effort.HIGH?"uppercase abc":"prove the invariant from the supplied premises";
        assertThat(new EffortRouter().route(task,Risk.NORMAL).effort()).isNotEqualTo(effort);
        when(jev.decide(task)).thenReturn(choice(effort));
        when(codex.generate(task,effort,Mode.CODEX))
            .thenReturn(generation(EXPECTED,FIRST_USAGE,31,"first"));

        var result=service.single(request(task));

        assertThat(result.strategy()).isEqualTo(Strategy.ADAPTIVE);
        assertThat(result.decision().effort()).isEqualTo(effort);
        assertThat(result.decision().policyVersion()).isEqualTo(JevService.VERSION);
        assertThat(result.decision().routingTokens()).isEqualTo(128);
        assertThat(result.attempts()).extracting(Attempt::effort).containsExactly(effort);
        assertThat(result.verdict()).isEqualTo("PASS");
        assertThat(result.error()).isNull();
        assertThat(result.unknownUsage()).isFalse();
        assertThat(result.usage()).isEqualTo(new Usage(320,48,30,50));
        assertThat(result.totalTokens()).isEqualTo(368);
        assertThat(result.latencyMs()).isEqualTo(48);
        assertThat(result.generationUsage()).isEqualTo(FIRST_USAGE);
        assertThat(result.routing().usage()).isEqualTo(ROUTING_USAGE);
        assertThat(result.routing().totalTokens()).isEqualTo(128);
        assertThat(result.routing().traceId()).isEqualTo("jev-trace");
        assertThat(result.routing().provider()).isEqualTo("TYPESAFE_JEV");
        assertThat(result.routing().probabilities()).isEqualTo(choice(effort).probabilities());
        assertThat(result.routing().confidence()).isEqualTo(0.7);
        assertThat(result.routing().skipped()).isFalse();
        // Only task text crosses either gateway; the separate expected answer stays in the verifier.
        verify(jev).decide(task);
        verifyNoMoreInteractions(jev);
        verify(codex).generate(task,effort,Mode.CODEX);
        verify(codex,never()).generateDefault(anyString(),any(),any());
        verifyNoInteractions(rules);
        assertThat(benchmark.isBusy()).isFalse();
    }

    @ParameterizedTest @EnumSource(value=Effort.class,names={"LOW","MEDIUM"})
    void failedLowerEffortRetriesHighOnceWithoutReclassifyingAndIncludesAllCosts(Effort initial) {
        String task="calculate the requested result";
        when(jev.decide(task)).thenReturn(choice(initial));
        when(codex.generate(task,initial,Mode.CODEX))
            .thenReturn(generation("wrong",FIRST_USAGE,31,"first"));
        when(codex.generate(task,Effort.HIGH,Mode.CODEX))
            .thenReturn(generation(EXPECTED,RETRY_USAGE,47,"retry"));

        var result=service.single(request(task));

        assertThat(result.attempts()).extracting(Attempt::effort).containsExactly(initial,Effort.HIGH);
        assertThat(result.attempts()).extracting(Attempt::verdict).containsExactly("FAIL","PASS");
        assertThat(result.decision().effort()).isEqualTo(initial);
        assertThat(result.verdict()).isEqualTo("PASS");
        assertThat(result.generationUsage()).isEqualTo(new Usage(410,100,75,120));
        assertThat(result.usage()).isEqualTo(new Usage(530,108,75,120));
        assertThat(result.totalTokens()).isEqualTo(638);
        assertThat(result.latencyMs()).isEqualTo(95);
        var sequence=inOrder(jev,codex);
        sequence.verify(codex).available();
        sequence.verify(jev).decide(task);
        sequence.verify(codex).generate(task,initial,Mode.CODEX);
        sequence.verify(codex).generate(task,Effort.HIGH,Mode.CODEX);
        sequence.verifyNoMoreInteractions();
        verifyNoInteractions(rules);
    }

    @Test void failedHighDoesNotRetryOrReclassify() {
        String task="uppercase abc";
        when(jev.decide(task)).thenReturn(choice(Effort.HIGH));
        when(codex.generate(task,Effort.HIGH,Mode.CODEX))
            .thenReturn(generation("wrong",FIRST_USAGE,31,"first"));
        var result=service.single(request(task));
        assertThat(result.verdict()).isEqualTo("FAIL");
        assertThat(result.attempts()).hasSize(1);
        assertThat(result.totalTokens()).isEqualTo(368);
        verify(jev).decide(task);
        verify(codex).generate(task,Effort.HIGH,Mode.CODEX);
        verify(codex).available();
        verifyNoMoreInteractions(jev,codex);
    }

    @ParameterizedTest @ValueSource(booleans={false,true})
    void classificationFailurePreservesKnownAndUnknownUsageAndNeverGenerates(boolean unknown) {
        Usage known=unknown?new Usage(120,0,0,0):ROUTING_USAGE;
        when(jev.decide("task")).thenThrow(new JevGateway.JevFailure("classification failed",known,
            unknown,"failed-jev",23));
        var result=service.single(request("task"));
        assertThat(result.verdict()).isEqualTo("ERROR");
        assertThat(result.error()).isEqualTo("classification failed");
        assertThat(result.unknownUsage()).isEqualTo(unknown);
        assertThat(result.decision()).isNull();
        assertThat(result.attempts()).isEmpty();
        assertThat(result.usage()).isEqualTo(known);
        assertThat(result.totalTokens()).isEqualTo(known.totalTokens());
        assertThat(result.latencyMs()).isEqualTo(23);
        assertThat(result.routing().usage()).isEqualTo(known);
        assertThat(result.routing().traceId()).isEqualTo("failed-jev");
        assertThat(result.generationUsage()).isEqualTo(Usage.zero());
        assertThat(benchmark.isBusy()).isFalse();
        noGeneration();
        verifyNoInteractions(rules);
    }

    @Test void generationFailureAfterRetryRetainsClassificationAndEarlierAttemptUsage() {
        when(jev.decide("task")).thenReturn(choice(Effort.LOW));
        when(codex.generate("task",Effort.LOW,Mode.CODEX))
            .thenReturn(generation("wrong",FIRST_USAGE,31,"first"));
        when(codex.generate("task",Effort.HIGH,Mode.CODEX))
            .thenThrow(new ModelGateway.ModelFailure("generation timeout",true));
        var result=service.single(request("task"));
        assertThat(result.verdict()).isEqualTo("ERROR");
        assertThat(result.error()).isEqualTo("generation timeout");
        assertThat(result.unknownUsage()).isTrue();
        assertThat(result.attempts()).extracting(Attempt::effort).containsExactly(Effort.LOW);
        assertThat(result.usage()).isEqualTo(new Usage(320,48,30,50));
        assertThat(result.generationUsage()).isEqualTo(FIRST_USAGE);
        assertThat(result.totalTokens()).isEqualTo(368);
        verify(jev).decide("task");
        verifyNoMoreInteractions(jev);
        assertThat(benchmark.isBusy()).isFalse();
    }

    @Test void highRiskSkipsClassificationAndGeneratesHighWithZeroRoutingUsage() {
        when(codex.generate("uppercase abc",Effort.HIGH,Mode.CODEX))
            .thenReturn(generation(EXPECTED,FIRST_USAGE,31,"first"));
        var result=service.single(new ExecuteRequest("uppercase abc",Risk.HIGH,Mode.CODEX,Check.EXACT,EXPECTED));
        assertThat(result.decision().effort()).isEqualTo(Effort.HIGH);
        assertThat(result.decision().routingTokens()).isZero();
        assertThat(result.attempts()).extracting(Attempt::effort).containsExactly(Effort.HIGH);
        assertThat(result.usage()).isEqualTo(FIRST_USAGE);
        assertThat(result.totalTokens()).isEqualTo(240);
        assertThat(result.latencyMs()).isEqualTo(31);
        assertThat(result.routing().skipped()).isTrue();
        assertThat(result.routing().usage()).isEqualTo(Usage.zero());
        assertThat(result.routing().latencyMs()).isZero();
        assertThat(result.routing().provider()).isEqualTo("RISK_OVERRIDE");
        verifyNoInteractions(jev,rules);
    }

    @Test void routingOnlyWorksWithoutCodexAndNeverGenerates() {
        when(codex.available()).thenReturn(false);
        when(jev.decide("task")).thenReturn(choice(Effort.MEDIUM));
        var result=service.route(new RouteRequest("task",Risk.NORMAL));
        assertThat(result.decision().effort()).isEqualTo(Effort.MEDIUM);
        assertThat(result.routing().totalTokens()).isEqualTo(128);
        assertThat(result.error()).isNull();
        verifyNoInteractions(codex,rules);
        verify(jev).decide("task");
    }

    @Test void routingUsageLargerThanIntegerRangeIsPreserved() {
        Usage large=new Usage(Integer.MAX_VALUE,8,0,0);
        var decision=choice(Effort.LOW);
        when(jev.decide("task")).thenReturn(new JevGateway.Decision(decision.effort(),
            decision.probabilities(),decision.confidence(),decision.model(),large,17,"large-jev"));
        var result=service.route(new RouteRequest("task",Risk.NORMAL));
        assertThat(result.error()).isNull();
        assertThat(result.decision().routingTokens()).isEqualTo(2_147_483_655L);
        assertThat(result.routing().usage()).isEqualTo(large);
        assertThat(result.routing().totalTokens()).isEqualTo(2_147_483_655L);
        verifyNoInteractions(codex,rules);
    }

    @Test void unavailableCodexRejectsBeforeChargingForClassification() {
        when(codex.available()).thenReturn(false);
        assertThatThrownBy(()->service.single(request("task"))).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(jev,rules);
        noGeneration();
        assertThat(benchmark.isBusy()).isFalse();
    }

    static Stream<Arguments> invalidRequests() {
        return Stream.of(
            Arguments.of(new ExecuteRequest("task",Risk.NORMAL,Mode.DEMO,Check.EXACT,EXPECTED)),
            Arguments.of(new ExecuteRequest("task",Risk.NORMAL,Mode.CODEX,Check.EXACT,null)),
            Arguments.of(new ExecuteRequest("task",Risk.NORMAL,Mode.CODEX,Check.EXACT,"  ")),
            Arguments.of(new ExecuteRequest("task",Risk.NORMAL,Mode.CODEX,Check.CONTAINS,"")),
            Arguments.of(new ExecuteRequest("task",Risk.NORMAL,Mode.CODEX,Check.EXACT,EXPECTED,Strategy.LOW)),
            Arguments.of(new ExecuteRequest("task",Risk.NORMAL,Mode.CODEX,Check.EXACT,EXPECTED,Strategy.HIGH)),
            Arguments.of(new ExecuteRequest("task",Risk.NORMAL,Mode.CODEX,Check.EXACT,EXPECTED,Strategy.DEFAULT_HIGH)));
    }
    @ParameterizedTest @MethodSource("invalidRequests")
    void invalidExecutionIsRejectedBeforeAnyGatewayCall(ExecuteRequest request) {
        assertThatThrownBy(()->service.single(request)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(jev,codex,rules);
        assertThat(benchmark.isBusy()).isFalse();
    }

    @Test void sharedBusyLockRejectsBothJevEndpointsBeforeClassificationOrGeneration() {
        benchmark.exclusively(Mode.DEMO,()->{
            assertThatThrownBy(()->service.route(new RouteRequest("task",Risk.NORMAL)))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("실행 중");
            assertThatThrownBy(()->service.single(request("task")))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("실행 중");
            verifyNoInteractions(jev,rules);
            noGeneration();
            return null;
        });
        assertThat(benchmark.isBusy()).isFalse();
    }

    @Test void sharedLockRemainsHeldAcrossClassificationAndGeneration() {
        Runnable assertLocked=()->{
            assertThat(benchmark.isBusy()).isTrue();
            assertThatThrownBy(()->benchmark.single(new ExecuteRequest("other",Risk.NORMAL,
                Mode.DEMO,Check.NONE,null))).isInstanceOf(IllegalStateException.class);
            assertThatThrownBy(()->service.route(new RouteRequest("other",Risk.NORMAL)))
                .isInstanceOf(IllegalStateException.class);
        };
        when(jev.decide("task")).thenAnswer(invocation->{assertLocked.run();return choice(Effort.MEDIUM);});
        when(codex.generate("task",Effort.MEDIUM,Mode.CODEX)).thenAnswer(invocation->{
            assertLocked.run();return generation(EXPECTED,FIRST_USAGE,31,"first");
        });
        assertThat(service.single(request("task")).verdict()).isEqualTo("PASS");
        assertThat(benchmark.isBusy()).isFalse();
        verify(jev).decide("task");
        verifyNoMoreInteractions(jev);
        verifyNoInteractions(rules);
    }
}
