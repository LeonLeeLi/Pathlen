from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.analyzer import build_event_message, calculate_score
from app.models import ProbeRegistration, ProbeReport


DB_PATH = Path(__file__).resolve().parent.parent / "pathlens.db"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with open_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS probes (
                probe_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                address TEXT NOT NULL,
                region TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                cpu_percent REAL NOT NULL DEFAULT 0,
                memory_percent REAL NOT NULL DEFAULT 0,
                rx_bytes_per_sec REAL NOT NULL DEFAULT 0,
                tx_bytes_per_sec REAL NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS path_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_probe_id TEXT NOT NULL,
                target_probe_id TEXT NOT NULL,
                target_url TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                latency_ms REAL NOT NULL,
                packet_loss REAL NOT NULL,
                jitter_ms REAL NOT NULL,
                score REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                severity TEXT NOT NULL,
                source_probe_id TEXT NOT NULL,
                target_probe_id TEXT NOT NULL,
                message TEXT NOT NULL
            );
            """
        )


def register_probe(registration: ProbeRegistration) -> None:
    now = utc_now_iso()
    with open_db() as conn:
        conn.execute(
            """
            INSERT INTO probes (probe_id, name, address, region, last_seen)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(probe_id) DO UPDATE SET
                name = excluded.name,
                address = excluded.address,
                region = excluded.region,
                last_seen = excluded.last_seen
            """,
            (
                registration.probe_id,
                registration.name,
                registration.address,
                registration.region,
                now,
            ),
        )


def ingest_report(report: ProbeReport) -> None:
    timestamp = report.timestamp.isoformat()
    with open_db() as conn:
        conn.execute(
            """
            UPDATE probes
            SET last_seen = ?,
                cpu_percent = ?,
                memory_percent = ?,
                rx_bytes_per_sec = ?,
                tx_bytes_per_sec = ?
            WHERE probe_id = ?
            """,
            (
                timestamp,
                report.system.cpu_percent,
                report.system.memory_percent,
                report.system.rx_bytes_per_sec,
                report.system.tx_bytes_per_sec,
                report.probe_id,
            ),
        )

        for path in report.paths:
            score = calculate_score(path)
            conn.execute(
                """
                INSERT INTO path_samples (
                    source_probe_id, target_probe_id, target_url, timestamp,
                    latency_ms, packet_loss, jitter_ms, score
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    report.probe_id,
                    path.target_probe_id,
                    path.target_url,
                    timestamp,
                    path.latency_ms,
                    path.packet_loss,
                    path.jitter_ms,
                    score,
                ),
            )

            event = build_event_message(report.probe_id, path, score)
            if event is not None:
                severity, message = event
                conn.execute(
                    """
                    INSERT INTO events (
                        timestamp, severity, source_probe_id, target_probe_id, message
                    )
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (timestamp, severity, report.probe_id, path.target_probe_id, message),
                )


def list_dashboard() -> dict[str, Any]:
    cutoff_seconds = 20
    with open_db() as conn:
        probes = [dict(row) for row in conn.execute("SELECT * FROM probes ORDER BY probe_id")]
        paths = [
            dict(row)
            for row in conn.execute(
                """
                SELECT
                    source_probe_id,
                    target_probe_id,
                    AVG(latency_ms) AS latency_ms,
                    AVG(packet_loss) AS packet_loss,
                    AVG(jitter_ms) AS jitter_ms,
                    AVG(score) AS score,
                    COUNT(*) AS sample_count,
                    MAX(timestamp) AS updated_at
                FROM (
                    SELECT *
                    FROM path_samples
                    ORDER BY timestamp DESC
                    LIMIT 300
                )
                GROUP BY source_probe_id, target_probe_id
                ORDER BY source_probe_id, target_probe_id
                """
            )
        ]
        events = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, timestamp, severity, source_probe_id, target_probe_id, message
                FROM events
                ORDER BY id DESC
                LIMIT 20
                """
            )
        ]

    now = datetime.now(timezone.utc)
    for probe in probes:
        last_seen = datetime.fromisoformat(probe["last_seen"])
        probe["online"] = (now - last_seen).total_seconds() <= cutoff_seconds

    return {"probes": probes, "paths": paths, "events": events}


def list_samples(source_probe_id: str, target_probe_id: str) -> list[dict[str, Any]]:
    with open_db() as conn:
        rows = conn.execute(
            """
            SELECT timestamp, latency_ms, packet_loss, jitter_ms, score
            FROM path_samples
            WHERE source_probe_id = ? AND target_probe_id = ?
            ORDER BY timestamp DESC
            LIMIT 60
            """,
            (source_probe_id, target_probe_id),
        )
        samples = [dict(row) for row in rows]
    return list(reversed(samples))


def list_targets(probe_id: str) -> list[dict[str, Any]]:
    """Return every other online probe's echo URL so callers can auto-mesh.

    "Online" mirrors the dashboard: last_seen within CUTOFF_SECONDS. The
    echo URL is built from each probe's registered address + "/echo".
    """
    cutoff_seconds = 20
    cutoff = datetime.now(timezone.utc).timestamp() - cutoff_seconds
    with open_db() as conn:
        rows = conn.execute(
            """
            SELECT probe_id, address, last_seen
            FROM probes
            WHERE probe_id != ?
            ORDER BY probe_id
            """,
            (probe_id,),
        )
        result: list[dict[str, Any]] = []
        for row in rows:
            last_seen = datetime.fromisoformat(row["last_seen"])
            if last_seen.tzinfo is None:
                last_seen = last_seen.replace(tzinfo=timezone.utc)
            if last_seen.timestamp() < cutoff:
                continue
            address = row["address"] or ""
            if not address.startswith("http://") and not address.startswith("https://"):
                # 防御性兜底:address 字段理论上总是带 scheme 的完整 URL
                address = "http://" + address
            result.append(
                {
                    "target_probe_id": row["probe_id"],
                    "target_url": address.rstrip("/") + "/echo",
                }
            )
    return result
