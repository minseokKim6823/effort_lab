package dev.effortlab;
import static dev.effortlab.Domain.*;
import static dev.effortlab.BatchDomain.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.json.JsonMapper;

/** Bounded batch prompting: amortize the fixed input while keeping HIGH effort.
 * Expected answers are used only after generation and never affect packing or prompting.
 */
@Service
public class BatchService {
    public static final String VERSION="batch-high-v1";
    private static final int MAX_GROUP_CHARS=8000;
    private final ModelGateway gateway;
    private final AnswerVerifier verifier;
    private final JsonMapper json=JsonMapper.builder()
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build();
    public BatchService(ModelGateway gateway,AnswerVerifier verifier) {
        this.gateway=gateway;this.verifier=verifier;
    }
    public Result execute(Request request) {
        validate(request);
        List<List<Item>> groups=pack(request.items(),request.batchSize());
        Map<String,ItemResult> results=new LinkedHashMap<>();
        request.items().forEach(item->results.put(item.id(),new ItemResult(item.id(),"","STOPPED",null)));
        List<Call> calls=new ArrayList<>();
        Usage usage=Usage.zero();
        long latency=0;
        String status="COMPLETED",error=null;
        boolean unknown=false;
        for(List<Item> group:groups) {
            if(Thread.currentThread().isInterrupted()) {status="INTERRUPTED";break;}
            if(usage.totalTokens()>=request.tokenBudget()) {status="BUDGET_EXCEEDED";break;}
            String prompt=prompt(group);
            Generation generation;
            try {
                generation=request.mode()==Mode.DEMO ? demo(group) : gateway.generate(prompt,Effort.HIGH,request.mode());
            } catch(ModelGateway.ModelFailure failure) {
                unknown=failure.unknownUsage;error=failure.getMessage();status="ERROR";
                group.forEach(item->results.put(item.id(),new ItemResult(item.id(),"","ERROR",null)));
                break;
            }
            usage=usage.plus(generation.usage());latency+=generation.latencyMs();
            String parseError=null;
            Map<String,String> answers=Map.of();
            try {
                if(!"completed".equals(generation.providerStatus()))
                    throw new IllegalArgumentException("모델 호출이 정상 종료되지 않았거나 도구를 사용했습니다.");
                answers=parse(generation.output(),group);
            } catch(IllegalArgumentException failure) {parseError=failure.getMessage();}
            calls.add(new Call(group.stream().map(Item::id).toList(),prompt,generation,parseError));
            for(Item item:group) {
                String answer=answers.getOrDefault(item.id(),"");
                results.put(item.id(),new ItemResult(item.id(),answer,parseError==null
                    ? verifier.verify(answer,item.check(),item.expectedAnswer()) : "ERROR",generation.responseId()));
            }
            if(parseError!=null) {status="ERROR";error=parseError;break;}
        }
        return new Result(UUID.randomUUID().toString(),Instant.now().toString(),request.mode(),
            request.mode()==Mode.DEMO?"scripted-demo":gateway.model(),VERSION,status,request.batchSize(),
            groups.size(),List.copyOf(results.values()),List.copyOf(calls),usage,usage.totalTokens(),latency,unknown,error);
    }
    private void validate(Request request) {
        if(request==null || request.mode()==null || request.batchSize()<1 || request.batchSize()>4
            || request.tokenBudget()<1000 || request.tokenBudget()>2000000 || request.items()==null
            || request.items().isEmpty() || request.items().size()>24)
            throw new IllegalArgumentException("작업 1~24개, 묶음 크기 1~4, 토큰 기준 1,000~2,000,000을 지정하세요.");
        Set<String> ids=new HashSet<>();
        for(Item item:request.items()) {
            if(item==null || item.id()==null || !item.id().matches("[A-Za-z0-9_-]{1,64}") || !ids.add(item.id())
                || item.task()==null || item.task().isBlank() || item.task().length()>4000
                || (item.expectedAnswer()!=null && item.expectedAnswer().length()>4000))
                throw new IllegalArgumentException("작업 ID는 중복 없는 영문·숫자·하이픈·밑줄이며, 작업은 1~4,000자여야 합니다.");
            if((item.check()==Check.EXACT || item.check()==Check.CONTAINS)
                && (item.expectedAnswer()==null || item.expectedAnswer().isBlank()))
                throw new IllegalArgumentException("정답 또는 필수 문자열을 입력하세요.");
        }
    }
    List<List<Item>> pack(List<Item> items,int size) {
        List<List<Item>> groups=new ArrayList<>();
        List<Item> group=new ArrayList<>();int chars=0;
        for(Item item:items) {
            if(!group.isEmpty() && (group.size()==size || chars+item.task().length()>MAX_GROUP_CHARS)) {
                groups.add(List.copyOf(group));group.clear();chars=0;
            }
            group.add(item);chars+=item.task().length();
        }
        if(!group.isEmpty()) groups.add(List.copyOf(group));
        return List.copyOf(groups);
    }
    String prompt(List<Item> items) {
        // Explicit projection prevents verifier labels from leaking through serialization.
        var tasks=items.stream().map(i->Map.of("id",i.id(),"task",i.task())).toList();
        return "Solve each independent task below using only its own text. Keep tasks separate. "
            +"Each task's output instruction applies to its answer string, not the outer JSON. "
            +"Return exactly one JSON object with an answers array, one entry per ID, no extra IDs or markdown. "
            +"Schema: {\"answers\":[{\"id\":\"task_id\",\"answer\":\"answer text\"}]}. "
            +"Do not use tools. Tasks:\n"+json.writeValueAsString(tasks);
    }
    Map<String,String> parse(String output,List<Item> items) {
        try {
            var root=json.readTree(output);
            if(root==null || !root.isObject() || root.size()!=1 || !root.path("answers").isArray())
                throw new IllegalArgumentException();
            Set<String> expected=new HashSet<>(items.stream().map(Item::id).toList());
            Map<String,String> answers=new LinkedHashMap<>();
            for(var row:root.path("answers")) {
                if(!row.isObject() || row.size()!=2 || !row.path("id").isString() || !row.path("answer").isString())
                    throw new IllegalArgumentException();
                String id=row.path("id").asText();
                if(!expected.contains(id) || answers.putIfAbsent(id,row.path("answer").asText())!=null)
                    throw new IllegalArgumentException();
            }
            if(!answers.keySet().equals(expected)) throw new IllegalArgumentException();
            return answers;
        } catch(Exception e) {
            throw new IllegalArgumentException("묶음 응답의 JSON 형식 또는 작업 ID가 올바르지 않습니다. 호출 비용은 합산했으며 자동 재호출하지 않습니다.");
        }
    }
    private Generation demo(List<Item> items) {
        List<Map<String,String>> answers=new ArrayList<>();
        long input=700,output=24,elapsed=0;
        for(Item item:items) {
            Generation result=gateway.generate(item.task(),Effort.HIGH,Mode.DEMO);
            answers.add(Map.of("id",item.id(),"answer",result.output()));
            input+=Math.max(1,item.task().length()/3);output+=Math.max(1,result.output().length()/3)+40;
            elapsed+=result.latencyMs();
        }
        return new Generation(json.writeValueAsString(Map.of("answers",answers)),new Usage(input,output,0,0),
            elapsed,"demo-batch-"+UUID.randomUUID(),"completed");
    }
}
