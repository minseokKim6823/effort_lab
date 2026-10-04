package dev.effortlab;
import static dev.effortlab.Domain.*;
import java.util.List;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

public final class BatchDomain {
    private BatchDomain() {}
    public record Item(@NotBlank @Pattern(regexp="[A-Za-z0-9_-]{1,64}") String id,
        @NotBlank @Size(max=4000) String task, @NotNull Check check, @Size(max=4000) String expectedAnswer) {
        public Item {if(check==null) check=Check.NONE;}
    }
    public record Request(@NotNull Mode mode, @Min(1) @Max(4) int batchSize,
        @Min(1000) @Max(2000000) long tokenBudget, @NotEmpty @Size(max=24) List<@Valid Item> items) {}
    public record ItemResult(String id,String output,String verdict,String callId) {}
    public record Call(List<String> taskIds,String prompt,Generation generation,String parseError) {}
    public record Result(String id,String createdAt,Mode mode,String model,String policyVersion,
        String status,int batchSize,int plannedCalls,List<ItemResult> items,List<Call> calls,
        Usage usage,long totalTokens,long latencyMs,boolean unknownUsage,String error) {}
}
