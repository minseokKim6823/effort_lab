package dev.effortlab;
import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;
class CliParserTest {
    final ModelGateway gateway=new ModelGateway(new BenchmarkCases(),"test","","node",10);
    @Test void parsesActualCliShapeWithoutDoubleCountingReasoning() {
        String json="{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"ABC\"}}\n"
            +"{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":6714,\"output_tokens\":107,\"reasoning_output_tokens\":100,\"cached_input_tokens\":4864}}";
        var r=gateway.parse(json,10,"test",0);
        assertThat(r.output()).isEqualTo("ABC");assertThat(r.usage().totalTokens()).isEqualTo(6821);
        assertThat(r.usage().reasoningTokens()).isEqualTo(100);assertThat(r.usage().cachedInputTokens()).isEqualTo(4864);
    }
    @Test void missingUsageIsNeverRecordedAsZeroCostSuccess() {
        assertThatThrownBy(()->gateway.parse("{\"type\":\"turn.failed\"}",10,"test",1)).isInstanceOf(ModelGateway.ModelFailure.class);
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings={"null","-1","1.5","\"10\"","true","9223372036854775808"})
    void invalidTokenCountsCannotBecomeZeroCostOrNegativeCost(String value) {
        for(String name:java.util.List.of("input_tokens","output_tokens","reasoning_output_tokens","cached_input_tokens")) {
            var counts=new java.util.LinkedHashMap<String,String>();
            counts.put("input_tokens","10");counts.put("output_tokens","5");counts.put(name,value);
            String fields=counts.entrySet().stream().map(e->"\""+e.getKey()+"\":"+e.getValue()).collect(java.util.stream.Collectors.joining(","));
            assertThatThrownBy(()->gateway.parse("{\"type\":\"turn.completed\",\"usage\":{"+fields+"}}",10,"test",0))
                .isInstanceOfSatisfying(ModelGateway.ModelFailure.class,e->assertThat(e.unknownUsage).isTrue());
        }
    }
    @Test void overflowAndDamagedTraceNeverProduceComparableUsage() {
        for(String trace:java.util.List.of(
            "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":9223372036854775807,\"output_tokens\":1}}",
            "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":5,\"cached_input_tokens\":11}}",
            "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}\n{\"type\":"))
            assertThatThrownBy(()->gateway.parse(trace,10,"test",0))
                .isInstanceOfSatisfying(ModelGateway.ModelFailure.class,e->assertThat(e.unknownUsage).isTrue());
    }
    @Test void unexpectedToolUseInvalidatesControlledTrial() {
        var r=gateway.parse("{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\"}}\n"
            +"{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}",10,"test",0);
        assertThat(r.providerStatus()).isEqualTo("tool_used");
    }
}
