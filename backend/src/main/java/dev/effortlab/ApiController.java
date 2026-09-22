package dev.effortlab;
import static dev.effortlab.Domain.*;
import java.util.*;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.http.converter.HttpMessageNotReadableException;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final EffortRouter router;
    private final BenchmarkCases cases;
    private final BenchmarkService benchmarks;
    private final ModelGateway gateway;
    public ApiController(EffortRouter router,BenchmarkCases cases,BenchmarkService benchmarks,ModelGateway gateway) {
        this.router=router;this.cases=cases;this.benchmarks=benchmarks;this.gateway=gateway;
    }
    @GetMapping("/status") public Map<String,Object> status() {
        return Map.of("codexAvailable",gateway.available(),"model",gateway.model(),
            "busy",benchmarks.isBusy(),"policyVersion",EffortRouter.VERSION,"datasetVersion",BenchmarkCases.VERSION);
    }
    @PostMapping("/route") public Decision route(@Valid @RequestBody RouteRequest request) {
        return router.route(request.task(),request.risk());
    }
    @PostMapping("/execute") public Execution execute(@Valid @RequestBody ExecuteRequest request) {
        return benchmarks.single(request);
    }
    @GetMapping("/cases") public List<Case> cases(@RequestParam(defaultValue="starter") String suite) {
        if(!List.of("starter","challenge").contains(suite)) throw new IllegalArgumentException("알 수 없는 문제 세트입니다.");
        return cases.all(suite);
    }
    @GetMapping("/benchmarks") public List<Report> recent() {return benchmarks.recent();}
    @PostMapping("/benchmarks") public Report start(@Valid @RequestBody BenchmarkRequest request) {return benchmarks.start(request);}
    @GetMapping("/benchmarks/{id}") public Report get(@PathVariable String id) {return benchmarks.get(id);}
    @PostMapping("/benchmarks/{id}/cancel") public Report cancel(@PathVariable String id) {return benchmarks.cancel(id);}
    @ExceptionHandler({IllegalArgumentException.class,MethodArgumentNotValidException.class,HttpMessageNotReadableException.class})
    public ResponseEntity<Map<String,String>> bad(Exception e) {
        String message=e instanceof IllegalArgumentException ? e.getMessage() : "입력 형식과 길이, 숫자 범위를 확인하세요.";
        return ResponseEntity.badRequest().body(Map.of("message",message));
    }
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String,String>> conflict(IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message",e.getMessage()));
    }
    @ExceptionHandler(NoSuchElementException.class)
    public ResponseEntity<Map<String,String>> missing(NoSuchElementException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("message",e.getMessage()));
    }
}
