package dev.effortlab;
import static dev.effortlab.Domain.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;

class ExclusiveExecutionTest {
    private BenchmarkService service() {
        var cases=new BenchmarkCases();
        var gateway=mock(ModelGateway.class);
        return new BenchmarkService(cases,new EvaluationService(new EffortRouter(),gateway,new AnswerVerifier()),
            gateway,mock(ExperimentStore.class));
    }
    @Test void batchGuardBlocksSingleBenchmarkAndAnotherBatch() {
        var service=service();
        try {
            assertThat(service.exclusively(Mode.DEMO,()->{
                assertThat(service.isBusy()).isTrue();
                assertThatThrownBy(()->service.single(new ExecuteRequest("test",Risk.NORMAL,Mode.DEMO,Check.NONE,null)))
                    .isInstanceOf(IllegalStateException.class);
                assertThatThrownBy(()->service.start(new BenchmarkRequest(Mode.DEMO,1,1,1000)))
                    .isInstanceOf(IllegalStateException.class);
                assertThatThrownBy(()->service.exclusively(Mode.DEMO,()->"unexpected"))
                    .isInstanceOf(IllegalStateException.class);
                assertThat(service.isBusy()).isTrue();
                return "finished";
            })).isEqualTo("finished");
            assertThat(service.isBusy()).isFalse();
        } finally {service.close();}
    }
    @Test void failedBatchReleasesGuardForNextRequest() {
        var service=service();
        try {
            assertThatThrownBy(()->service.exclusively(Mode.DEMO,()->{throw new IllegalArgumentException("invalid batch");}))
                .isInstanceOf(IllegalArgumentException.class);
            assertThat(service.isBusy()).isFalse();
            assertThat(service.exclusively(Mode.DEMO,()->"next request")).isEqualTo("next request");
        } finally {service.close();}
    }
}
