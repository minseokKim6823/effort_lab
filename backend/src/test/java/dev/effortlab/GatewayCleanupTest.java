package dev.effortlab;
import static dev.effortlab.Domain.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.io.*;
import java.nio.file.*;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class GatewayCleanupTest {
    @TempDir Path temp;
    private ModelGateway gateway(Process process,boolean failBeforeStart) throws IOException {
        Path script=Files.createFile(temp.resolve("codex.js"));
        return new ModelGateway(new BenchmarkCases(),"test",script.toString(),"node",1) {
            @Override Process startProcess(List<String> args,Path trace) throws IOException {
                if(failBeforeStart) throw new IOException("launch failed");
                return process;
            }
        };
    }
    @Test void stdinFailureStopsParentAndDescendantsAndMarksUsageUnknown() throws Exception {
        Process process=mock(Process.class);
        ProcessHandle child=mock(ProcessHandle.class);
        when(process.isAlive()).thenReturn(true);
        when(process.descendants()).thenAnswer(invocation->Stream.of(child));
        when(process.getOutputStream()).thenReturn(new OutputStream() {
            @Override public void write(int b) throws IOException {throw new IOException("broken pipe");}
        });
        var gateway=gateway(process,false);
        assertThatThrownBy(()->gateway.generate("test",Effort.LOW,Mode.CODEX))
            .isInstanceOfSatisfying(ModelGateway.ModelFailure.class,e->assertThat(e.unknownUsage).isTrue());
        verify(child).destroyForcibly();
        verify(process).destroyForcibly();
    }
    @Test void timeoutAlsoStopsProcessTree() throws Exception {
        Process process=mock(Process.class);
        ProcessHandle child=mock(ProcessHandle.class);
        when(process.isAlive()).thenReturn(true);
        when(process.descendants()).thenAnswer(invocation->Stream.of(child));
        when(process.getOutputStream()).thenReturn(new ByteArrayOutputStream());
        when(process.waitFor(1,TimeUnit.SECONDS)).thenReturn(false);
        var gateway=gateway(process,false);
        assertThatThrownBy(()->gateway.generate("test",Effort.LOW,Mode.CODEX))
            .isInstanceOfSatisfying(ModelGateway.ModelFailure.class,e->assertThat(e.unknownUsage).isTrue());
        verify(child).destroyForcibly();
        verify(process).destroyForcibly();
    }
    @Test void launchFailureDoesNotClaimAnUnknownBillableCall() throws Exception {
        var gateway=gateway(null,true);
        assertThatThrownBy(()->gateway.generate("test",Effort.LOW,Mode.CODEX))
            .isInstanceOfSatisfying(ModelGateway.ModelFailure.class,e->assertThat(e.unknownUsage).isFalse());
    }
}
