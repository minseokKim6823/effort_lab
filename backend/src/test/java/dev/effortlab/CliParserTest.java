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
    @Test void unexpectedToolUseInvalidatesControlledTrial() {
        var r=gateway.parse("{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\"}}\n"
            +"{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}",10,"test",0);
        assertThat(r.providerStatus()).isEqualTo("tool_used");
    }
}
