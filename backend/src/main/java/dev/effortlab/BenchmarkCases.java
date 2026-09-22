package dev.effortlab;
import java.util.List;
import java.io.IOException;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.stereotype.Component;
import static dev.effortlab.Domain.*;
@Component
public class BenchmarkCases {
    public static final String VERSION = "starter-12-v1";
    private final List<Case> cases = List.of(
        new Case("text-1", "문자 변환", "텍스트", "다음 문자열을 대문자로 변환하세요: 'effort lab'. 결과 문자열만 출력하세요.", "EFFORT LAB", Effort.LOW),
        new Case("logic-1", "조건 계산", "계산", "조건을 모두 적용해 계산하세요: 12개 물건이 개당 1500원이고 전체 금액에서 10% 할인합니다. 최종 금액을 숫자로만 출력하세요.", "16200", Effort.MEDIUM),
        new Case("hard-1", "동시성 순서", "추론", "동시성 분석: 공유 정수 x=0. 스레드 A와 B가 각각 x를 읽고 1을 더해 쓰는 비원자적 연산을 한 번씩 수행합니다. 모든 가능한 종료 값들을 오름차순 쉼표로 구분해 출력하세요. 다른 문자는 쓰지 마세요.", "1,2", Effort.HIGH),
        new Case("text-2", "이메일 추출", "텍스트", "아래 텍스트에서 이메일 주소를 추출하세요. 주소만 출력: 문의 담당자는 Mina이고 연락처는 mina@example.com 입니다.", "mina@example.com", Effort.LOW),
        new Case("logic-2", "경로 계산", "계산", "알고리즘 문제: 정점 A,B,C,D가 있고 방향 간선 A→B=3,A→C=8,B→C=2,B→D=9,C→D=1 입니다. A에서 D까지 최단 거리만 숫자로 출력하세요.", "6", Effort.MEDIUM),
        new Case("hard-2", "교착 상태", "추론", "교착 상태 분석: T1은 L1을 보유하고 L2를 기다립니다. T2는 L2를 보유하고 L1을 기다립니다. 잠금을 선점할 수 없고 타임아웃도 없습니다. 교착 상태이면 YES, 아니면 NO만 출력하세요.", "YES", Effort.HIGH),
        new Case("text-3", "숫자 정렬", "텍스트", "다음 정수를 오름차순 정렬하세요: 9,2,5,1. 공백 없이 쉼표로 구분된 숫자만 출력하세요.", "1,2,5,9", Effort.LOW),
        new Case("logic-3", "조건별 집계", "계산", "SQL의 집계 결과를 계산하세요. orders의 (status,amount) 행은 (paid,100),(paid,250),(cancelled,900),(paid,50)입니다. SELECT SUM(amount) FROM orders WHERE status='paid'; 결과 숫자만 출력하세요.", "400", Effort.MEDIUM),
        new Case("hard-3", "불변식 검토", "추론", "불변식 증명 문제: 처음 x=0. 가능한 연산은 x에 6을 더하거나 10을 빼는 것뿐입니다. 유한 번의 연산으로 x=7에 도달 가능하면 YES, 불가능하면 NO만 출력하세요.", "NO", Effort.HIGH),
        new Case("text-4", "간단 분류", "텍스트", "문장 감정을 positive 또는 negative로 분류하세요: 'I love this beautiful day.' 레이블만 출력하세요.", "positive", Effort.LOW),
        new Case("logic-4", "재귀 결과", "계산", "재귀 함수 F(0)=0,F(1)=1,F(n)=F(n-1)+F(n-2) 입니다. F(10)을 계산하고 숫자만 출력하세요.", "55", Effort.MEDIUM),
        new Case("hard-4", "분산 정족수", "추론", "분산 시스템의 정족수 조건 R+W>N 및 2W>N을 모두 만족해야 합니다. N=5,W=3일 때 가능한 최소 양의 정수 R을 숫자로만 출력하세요.", "3", Effort.HIGH)
    );
    public List<Case> all() { return cases; }
    public List<Case> all(String suite) {
        if(!"challenge".equals(suite)) return cases;
        try(var input=getClass().getResourceAsStream("/challenge-cases.json")) {
            if(input==null) throw new IllegalStateException("Challenge dataset missing");
            return List.of(JsonMapper.builder().build().readValue(input,Case[].class));
        } catch(IOException e) { throw new IllegalStateException("Challenge dataset unreadable",e); }
    }
    public String version(String suite) {return "challenge".equals(suite)?"challenge-12-seed20260923-v1":VERSION;}
    public Case forPrompt(String prompt) { return java.util.stream.Stream.concat(cases.stream(),all("challenge").stream()).filter(c -> c.prompt().equals(prompt)).findFirst().orElse(null); }
}
