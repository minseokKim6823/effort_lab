package dev.effortlab;

import static dev.effortlab.Domain.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.json.JsonMapper;

/** HTTP validation and conflict semantics must run before any metered provider call. */
class JevControllerTest {
    private final JevGateway jev=mock(JevGateway.class);
    private final ModelGateway codex=mock(ModelGateway.class);
    private final EvaluationService evaluator=new EvaluationService(new EffortRouter(),codex,new AnswerVerifier());
    private final BenchmarkService benchmark=new BenchmarkService(new BenchmarkCases(),evaluator,codex,
        mock(ExperimentStore.class));
    private final JevService service=new JevService(jev,evaluator,benchmark);
    private MockMvc mvc;

    @BeforeEach void setup() {
        mvc=MockMvcBuilders.standaloneSetup(new JevController(service)).build();
    }
    @AfterEach void close() {benchmark.close();}

    @Test void getStatusInspectsConfigurationWithoutCallingEitherProvider() throws Exception {
        when(jev.configured()).thenReturn(false);
        mvc.perform(get("/api/jev/status")).andExpect(status().isOk())
            .andExpect(jsonPath("$.configured").value(false))
            .andExpect(jsonPath("$.model").value(JevGateway.MODEL))
            .andExpect(jsonPath("$.policyVersion").value(JevService.VERSION));
        verify(jev).configured();
        verifyNoMoreInteractions(jev);
        verifyNoInteractions(codex);
    }

    @ParameterizedTest @ValueSource(strings={
        "{\"task\":\"\",\"risk\":\"NORMAL\"}",
        "{\"task\":\"task\",\"risk\":null}",
        "{\"task\":\"task\",\"risk\":\"INVALID\"}",
        "{\"risk\":\"NORMAL\"}",
        "{not-json"
    })
    void invalidRouteRequestReturns400BeforeGatewayCalls(String body) throws Exception {
        mvc.perform(post("/api/jev/route").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").isString());
        verifyNoInteractions(jev,codex);
    }

    @Test void oversizedRouteTaskReturns400BeforeGatewayCalls() throws Exception {
        String body=JsonMapper.builder().build().writeValueAsString(Map.of("task","x".repeat(20001),"risk","NORMAL"));
        mvc.perform(post("/api/jev/route").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(jev,codex);
    }

    @ParameterizedTest @ValueSource(strings={
        "{\"task\":\"task\",\"risk\":\"NORMAL\",\"mode\":\"DEMO\",\"check\":\"EXACT\",\"expectedAnswer\":\"answer\"}",
        "{\"task\":\"task\",\"risk\":\"NORMAL\",\"mode\":\"CODEX\",\"check\":\"EXACT\"}",
        "{\"task\":\"task\",\"risk\":\"NORMAL\",\"mode\":\"CODEX\",\"check\":\"EXACT\",\"expectedAnswer\":\"answer\",\"strategy\":\"HIGH\"}",
        "{\"task\":\"task\",\"risk\":\"NORMAL\",\"mode\":null,\"check\":\"NONE\"}",
        "{\"task\":\"task\",\"risk\":\"NORMAL\",\"mode\":\"CODEX\",\"check\":null}"
    })
    void invalidExecutionReturns400BeforeGatewayCalls(String body) throws Exception {
        mvc.perform(post("/api/jev/execute").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").isString());
        verifyNoInteractions(jev,codex);
    }

    @Test void occupiedBenchmarkReturns409ForBothEndpointsBeforeAnyPaidCalls() throws Exception {
        when(codex.available()).thenReturn(true);
        benchmark.exclusively(Mode.DEMO,()->{
            try {
                mvc.perform(post("/api/jev/route").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"task\":\"task\",\"risk\":\"NORMAL\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.message").isString());
                mvc.perform(post("/api/jev/execute").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"task\":\"task\",\"risk\":\"NORMAL\",\"mode\":\"CODEX\",\"check\":\"NONE\"}"))
                    .andExpect(status().isConflict()).andExpect(jsonPath("$.message").isString());
            } catch(Exception e) {throw new AssertionError(e);}
            return null;
        });
        verifyNoInteractions(jev);
        verify(codex).available();
        verifyNoMoreInteractions(codex);
    }
}
