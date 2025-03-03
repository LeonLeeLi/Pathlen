const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

export type Probe = {
  probe_id: string;
  name: string;
  address: string;
  region: string;
  last_seen: string;
  online: boolean;
  cpu_percent: number;
  memory_percent: number;
  rx_bytes_per_sec: number;
  tx_bytes_per_sec: number;
};

export type PathSummary = {
  source_probe_id: string;
  target_probe_id: string;
  latency_ms: number;
  packet_loss: number;
  jitter_ms: number;
  score: number;
  sample_count: number;
  updated_at: string;
};

export type Event = {
  id: number;
  timestamp: string;
  severity: "warning" | "critical";
  source_probe_id: string;
  target_probe_id: string;
  message: string;
};

export type Dashboard = {
  probes: Probe[];
  paths: PathSummary[];
  events: Event[];
};

export type Sample = {
  timestamp: string;
  latency_ms: number;
  packet_loss: number;
  jitter_ms: number;
  score: number;
};

export async function fetchDashboard(): Promise<Dashboard> {
  const response = await fetch(`${API_BASE}/api/dashboard`, { cache: "no-store" });
  if (!response.ok) throw new Error("dashboard request failed");
  return response.json();
}

export async function fetchSamples(source: string, target: string): Promise<Sample[]> {
  const response = await fetch(`${API_BASE}/api/paths/${source}/${target}/samples`, { cache: "no-store" });
  if (!response.ok) throw new Error("samples request failed");
  return response.json();
}
