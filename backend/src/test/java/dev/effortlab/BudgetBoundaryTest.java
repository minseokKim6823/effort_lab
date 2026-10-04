package dev.effortlab;
import static dev.effortlab.Domain.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class BudgetBoundaryTest {
    @ParameterizedTest @ValueSource(booleans={false,true})
    void lastTrialAtBudgetIsCompleteOnlyWhenNoRetryRemains(boolean adaptivePasses) throws Exception {
        var cases=new BenchmarkCases();
        var gateway=mock(ModelGateway.class);
        var store=mock(ExperimentStore.class);
        var calls=new AtomicInteger();
        String answer=cases.all().getFirst().expectedAnswer();
        when(gateway.model()).thenReturn("test");
        org.mockito.stubbing.Answer<Generation> response=invocation->{
            int n=calls.incrementAndGet();
            return new Generation(n==4 && !adaptivePasses ? "wrong" : answer,
                new Usage(200,50,0,0),1,"call-"+n,"completed");
        };
        when(gateway.generateDefault(anyString(),any(),any())).thenAnswer(response);
        when(gateway.generate(anyString(),any(),any())).thenAnswer(response);
        var service=new BenchmarkService(cases,new EvaluationService(new EffortRouter(),gateway,new AnswerVerifier()),gateway,store);
        try {
            Report initial=service.start(new BenchmarkRequest(Mode.DEMO,1,1,1000));
            for(int i=0;i<200 && service.isBusy();i++) Thread.sleep(10);
            assertThat(service.isBusy()).isFalse();
            Report result=service.get(initial.id());
            assertThat(calls.get()).isEqualTo(4);
            assertThat(result.trials()).hasSize(result.plannedTrials());
            assertThat(result.arms().values().stream().mapToLong(Arm::totalTokens).sum()).isEqualTo(1000);
            Execution last=result.trials().getLast().execution();
            assertThat(last.strategy()).isEqualTo(Strategy.ADAPTIVE);
            assertThat(last.attempts()).hasSize(1);
            assertThat(last.totalTokens()).isEqualTo(250);
            assertThat(last.verdict()).isEqualTo(adaptivePasses ? "PASS" : "STOPPED");
            assertThat(result.status()).isEqualTo(adaptivePasses ? "COMPLETED" : "BUDGET_EXCEEDED");
            assertThat(result.comparable()).isEqualTo(adaptivePasses);
            if(!adaptivePasses) {
                assertThat(result.savingsPercent()).isNull();
                assertThat(result.overallSavingsPercent()).isNull();
            }
        } finally {service.close();}
    }
}
