"use client";

import type { ReactNode } from "react";
import { Activity, AlertTriangle, Languages, Network, RadioTower } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useEffect, useMemo, useState } from "react";
import { Dashboard, PathSummary, Sample, fetchDashboard, fetchSamples } from "../lib/api";
import { useI18n } from "../lib/i18n";

// Frosted-glass surface shared by panels, metric cards, status pill, language button.
// Centralized so a visual tweak is one edit, not twenty. See component-guidelines.md.
const cardBase =
  "bg-card border border-card-border shadow-[0_18px_45px_var(--color-shadow)]";

export default function Home() {
  const { t, toggle } = useI18n();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedPath, setSelectedPath] = useState<PathSummary | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nextDashboard = await fetchDashboard();
        if (cancelled) return;
        setDashboard(nextDashboard);
        setError(null);
        setSelectedPath((current) => current ?? nextDashboard.paths[0] ?? null);
      } catch {
        if (!cancelled) setError("Backend is not reachable");
      }
    }

    load();
    const timer = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    const path = selectedPath;

    async function loadSamples() {
      const nextSamples = await fetchSamples(path.source_probe_id, path.target_probe_id);
      if (!cancelled) setSamples(nextSamples);
    }

    loadSamples().catch(() => setSamples([]));
    const timer = window.setInterval(() => loadSamples().catch(() => setSamples([])), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedPath]);

  const chartSamples = useMemo(
    () =>
      samples.map((sample) => ({
        ...sample,
        label: new Date(sample.timestamp).toLocaleTimeString()
      })),
    [samples]
  );

  return (
    <main className="min-h-screen p-5 md:p-7">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between max-w-[1240px] mx-auto mb-6">
        <div>
          <p className="text-brand text-[13px] font-bold uppercase tracking-wide mb-1">{t("app.eyebrow")}</p>
          <h1 className="text-[34px] md:text-[42px] leading-none">{t("app.title")}</h1>
        </div>
        <div className="flex items-center gap-3 self-stretch md:self-auto">
          <button
            className={`${cardBase} rounded-full flex items-center gap-1.5 font-bold px-3.5 py-2 hover:bg-accent-bg hover:border-accent transition-colors cursor-pointer`}
            onClick={toggle}
            title="Switch language"
            type="button"
          >
            <Languages size={18} />
            {t("lang.toggle")}
          </button>
          <div className={`${cardBase} rounded-full flex items-center gap-2 font-bold px-3.5 py-2`}>
            <RadioTower size={18} />
            {dashboard ? t("top.probes", { count: dashboard.probes.length }) : t("top.waiting")}
          </div>
        </div>
      </header>

      {error ? (
        <div className="bg-banner-bg border border-banner-border rounded-lg max-w-[1240px] mx-auto mb-5 px-3.5 py-3">
          {t("banner.backendDown")}
        </div>
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3.5 max-w-[1240px] mx-auto mb-5">
        <MetricCard icon={<Network size={20} />} label={t("metric.paths")} value={dashboard?.paths.length ?? 0} />
        <MetricCard
          icon={<Activity size={20} />}
          label={t("metric.online")}
          value={dashboard?.probes.filter((probe) => probe.online).length ?? 0}
        />
        <MetricCard icon={<AlertTriangle size={20} />} label={t("metric.events")} value={dashboard?.events.length ?? 0} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)] gap-5 max-w-[1240px] mx-auto mb-5">
        <div className={`${cardBase} rounded-lg p-4.5`}>
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-lg">{t("serverPath.title")}</h2>
            <span className="text-muted text-[13px]">{t("serverPath.subtitle")}</span>
          </div>
          <div className="grid gap-2.5">
            {dashboard?.paths.map((path) => (
              <button
                className={`grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 items-center text-left p-3 rounded-lg cursor-pointer ${
                  isSamePath(path, selectedPath)
                    ? "bg-accent-bg border border-accent"
                    : "bg-soft border border-soft-border"
                }`}
                key={`${path.source_probe_id}-${path.target_probe_id}`}
                onClick={() => setSelectedPath(path)}
                type="button"
              >
                <span>{formatPathName(path)}</span>
                <strong className="text-teal text-2xl">{path.score.toFixed(1)}</strong>
                <small className="text-muted">{path.latency_ms.toFixed(1)} ms</small>
              </button>
            ))}
            {dashboard?.paths.length === 0 ? (
              <p className="text-muted">{t("serverPath.empty")}</p>
            ) : null}
          </div>
        </div>

        <div className={`${cardBase} rounded-lg p-4.5 md:min-h-[420px]`}>
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-lg">{selectedPath ? formatPathName(selectedPath) : t("pathDetail.title")}</h2>
            <span className="text-muted text-[13px]">
              {selectedPath ? t("pathDetail.samples", { count: selectedPath.sample_count }) : t("pathDetail.waiting")}
            </span>
          </div>
          <div className="h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartSamples}>
                <CartesianGrid stroke="#d7dde8" strokeDasharray="4 4" />
                <XAxis dataKey="label" minTickGap={32} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="latency_ms" name={t("legend.latency")} stroke="#2563eb" dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="jitter_ms" name={t("legend.jitter")} stroke="#0f766e" dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="score" name={t("legend.score")} stroke="#dc2626" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_420px] gap-5 max-w-[1240px] mx-auto mb-5">
        <div className={`${cardBase} rounded-lg p-4.5`}>
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-lg">{t("probes.title")}</h2>
            <span className="text-muted text-[13px]">{t("probes.subtitle")}</span>
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            {dashboard?.probes.map((probe) => (
              <article className="bg-soft border border-soft-border rounded-lg p-3.5" key={probe.probe_id}>
                <div className="flex items-center justify-between mb-2">
                  <strong>{probe.name}</strong>
                  <span
                    className={`rounded-full text-xs font-bold px-2 py-1 ${
                      probe.online ? "bg-online-bg text-online-text" : "bg-offline-bg text-offline-text"
                    }`}
                  >
                    {probe.online ? t("probe.online") : t("probe.offline")}
                  </span>
                </div>
                <p className="text-muted text-[13px] mb-3 break-all">{probe.address}</p>
                <MetricRow label={t("probe.cpu")} value={`${probe.cpu_percent.toFixed(1)}%`} />
                <MetricRow label={t("probe.memory")} value={`${probe.memory_percent.toFixed(1)}%`} />
                <MetricRow label={t("probe.rx")} value={`${formatBytes(probe.rx_bytes_per_sec)}/s`} />
                <MetricRow label={t("probe.tx")} value={`${formatBytes(probe.tx_bytes_per_sec)}/s`} />
              </article>
            ))}
          </div>
        </div>

        <div className={`${cardBase} rounded-lg p-4.5`}>
          <div className="flex items-center justify-between mb-3.5">
            <h2 className="text-lg">{t("events.title")}</h2>
            <span className="text-muted text-[13px]">{t("events.subtitle")}</span>
          </div>
          <div className="grid gap-2.5">
            {dashboard?.events.map((event) => (
              <article
                className={`bg-soft rounded-lg p-3 border-l-4 ${
                  event.severity === "critical" ? "border-l-crit" : "border-l-warn"
                }`}
                key={event.id}
              >
                <strong className="uppercase">{event.severity}</strong>
                <p className="my-1.5">{event.message}</p>
                <small className="text-muted">{new Date(event.timestamp).toLocaleTimeString()}</small>
              </article>
            ))}
            {dashboard?.events.length === 0 ? <p className="text-muted">{t("events.empty")}</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <article className={`${cardBase} rounded-lg grid grid-cols-[42px_1fr] gap-x-3 gap-y-1 items-center p-4`}>
      <div className="bg-chip-bg text-chip-text rounded-lg h-[42px] w-[42px] flex items-center justify-center row-span-2">
        {icon}
      </div>
      <span className="text-muted text-sm">{label}</span>
      <strong className="text-3xl">{value}</strong>
    </article>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-divider py-2">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isSamePath(path: PathSummary, selected: PathSummary | null) {
  return (
    selected?.source_probe_id === path.source_probe_id &&
    selected?.target_probe_id === path.target_probe_id
  );
}

function formatPathName(path: PathSummary) {
  return `${path.source_probe_id} -> ${path.target_probe_id}`;
}

function formatBytes(bytes: number) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes.toFixed(0)} B`;
}
