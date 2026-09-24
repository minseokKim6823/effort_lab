package dev.effortlab;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import static org.assertj.core.api.Assertions.*;
class OriginGuardTest {
    @Test void nullOriginIsRejected() throws Exception {check("null",8087,403);}
    @Test void foreignOriginIsRejected() throws Exception {check("https://evil.example",8087,403);}
    @Test void dynamicSameOriginWorks() throws Exception {check("http://127.0.0.1:54321",54321,200);}
    @Test void devOriginWorks() throws Exception {check("http://localhost:5173",8087,200);}
    private void check(String origin,int port,int expected) throws Exception {
        var req=new MockHttpServletRequest();req.setServerPort(port);req.addHeader("Origin",origin);
        var res=new MockHttpServletResponse();
        new OriginGuard().doFilter(req,res,new MockFilterChain());
        assertThat(res.getStatus()).isEqualTo(expected);
    }
}
