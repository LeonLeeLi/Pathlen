from app.models import PathMeasurement


def calculate_score(path: PathMeasurement) -> float:
    """Turn raw network signals into a readable 0-100 health score."""
    latency_penalty = max(0.0, path.latency_ms - 50.0) * 0.25
    loss_penalty = path.packet_loss * 120.0
    jitter_penalty = max(0.0, path.jitter_ms - 10.0) * 1.5
    return round(max(0.0, 100.0 - latency_penalty - loss_penalty - jitter_penalty), 1)


def build_event_message(source_probe_id: str, path: PathMeasurement, score: float) -> tuple[str, str] | None:
    if path.packet_loss > 0:
        return (
            "warning" if score >= 50 else "critical",
            f"{source_probe_id} -> {path.target_probe_id} has {path.packet_loss:.0%} packet loss",
        )
    if score < 70:
        return (
            "warning" if score >= 50 else "critical",
            f"{source_probe_id} -> {path.target_probe_id} path score dropped to {score:.1f}",
        )
    return None
