package dev.effortlab;
import java.util.List;
import java.util.NoSuchElementException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;
import static dev.effortlab.Domain.*;
@Repository
public class ExperimentStore {
    private final JdbcTemplate jdbc;
    private final JsonMapper json=JsonMapper.builder().build();
    public ExperimentStore(JdbcTemplate jdbc) {this.jdbc=jdbc;}
    public void save(Report report) {
        jdbc.update("MERGE INTO experiments (id,created_at,report) KEY(id) VALUES (?,?,?)",
            report.id(),report.createdAt(),json.writeValueAsString(report));
    }
    public Report get(String id) {
        return jdbc.query("SELECT report FROM experiments WHERE id=?", (rs,n)->json.readValue(rs.getString(1),Report.class),id)
            .stream().findFirst().orElseThrow(()->new NoSuchElementException("실험을 찾을 수 없습니다."));
    }
    public List<Report> recent() {
        return jdbc.query("SELECT report FROM experiments ORDER BY created_at DESC LIMIT 30",
            (rs,n)->json.readValue(rs.getString(1),Report.class));
    }
    public void recoverInterrupted() {
        for(Report r:recent()) if(r.status().equals("RUNNING")) save(new Report(r.id(),r.createdAt(),"INTERRUPTED",
            r.mode(),r.model(),r.policyVersion(),r.datasetVersion(),r.request(),r.plannedTrials(),r.trials(),
            r.arms(),null,false,r.note(),"서버가 중단되었습니다. 마지막 호출의 사용량이 누락되었을 수 있습니다.",true,null,r.contextPolicy()));
    }
}
