package dev.effortlab;
import static dev.effortlab.Domain.*;
import static org.assertj.core.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.NONE,properties="spring.datasource.url=jdbc:h2:mem:resume-test;DB_CLOSE_DELAY=-1")
class ResumeTest {
    @Autowired BenchmarkService service;
    @Autowired ExperimentStore store;
    private Report complete(Report r) throws Exception {
        for(int i=0;i<200&&(r.status().equals("RUNNING")||service.isBusy());i++){Thread.sleep(20);r=service.get(r.id());}
        assertThat(r.status()).isEqualTo("COMPLETED");return r;
    }
    @Test void resumePreservesCompletedCallsAndTheirCosts() throws Exception {
        Report original=complete(service.start(new BenchmarkRequest(Mode.DEMO,1,3,50000)));
        Trial first=original.trials().getFirst(),second=original.trials().get(1);
        Execution fault=new Execution(second.execution().strategy(),second.execution().decision(),List.of(),Usage.zero(),0,0,"ERROR","pre-call I/O",false);
        Report broken=new Report(UUID.randomUUID().toString(),original.createdAt(),"ERROR",Mode.DEMO,original.model(),original.policyVersion(),original.datasetVersion(),original.request(),original.plannedTrials(),
            List.of(first,new Trial(second.caseId(),second.title(),second.category(),second.repetition(),fault)),original.arms(),null,false,original.note(),"pre-call I/O",false,null,original.contextPolicy());
        store.save(broken);
        Report recovered=complete(service.resume(broken.id()));
        assertThat(recovered.trials()).hasSize(12);
        assertThat(recovered.trials().getFirst()).isEqualTo(first);
        assertThat(recovered.arms().get(Strategy.DEFAULT_HIGH).totalTokens()).isEqualTo(original.arms().get(Strategy.DEFAULT_HIGH).totalTokens());
        assertThat(recovered.arms().get(Strategy.ADAPTIVE).passed()).isEqualTo(3);
        assertThat(recovered.trials().stream().map(t->t.caseId()+t.repetition()+t.execution().strategy()).distinct().count()).isEqualTo(12);
        assertThatThrownBy(()->service.resume(recovered.id())).isInstanceOf(IllegalStateException.class);
        Report unknown=new Report(UUID.randomUUID().toString(),broken.createdAt(),"ERROR",Mode.DEMO,broken.model(),broken.policyVersion(),broken.datasetVersion(),broken.request(),broken.plannedTrials(),broken.trials(),broken.arms(),null,false,broken.note(),broken.error(),true,null,broken.contextPolicy());
        store.save(unknown);
        assertThatThrownBy(()->service.resume(unknown.id())).isInstanceOf(IllegalStateException.class);
    }
}
