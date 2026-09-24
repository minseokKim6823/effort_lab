package dev.effortlab;
import java.io.IOException;
import java.net.URI;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
// This is a local single-user app. Cross-origin browser requests must not spend the user's plan.
@Component
public class OriginGuard extends OncePerRequestFilter {
    @org.springframework.beans.factory.annotation.Value("${EFFORTLAB_SESSION_TOKEN:}")
    private String sessionToken;
    @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain)
        throws ServletException,IOException {
        if(sessionToken!=null && !sessionToken.isBlank() && !sessionToken.equals(req.getHeader("X-Effort-Lab-Token"))) {res.sendError(403);return;}
        res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
        res.setHeader("X-Content-Type-Options","nosniff");
        String origin=req.getHeader("Origin");
        if(origin!=null) {
            boolean allowed=false;
            try {
                URI uri=URI.create(origin);
                String host=uri.getHost();
                allowed=("127.0.0.1".equals(host)||"localhost".equals(host))
                    && (SetHolder.PORTS.contains(uri.getPort()) || uri.getPort()==req.getServerPort()) && "http".equals(uri.getScheme());
            } catch(Exception ignored) {}
            if(!allowed) {res.sendError(403);return;}
        }
        chain.doFilter(req,res);
    }
    private static class SetHolder {static final java.util.Set<Integer> PORTS=java.util.Set.of(5173,4173,8087);}
}
