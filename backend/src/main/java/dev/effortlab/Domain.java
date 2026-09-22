package dev.effortlab;
import java.util.List;
import java.util.Map;
import jakarta.validation.constraints.*;
public final class Domain {
    private Domain() {}
    public enum Effort { LOW, MEDIUM, HIGH;
        public Effort next() { return this == LOW ? MEDIUM : HIGH; }
    }
    public enum Mode { DEMO, CODEX }
    public enum Risk { NORMAL, HIGH }
    public enum Check { EXACT, CONTAINS, JSON, NONE }
    public enum Strategy { DEFAULT_HIGH, HIGH, LOW, ADAPTIVE }
    public record RouteRequest(@NotBlank @Size(max=20000) String task, @NotNull Risk risk) {}
    public record ExecuteRequest(@NotBlank @Size(max=20000) String task, @NotNull Risk risk,
        @NotNull Mode mode, @NotNull Check check, @Size(max=4000) String expectedAnswer) {}
    public record BenchmarkRequest(@NotNull Mode mode, @Min(1) @Max(3) int repeats,
        @Min(1) @Max(12) int caseCount, @Min(1000) @Max(2000000) long tokenBudget, String suite) {
        public BenchmarkRequest(Mode mode,int repeats,int caseCount,long tokenBudget) { this(mode,repeats,caseCount,tokenBudget,"starter"); }
        public BenchmarkRequest { if(suite==null) suite="starter"; if(!List.of("starter","challenge").contains(suite)) throw new IllegalArgumentException("알 수 없는 문제 세트입니다."); }
    }
    public record Decision(Effort effort, int score, List<String> reasons, String policyVersion,
        long routingMicros, int routingTokens) {}
    public record Usage(long inputTokens, long outputTokens, long reasoningTokens, long cachedInputTokens) {
        public static Usage zero() { return new Usage(0,0,0,0); }
        public long totalTokens() { return inputTokens + outputTokens; }
        public Usage plus(Usage o) { return new Usage(inputTokens+o.inputTokens, outputTokens+o.outputTokens,
            reasoningTokens+o.reasoningTokens, cachedInputTokens+o.cachedInputTokens); }
    }
    public record Case(String id, String title, String category, String prompt,
        String expectedAnswer, Effort demoMinimum) {}
    public record Generation(String output, Usage usage, long latencyMs, String responseId, String providerStatus) {}
    public record Attempt(Effort effort, String output, Usage usage, long latencyMs,
        String responseId, String providerStatus, String verdict) {}
    public record Execution(Strategy strategy, Decision decision, List<Attempt> attempts, Usage usage,
        long totalTokens, long latencyMs, String verdict, String error, boolean unknownUsage) {}
    public record Trial(String caseId, String title, String category, int repetition, Execution execution) {}
    public record Arm(int trials, int passed, int retries, Usage usage, long totalTokens,
        double passRate, double meanLatencyMs, Double tokensPerSuccess) {}
    public record Report(String id, String createdAt, String status, Mode mode, String model,
        String policyVersion, String datasetVersion, BenchmarkRequest request, int plannedTrials,
        List<Trial> trials, Map<Strategy,Arm> arms, Double savingsPercent, boolean comparable,
        String note, String error, boolean unknownUsage, Double overallSavingsPercent, String contextPolicy) {}
}
