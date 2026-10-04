package dev.effortlab;
import static dev.effortlab.Domain.*;
import static dev.effortlab.BatchDomain.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.*;
import org.junit.jupiter.api.Test;
class BatchServiceTest {
    final ModelGateway gateway=mock(ModelGateway.class);
    final BatchService service=new BatchService(gateway,new AnswerVerifier());
    Item item(String id) {return new Item(id,"Task "+id,Check.EXACT,"SECRET_EXPECTED");}
    Request request(int size,long budget,Item... items) {return new Request(Mode.CODEX,size,budget,List.of(items));}
    Generation generation(String output,long tokens,String id) {return new Generation(output,new Usage(tokens-10,10,0,0),5,id,"completed");}
    @Test void labelsAndVerificationRulesNeverEnterPromptOrAffectPacking() {
        Item original=item("a");
        Item changed=new Item("a",original.task(),Check.NONE,"OTHER_SECRET");
        assertThat(service.prompt(List.of(original))).isEqualTo(service.prompt(List.of(changed)));
        assertThat(service.prompt(List.of(original))).doesNotContain("SECRET_EXPECTED","expectedAnswer","EXACT");
        assertThat(service.pack(List.of(original,changed),1)).hasSize(2);
    }
    @Test void packingBoundsBothCountAndCharactersWithoutReordering() {
        var items=List.of(new Item("a","x".repeat(4000),Check.NONE,null),
            new Item("b","y".repeat(4000),Check.NONE,null),item("c"),item("d"),item("e"),item("f"),item("g"));
        var groups=service.pack(items,4);
        assertThat(groups.stream().mapToInt(List::size).toArray()).containsExactly(2,4,1);
        assertThat(groups.stream().flatMap(List::stream).toList()).isEqualTo(items);
    }
    @Test void responseIdsPreserveMappingWhenModelReordersAnswers() {
        assertThat(service.parse("{\"answers\":[{\"id\":\"b\",\"answer\":\"B\"},{\"id\":\"a\",\"answer\":\"A\"}]}",List.of(item("a"),item("b"))))
            .containsEntry("a","A").containsEntry("b","B");
    }
    @Test void malformedMissingDuplicateOrUnexpectedIdsAreRejected() {
        for(String output:List.of(
            "{\"answers\":[]}",
            "{\"answers\":[{\"id\":\"other\",\"answer\":\"A\"}]}",
            "{\"answers\":[{\"id\":\"a\",\"answer\":\"A\"},{\"id\":\"a\",\"answer\":\"B\"}]}",
            "{\"answers\":[{\"id\":\"a\",\"answer\":1}]}",
            "{\"answers\":[{\"id\":\"a\",\"answer\":\"A\",\"answer\":\"B\"}]}",
            "{\"answers\":[{\"id\":\"a\",\"answer\":\"A\"}]} trailing"))
            assertThatThrownBy(()->service.parse(output,List.of(item("a")))).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void semanticFailureDoesNotTriggerAnOracleBasedRetry() {
        when(gateway.generate(anyString(),eq(Effort.HIGH),eq(Mode.CODEX))).thenReturn(
            generation("{\"answers\":[{\"id\":\"a\",\"answer\":\"wrong\"}]}",200,"call-1"));
        Result result=service.execute(request(4,1000,item("a")));
        assertThat(result.status()).isEqualTo("COMPLETED");
        assertThat(result.items().getFirst().verdict()).isEqualTo("FAIL");
        assertThat(result.totalTokens()).isEqualTo(200);
        verify(gateway,times(1)).generate(anyString(),eq(Effort.HIGH),eq(Mode.CODEX));
    }
    @Test void malformedBatchKeepsCallCostAndStopsFutureCalls() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(generation("not json",200,"call-1"));
        Result result=service.execute(request(1,1000,item("a"),item("b")));
        assertThat(result.status()).isEqualTo("ERROR");
        assertThat(result.totalTokens()).isEqualTo(200);
        assertThat(result.unknownUsage()).isFalse();
        assertThat(result.calls().getFirst().parseError()).isNotBlank();
        assertThat(result.items().stream().map(ItemResult::verdict).toList()).containsExactly("ERROR","STOPPED");
        verify(gateway,times(1)).generate(anyString(),any(),any());
    }
    @Test void unknownLaterUsageRetainsEarlierMeasuredCall() {
        when(gateway.generate(anyString(),any(),any()))
            .thenReturn(generation("{\"answers\":[{\"id\":\"a\",\"answer\":\"ok\"}]}",200,"call-1"))
            .thenThrow(new ModelGateway.ModelFailure("timeout",true));
        Result result=service.execute(request(1,1000,item("a"),item("b"),item("c")));
        assertThat(result.unknownUsage()).isTrue();
        assertThat(result.status()).isEqualTo("ERROR");
        assertThat(result.calls()).hasSize(1);
        assertThat(result.totalTokens()).isEqualTo(200);
        assertThat(result.items().stream().map(ItemResult::verdict).toList()).containsExactly("FAIL","ERROR","STOPPED");
    }
    @Test void budgetStopsBetweenSharedCallsWithoutDiscardingSpentUsage() {
        when(gateway.generate(anyString(),any(),any())).thenReturn(
            generation("{\"answers\":[{\"id\":\"a\",\"answer\":\"ok\"}]}",1200,"call-1"));
        Result result=service.execute(request(1,1000,item("a"),item("b")));
        assertThat(result.status()).isEqualTo("BUDGET_EXCEEDED");
        assertThat(result.totalTokens()).isEqualTo(1200);
        assertThat(result.items().getLast().verdict()).isEqualTo("STOPPED");
        verify(gateway,times(1)).generate(anyString(),any(),any());
    }
    @Test void duplicateRequestIdsAreRejectedBeforeAnyCall() {
        assertThatThrownBy(()->service.execute(request(4,1000,item("a"),item("a")))).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(gateway);
    }
    @Test void demoExercisesSameJsonMappingWithoutModelCalls() {
        var cases=new BenchmarkCases();
        var demo=new BatchService(new ModelGateway(cases,"test","","node",10),new AnswerVerifier());
        var items=cases.all().subList(0,4).stream().map(c->new Item(c.id(),c.prompt(),Check.EXACT,c.expectedAnswer())).toList();
        Result result=demo.execute(new Request(Mode.DEMO,4,50000,items));
        assertThat(result.status()).isEqualTo("COMPLETED");
        assertThat(result.calls()).hasSize(1);
        assertThat(result.items()).allSatisfy(i->assertThat(i.verdict()).isEqualTo("PASS"));
        assertThat(result.model()).isEqualTo("scripted-demo");
    }
}
