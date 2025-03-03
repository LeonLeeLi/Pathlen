from datetime import datetime
from typing import List

from pydantic import BaseModel, Field


class ProbeRegistration(BaseModel):
    probe_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    address: str = Field(min_length=1)
    region: str = "local"


class SystemMetrics(BaseModel):
    cpu_percent: float
    memory_percent: float
    rx_bytes_per_sec: float
    tx_bytes_per_sec: float


class PathMeasurement(BaseModel):
    target_probe_id: str
    target_url: str
    latency_ms: float
    packet_loss: float
    jitter_ms: float


class ProbeReport(BaseModel):
    probe_id: str
    timestamp: datetime
    system: SystemMetrics
    paths: List[PathMeasurement]


class TargetSuggestion(BaseModel):
    """One entry returned by the discovery endpoint: who to probe and where."""

    target_probe_id: str
    target_url: str


class ProbeView(BaseModel):
    probe_id: str
    name: str
    address: str
    region: str
    last_seen: str
    online: bool
    cpu_percent: float
    memory_percent: float
    rx_bytes_per_sec: float
    tx_bytes_per_sec: float


class PathView(BaseModel):
    source_probe_id: str
    target_probe_id: str
    latency_ms: float
    packet_loss: float
    jitter_ms: float
    score: float
    sample_count: int
    updated_at: str


class SampleView(BaseModel):
    timestamp: str
    latency_ms: float
    packet_loss: float
    jitter_ms: float
    score: float


class EventView(BaseModel):
    id: int
    timestamp: str
    severity: str
    source_probe_id: str
    target_probe_id: str
    message: str


class DashboardView(BaseModel):
    probes: List[ProbeView]
    paths: List[PathView]
    events: List[EventView]
