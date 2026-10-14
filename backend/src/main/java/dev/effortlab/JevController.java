package dev.effortlab;

import static dev.effortlab.Domain.*;
import java.util.Map;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/jev")
public class JevController {
    private final JevService service;
    public JevController(JevService service) {this.service=service;}
    @GetMapping("/status") public JevService.Status status() {return service.status();}
    @PostMapping("/route") public JevService.RouteResult route(@Valid @RequestBody RouteRequest request) {
        return service.route(request);
    }
    @PostMapping("/execute") public JevService.Result execute(@Valid @RequestBody ExecuteRequest request) {
        return service.single(request);
    }
    @ExceptionHandler({IllegalArgumentException.class,MethodArgumentNotValidException.class,HttpMessageNotReadableException.class})
    public ResponseEntity<Map<String,String>> bad(Exception error) {
        String message=error instanceof IllegalArgumentException ? error.getMessage() : "입력 형식과 길이, 숫자 범위를 확인하세요.";
        return ResponseEntity.badRequest().body(Map.of("message",message));
    }
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String,String>> conflict(IllegalStateException error) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message",error.getMessage()));
    }
}
