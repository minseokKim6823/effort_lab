package dev.effortlab;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import static dev.effortlab.Domain.*;
@Component
public class EffortRouter {
    public static final String VERSION = "rules-1.1";
    private static final Pattern HARD = Pattern.compile("제약 충족|경우의 수|knapsack|constraint satisfaction|증명|동시성|교착|분산|보안|취약|트랜잭션|최적화|불변식|proof|prove|concurren|deadlock|distributed|security|transaction|invariant", Pattern.CASE_INSENSITIVE);
    private static final Pattern MEDIUM = Pattern.compile("알고리즘|조건|계산|구현|분석|재귀|복잡도|sql|algorithm|implement|calculate|recursive|analy[sz]", Pattern.CASE_INSENSITIVE);
    private static final Pattern SIMPLE = Pattern.compile("대문자|소문자|추출|번역|정렬|합계|요약|변환|분류|uppercase|lowercase|extract|translate|sort|summari[sz]e|convert|classify", Pattern.CASE_INSENSITIVE);
    public Decision route(String task, Risk risk) {
        long start = System.nanoTime();
        List<String> reasons = new ArrayList<>();
        int score = 0;
        if (risk == Risk.HIGH) { score += 80; reasons.add("사용자가 높은 정확도가 필요한 작업으로 지정했습니다."); }
        if (HARD.matcher(task).find()) { score += 70; reasons.add("증명·보안·동시성 등 복잡한 추론 신호가 있습니다."); }
        if (MEDIUM.matcher(task).find()) { score += 30; reasons.add("계산·구현 또는 여러 조건을 다루는 작업입니다."); }
        int length = task.codePointCount(0, task.length());
        if (length > 6000) { score += 70; reasons.add("입력이 6,000자를 넘어 문맥 누락 가능성을 반영합니다."); }
        else if (length > 1200) { score += 30; reasons.add("입력이 1,200자를 넘어 medium 이상으로 시작합니다."); }
        boolean simple = SIMPLE.matcher(task).find();
        Effort effort = score >= 70 ? Effort.HIGH : score >= 30 ? Effort.MEDIUM : simple ? Effort.LOW : Effort.MEDIUM;
        if (reasons.isEmpty()) reasons.add(simple ? "짧고 명확한 변환·추출 작업 신호가 있습니다." : "단순 작업이라는 근거가 부족해 medium으로 시작합니다.");
        return new Decision(effort, Math.min(score,100), List.copyOf(reasons), VERSION, (System.nanoTime()-start)/1000, 0);
    }
}
