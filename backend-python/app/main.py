from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.models import DashboardView, ProbeRegistration, ProbeReport, SampleView, TargetSuggestion
from app.storage import init_db, ingest_report, list_dashboard, list_samples, list_targets, register_probe


app = FastAPI(title="PathLens API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:300·"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/register")
def register(registration: ProbeRegistration) -> dict[str, str]:
    register_probe(registration)
    return {"status": "registered"}


@app.post("/api/reports")
def report(payload: ProbeReport) -> dict[str, str]:
    ingest_report(payload)
    return {"status": "accepted"}


@app.get("/api/dashboard", response_model=DashboardView)
def dashboard() -> dict:
    return list_dashboard()


@app.get("/api/paths/{source_probe_id}/{target_probe_id}/samples", response_model=list[SampleView])
def samples(source_probe_id: str, target_probe_id: str) -> list[dict]:
    return list_samples(source_probe_id, target_probe_id)


@app.get("/api/targets/{probe_id}")
def targets(probe_id: str) -> dict[str, list[dict]]:
    """Discovery: return other online probes this probe should be probing."""
    return {"targets": list_targets(probe_id)}
