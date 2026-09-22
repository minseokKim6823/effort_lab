package dev.effortlab;
import static dev.effortlab.Domain.*;
import java.text.Normalizer;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;
@Component
public class AnswerVerifier {
    private final JsonMapper json=JsonMapper.builder().enable(tools.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    public String verify(String output,Check check,String expected) {
        if(check==Check.NONE) return "UNVERIFIED";
        if(output==null || output.isBlank()) return "FAIL";
        if(check==Check.JSON) {
            try {
                var value=json.readTree(output);
                return value!=null && (value.isObject() || value.isArray()) ? "PASS" : "FAIL";
            } catch(Exception e) { return "FAIL"; }
        }
        if(expected==null || expected.isBlank()) throw new IllegalArgumentException("정답 또는 필수 문자열을 입력하세요.");
        String actual=normalize(output),target=normalize(expected);
        return (check==Check.EXACT ? actual.equals(target) : actual.contains(target)) ? "PASS" : "FAIL";
    }
    private String normalize(String value) {
        return Normalizer.normalize(value.strip(),Normalizer.Form.NFC).replace("\r\n","\n");
    }
}
