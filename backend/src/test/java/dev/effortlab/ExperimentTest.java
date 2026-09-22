package dev.effortlab;
import static dev.effortlab.Domain.*;
import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.NONE,properties="spring.datasource.url=jdbc:h2:mem:effort-test;DB_CLOSE_DELAY=-1")
class ExperimentTest {
    @Autowired BenchmarkService service;
    @Autowired ExperimentStore store;
    @Test void demoExperimentPersistsThreeArmsAndKeepsModeExplicit() throws Exception {
        var initial=service.start(new BenchmarkRequest(Mode.DEMO,1,3,50000));
        Report report=initial;
        for(int i=0;i<100 && report.status().equals("RUNNING");i++){Thread.sleep(20);report=service.get(initial.id());}
        assertThat(report.status()).isEqualTo("COMPLETED");
        assertThat(report.trials()).hasSize(9);
        assertThat(report.arms().get(Strategy.ADAPTIVE).passed()).isEqualTo(3);
        assertThat(report.mode()).isEqualTo(Mode.DEMO);
        assertThat(store.get(report.id()).id()).isEqualTo(report.id());
        assertThat(report.note()).contains("시뮬레이션");
    }
}
