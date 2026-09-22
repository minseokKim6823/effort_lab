package dev.effortlab;
import static dev.effortlab.Domain.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import jakarta.annotation.*;
import org.springframework.stereotype.Service;

@Service
public class BenchmarkService {
    private final BenchmarkCases cases;
    private final EvaluationService evaluator;
    private final ModelGateway gateway;
    private final ExperimentStore store;
    private final AtomicBoolean busy=new AtomicBoolean();
    private final ExecutorService worker=Executors.newSingleThreadExecutor(Thread.ofVirtual().name("benchmark").factory());
    private volatile Job active;
    public BenchmarkService(BenchmarkCases cases,EvaluationService evaluator,ModelGateway gateway,ExperimentStore store) {
        this.cases=cases;this.evaluator=evaluator;this.gateway=gateway;this.store=store;
    }
    @PostConstruct void recover() {store.recoverInterrupted();}
    @PreDestroy void close() {worker.shutdownNow();}
    public boolean isBusy() {return busy.get();}
    public Execution single(ExecuteRequest request) {
        checkProvider(request.mode());
        if(!busy.compareAndSet(false,true)) throw new IllegalStateException("다른 작업이 실행 중입니다.");
        try {
            return evaluator.execute(request.task(),request.risk(),request.check(),request.expectedAnswer(),
                request.mode(),Strategy.ADAPTIVE,()->true,n->{});
        } finally {busy.set(false);}
    }
    public Report start(BenchmarkRequest request) {
        checkProvider(request.mode());
        if(!busy.compareAndSet(false,true)) throw new IllegalStateException("다른 작업이 실행 중입니다.");
        Job job=new Job(request,gateway.model());
        try {
            active=job;store.save(snapshot(job));
            worker.submit(()->run(job));
            return snapshot(job);
        } catch(RuntimeException e) {busy.set(false);throw e;}
    }
    private void checkProvider(Mode mode) {
        if(mode==Mode.CODEX && !gateway.available()) throw new IllegalStateException("Codex CLI를 설치하고 codex login으로 로그인하세요.");
    }
    private void run(Job job) {
        try {
            List<Case> selected=cases.all(job.request.suite()).subList(0,job.request.caseCount());
            outer: for(int repeat=0;repeat<job.request.repeats();repeat++) {
                for(int index=0;index<selected.size();index++) {
                    Case c=selected.get(index);
                    List<Strategy> order=new ArrayList<>(List.of(Strategy.values()));
                    Collections.rotate(order,(index+repeat)%order.size());
                    for(Strategy strategy:order) {
                        if(!canContinue(job)) break outer;
                        Execution result=evaluator.execute(c.prompt(),Risk.NORMAL,Check.EXACT,c.expectedAnswer(),
                            job.request.mode(),strategy,()->canContinue(job),job.spent::addAndGet);
                        job.trials.add(new Trial(c.id(),c.title(),c.category(),repeat+1,result));
                        store.save(snapshot(job));
                        if(result.error()!=null) {job.error=result.error();job.status="ERROR";break outer;}
                    }
                }
            }
            if(job.status.equals("RUNNING")) job.status=job.cancelled ? "CANCELLED"
                : job.trials.size()==job.planned ? "COMPLETED" : "BUDGET_EXCEEDED";
        } catch(Exception e) {job.status="ERROR";job.error="실험 실행에 실패했습니다. 서버 로그 및 Codex 로그인을 확인하세요.";}
        finally {
            try {store.save(snapshot(job));} finally {busy.set(false);}
        }
    }
    private boolean canContinue(Job job) {
        return !job.cancelled && !Thread.currentThread().isInterrupted() && job.spent.get()<job.request.tokenBudget();
    }
    public Report get(String id) {
        Job job=active;return job!=null && job.id.equals(id) ? snapshot(job) : store.get(id);
    }
    public List<Report> recent() {return store.recent();}
    public Report cancel(String id) {
        Job job=active;
        if(job==null || !job.id.equals(id)) throw new NoSuchElementException("실행 중인 실험이 없습니다.");
        job.cancelled=true;
        return snapshot(job);
    }
    private Report snapshot(Job job) {
        List<Trial> trials=List.copyOf(job.trials);
        Map<Strategy,Arm> arms=new EnumMap<>(Strategy.class);
        for(Strategy strategy:Strategy.values()) {
            var rows=trials.stream().filter(t->t.execution().strategy()==strategy).toList();
            Usage usage=Usage.zero();int passed=0,retries=0;long elapsed=0;
            for(Trial t:rows) {
                Execution x=t.execution();usage=usage.plus(x.usage());elapsed+=x.latencyMs();
                retries+=Math.max(0,x.attempts().size()-1);
                if(x.verdict().equals("PASS")) passed++;
            }
            arms.put(strategy,new Arm(rows.size(),passed,retries,usage,usage.totalTokens(),
                rows.isEmpty()?0:100.0*passed/rows.size(),rows.isEmpty()?0:1.0*elapsed/rows.size(),
                passed==0?null:1.0*usage.totalTokens()/passed));
        }
        boolean unknown=trials.stream().anyMatch(t->t.execution().unknownUsage());
        boolean comparable=job.status.equals("COMPLETED") && trials.size()==job.planned && !unknown;
        long base=arms.get(Strategy.HIGH).totalTokens();
        Double saving=comparable && base>0 ? 100.0*(base-arms.get(Strategy.ADAPTIVE).totalTokens())/base : null;
        long original=arms.get(Strategy.DEFAULT_HIGH).totalTokens();
        Double overall=comparable && original>0 ? 100.0*(original-arms.get(Strategy.ADAPTIVE).totalTokens())/original : null;
        String note=job.request.mode()==Mode.DEMO
            ? "시뮬레이션입니다. 토큰·정답은 고정 규칙으로 생성되어 실제 모델 절감률의 증거가 아닙니다."
            : "Codex 구독 실제 usage. 기본 문맥 high와 답변 전용 문맥 high/low/자동을 비교합니다. 문맥 축소와 effort 효과를 구분하세요. 캐시·재시도 포함이며 요금·구독 한도 절감률은 아닙니다.";
        return new Report(job.id,job.created,job.status,job.request.mode(),job.model,
            EffortRouter.VERSION,cases.version(job.request.suite()),job.request,job.planned,trials,arms,saving,
            comparable,note,job.error,unknown,overall,"answer-only-v1");
    }
    private static class Job {
        final String id=UUID.randomUUID().toString(),created=Instant.now().toString(),model;
        final BenchmarkRequest request;final int planned;
        final List<Trial> trials=new CopyOnWriteArrayList<>();
        final AtomicLong spent=new AtomicLong();
        volatile String status="RUNNING",error=null;volatile boolean cancelled=false;
        Job(BenchmarkRequest request,String model) {
            this.request=request;this.model=request.mode()==Mode.DEMO?"scripted-demo":model;
            this.planned=request.caseCount()*request.repeats()*Strategy.values().length;
        }
    }
}
