"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type Locale = "en" | "zh";

type Dict = Record<string, string>;

const en: Dict = {
  "app.eyebrow": "Internet Path Observability",
  "app.title": "PathLens",
  "top.waiting": "Waiting for probes",
  "top.probes": "{count} probes",
  "banner.backendDown": "Backend is not reachable. Start the FastAPI backend on port 8000.",
  "metric.paths": "Paths",
  "metric.online": "Online probes",
  "metric.events": "Events",
  "serverPath.title": "Path",
  "serverPath.subtitle": "latest rolling average",
  "serverPath.empty": "No path samples yet.",
  "pathDetail.title": "Path Detail",
  "pathDetail.waiting": "waiting",
  "pathDetail.samples": "{count} samples",
  "legend.latency": "Latency ms",
  "legend.jitter": "Jitter ms",
  "legend.score": "Score",
  "probes.title": "Probes",
  "probes.subtitle": "host telemetry",
  "probe.cpu": "CPU",
  "probe.memory": "Memory",
  "probe.rx": "RX",
  "probe.tx": "TX",
  "probe.online": "online",
  "probe.offline": "offline",
  "events.title": "Events",
  "events.subtitle": "recent anomalies",
  "events.empty": "No anomalies yet.",
  "lang.toggle": "中文"
};

const zh: Dict = {
  "app.eyebrow": "互联网路径可观测性",
  "app.title": "PathLens",
  "top.waiting": "等待探针接入",
  "top.probes": "{count} 个探针",
  "banner.backendDown": "无法连接后端。请先在 8000 端口启动 FastAPI 后端。",
  "metric.paths": "路径数",
  "metric.online": "在线探针",
  "metric.events": "事件数",
  "serverPath.title": "路径",
  "serverPath.subtitle": "最新滚动平均值",
  "serverPath.empty": "暂无路径采样数据。",
  "pathDetail.title": "路径详情",
  "pathDetail.waiting": "等待中",
  "pathDetail.samples": "{count} 条采样",
  "legend.latency": "延迟 ms",
  "legend.jitter": "抖动 ms",
  "legend.score": "健康分",
  "probes.title": "探针",
  "probes.subtitle": "主机遥测",
  "probe.cpu": "CPU",
  "probe.memory": "内存",
  "probe.rx": "接收",
  "probe.tx": "发送",
  "probe.online": "在线",
  "probe.offline": "离线",
  "events.title": "事件",
  "events.subtitle": "近期异常",
  "events.empty": "暂无异常事件。",
  "lang.toggle": "EN"
};

const DICTS: Record<Locale, Dict> = { en, zh };

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggle: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "pathlens.locale";

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in params ? String(params[key]) : `{${key}}`
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // 默认英文,避免 SSR/CSR 不一致;在客户端挂载后读取 localStorage 切换。
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (saved === "en" || saved === "zh") {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 忽略隐私模式等写入失败
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      toggle: () => setLocale(locale === "en" ? "zh" : "en"),
      t: (key, params) => {
        const dict = DICTS[locale];
        return interpolate(dict[key] ?? DICTS.en[key] ?? key, params);
      }
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
