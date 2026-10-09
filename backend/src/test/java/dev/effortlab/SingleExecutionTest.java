package dev.effortlab;
import static dev.effortlab.Domain.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

class SingleExecutionTest {
    final ModelGateway gateway=mock(ModelGateway.class);
    final BenchmarkService service=new BenchmarkService(new BenchmarkCases(),
        new EvaluationService(new EffortRouter(),gateway,new AnswerVerifier()),gateway,mock(ExperimentStore.class));
    final JsonMapper json=JsonMapper.builder().build();
    @AfterEach void close() {service.close();}
    private Generation generation(String answer) {
        return new Generation(answer,new Usage(100,20,10,0),1,"test","completed");
    }
    private ExecuteRequest request(String strategyField) {
        return json.readValue("{\"task\":\"uppercase abc\",\"risk\":\"NORMAL\",\"mode\":\"DEMO\","
            + "\"check\":\"EXACT\",\"expectedAnswer\":\"ABC\""+strategyField+"}",ExecuteRequest.class);
    }
    @ParameterizedTest @ValueSource(strings={"",",\"strategy\":null"})
    void omittedOrNullStrategyUsesAdaptiveRetries(String strategyField) {
        when(gateway.generate(anyString(),eq(Effort.LOW),any())).thenReturn(generation("wrong"));
        when(gateway.generate(anyString(),eq(Effort.HIGH),any())).thenReturn(generation("ABC"));
        var result=service.single(request(strategyField));
        assertThat(result.strategy()).isEqualTo(Strategy.ADAPTIVE);
        assertThat(result.attempts()).extracting(Attempt::effort).containsExactly(Effort.LOW,Effort.HIGH);
        assertThat(result.verdict()).isEqualTo("PASS");
        assertThat(result.totalTokens()).isEqualTo(240);
    }
    @Test void fixedHighOverridesLowRouteAndRunsOnce() {
        when(gateway.generate(anyString(),eq(Effort.HIGH),any())).thenReturn(generation("wrong"));
        var result=service.single(request(",\"strategy\":\"HIGH\""));
        assertThat(result.strategy()).isEqualTo(Strategy.HIGH);
        assertThat(result.decision().effort()).isEqualTo(Effort.LOW);
        assertThat(result.attempts()).extracting(Attempt::effort).containsExactly(Effort.HIGH);
        assertThat(result.verdict()).isEqualTo("FAIL");
        verify(gateway).generate("uppercase abc",Effort.HIGH,Mode.DEMO);
        verifyNoMoreInteractions(gateway);
    }
    @Test void fixedLowDoesNotRetryAfterFailure() {
        when(gateway.generate(anyString(),eq(Effort.LOW),any())).thenReturn(generation("wrong"));
        var result=service.single(request(",\"strategy\":\"LOW\""));
        assertThat(result.strategy()).isEqualTo(Strategy.LOW);
        assertThat(result.attempts()).extracting(Attempt::effort).containsExactly(Effort.LOW);
        assertThat(result.verdict()).isEqualTo("FAIL");
        verify(gateway).generate("uppercase abc",Effort.LOW,Mode.DEMO);
        verifyNoMoreInteractions(gateway);
    }
    @Test void existingFiveArgumentConstructorDefaultsToAdaptive() {
        var request=new ExecuteRequest("uppercase abc",Risk.NORMAL,Mode.DEMO,Check.EXACT,"ABC");
        assertThat(request.strategy()).isEqualTo(Strategy.ADAPTIVE);
    }
}
