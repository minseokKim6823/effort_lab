package dev.effortlab;
import static dev.effortlab.Domain.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Component
public class ModelGateway {
    private final BenchmarkCases cases;
    private final JsonMapper json = JsonMapper.builder().build();
    private final String model, node;
    private final Path script;
    private final int timeout;
    public ModelGateway(BenchmarkCases cases,
        @Value("${effortlab.codex-model}") String model,
        @Value("${effortlab.codex-js}") String script,
        @Value("${effortlab.node}") String node,
        @Value("${effortlab.timeout-seconds}") int timeout) {
        this.cases=cases; this.model=model; this.node=node; this.timeout=timeout;
        this.script=script.isBlank() ? Path.of(System.getProperty("user.home"),
            "AppData","Roaming","npm","node_modules","@openai","codex","bin","codex.js") : Path.of(script);
    }
    public String model() { return model; }
    public boolean available() { return Files.isRegularFile(script); }

    public Generation generate(String task, Effort effort, Mode mode) { return generate(task,effort,mode,true); }
    public Generation generateDefault(String task, Effort effort, Mode mode) { return generate(task,effort,mode,false); }
    private Generation generate(String task, Effort effort, Mode mode, boolean compact) {
        if (mode == Mode.DEMO) return demo(task,effort);
        if (!available()) throw new IllegalStateException("Codex CLI 경로를 찾지 못했습니다. CODEX_JS_PATH를 설정하세요.");
        long start=System.nanoTime();
        String id=UUID.randomUUID().toString();
        Path work=Path.of("data","runner").toAbsolutePath();
        Path trace=Path.of("data","cli-traces",id+".jsonl");
        Process process=null;
        try {
            Files.createDirectories(work); Files.createDirectories(trace.getParent());
            Path instructions=work.resolve("answer-instructions.txt");
            if(compact) try(var source=ModelGateway.class.getResourceAsStream("/answer-instructions.txt")) {
                if(source==null) throw new IOException("Missing answer instructions");
                Files.copy(source,instructions,StandardCopyOption.REPLACE_EXISTING);
            }
            List<String> args=new ArrayList<>(List.of(node,script.toString(),"exec",
                "--ignore-user-config","--ephemeral","--skip-git-repo-check","--json",
                "-s","read-only","-C",work.toString(),"-m",model,
                "-c","model_reasoning_effort="+effort.name().toLowerCase(Locale.ROOT),
                "-c","approval_policy=never","-c","web_search=disabled",
                "--disable","shell_tool","--disable","apps","--disable","multi_agent","-"));
            if(compact) args.addAll(args.size()-1,List.of("-c","model_instructions_file="+json.writeValueAsString(instructions.toString()),"-c","project_doc_max_bytes=0"));
            process=new ProcessBuilder(args).redirectError(ProcessBuilder.Redirect.DISCARD)
                .redirectOutput(trace.toFile()).start();
            try (var stdin=process.getOutputStream()) {
                stdin.write((task+"\n\n문제의 답만 출력하세요. 도구를 사용하지 마세요.").getBytes(StandardCharsets.UTF_8));
            }
            if (!process.waitFor(timeout,TimeUnit.SECONDS)) {
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
                throw new ModelFailure("Codex 응답 시간 초과. 마지막 호출의 사용량은 확인할 수 없습니다.",true);
            }
            return parse(Files.readString(trace,StandardCharsets.UTF_8),
                Duration.ofNanos(System.nanoTime()-start).toMillis(),id,process.exitValue());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if(process!=null) { process.descendants().forEach(ProcessHandle::destroyForcibly); process.destroyForcibly(); }
            throw new ModelFailure("실행이 중단되어 마지막 호출의 사용량을 확인할 수 없습니다.",true);
        } catch (IOException e) {
            System.getLogger(ModelGateway.class.getName()).log(System.Logger.Level.WARNING,"CLI I/O failure",e);
            throw new ModelFailure("Codex 실행 또는 측정 기록 저장에 실패했습니다. CLI 경로와 로그인 상태를 확인하세요.",process!=null);
        }
    }
    public Generation parse(String jsonl,long elapsed,String id,int exitCode) {
        String output=""; Usage usage=Usage.zero(); boolean seenUsage=false,failed=exitCode!=0,toolUsed=false;
        for(String line:jsonl.lines().toList()) {
            if(!line.stripLeading().startsWith("{")) continue;
            JsonNode event;
            try { event=json.readTree(line); } catch(Exception e) { continue; }
            String type=event.path("type").asText("");
            if(type.equals("turn.completed")) {
                JsonNode u=event.path("usage");
                if(!u.has("input_tokens") || !u.has("output_tokens"))
                    throw new ModelFailure("Codex가 사용량 필드를 반환하지 않았습니다.",true);
                usage=usage.plus(new Usage(u.path("input_tokens").asLong(),u.path("output_tokens").asLong(),
                    u.path("reasoning_output_tokens").asLong(),u.path("cached_input_tokens").asLong()));
                seenUsage=true;
            }
            if(type.equals("turn.failed") || type.equals("error")) failed=true;
            if(type.equals("item.completed")) {
                JsonNode item=event.path("item");
                String kind=item.path("type").asText("");
                if(kind.equals("agent_message")) output=item.path("text").asText("");
                else if(!kind.equals("reasoning") && !kind.isEmpty()) toolUsed=true;
            }
        }
        if(!seenUsage) throw new ModelFailure("Codex 사용량을 수신하지 못했습니다. codex login status와 로컬 CLI 실행을 확인하세요.",true);
        return new Generation(output,usage,elapsed,id,failed ? "failed" : toolUsed ? "tool_used" : "completed");
    }
    private Generation demo(String task,Effort effort) {
        Case c=cases.forPrompt(task);
        boolean pass=c!=null && effort.ordinal()>=c.demoMinimum().ordinal();
        // This deliberately scripted provider demonstrates accounting, not model performance.
        String output=c==null ? "데모는 예제 작업만 실행합니다. 실제 작업은 Codex 구독 모드로 실행하세요."
            : pass ? c.expectedAnswer() : "DEMO_INCORRECT";
        int reasoning=switch(effort) {case LOW->24;case MEDIUM->180;case HIGH->700;};
        long input=Math.max(1,task.codePointCount(0,task.length())/2+30);
        return new Generation(output,new Usage(input,reasoning+12,reasoning,0),0,
            "demo-"+UUID.randomUUID(),"completed");
    }
    public static class ModelFailure extends RuntimeException {
        public final boolean unknownUsage;
        public ModelFailure(String message,boolean unknownUsage) {super(message);this.unknownUsage=unknownUsage;}
    }
}
