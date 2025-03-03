package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
)

type config struct {
	ID       string
	Name     string
	Region   string
	Listen   string
	Address  string
	Backend  string
	Targets  map[string]string
	Interval time.Duration
}

type registration struct {
	ProbeID string `json:"probe_id"`
	Name    string `json:"name"`
	Address string `json:"address"`
	Region  string `json:"region"`
}

type systemMetrics struct {
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryPercent float64 `json:"memory_percent"`
	RXBytesPerSec float64 `json:"rx_bytes_per_sec"`
	TXBytesPerSec float64 `json:"tx_bytes_per_sec"`
}

type pathMeasurement struct {
	TargetProbeID string  `json:"target_probe_id"`
	TargetURL     string  `json:"target_url"`
	LatencyMS     float64 `json:"latency_ms"`
	PacketLoss    float64 `json:"packet_loss"`
	JitterMS      float64 `json:"jitter_ms"`
}

type reportPayload struct {
	ProbeID   string            `json:"probe_id"`
	Timestamp time.Time         `json:"timestamp"`
	System    systemMetrics     `json:"system"`
	Paths     []pathMeasurement `json:"paths"`
}

type netSnapshot struct {
	rxBytes uint64
	txBytes uint64
	at      time.Time
}

// discoveryResponse 是后端 GET /api/targets/{id} 的返回结构。
type discoveryResponse struct {
	Targets []discoveredTarget `json:"targets"`
}

type discoveredTarget struct {
	TargetProbeID string `json:"target_probe_id"`
	TargetURL     string `json:"target_url"`
}

// 全局目标表:由发现 goroutine 周期性整体覆盖,主循环读快照使用。
// 启动时用 -targets 的初始值填充,随后由自动发现接管。
var (
	targetsMu sync.RWMutex
	targets   = map[string]string{}
)

// snapshotTargets 返回当前目标表的一份拷贝,供探测时使用,避免持锁。
func snapshotTargets() map[string]string {
	targetsMu.RLock()
	defer targetsMu.RUnlock()
	out := make(map[string]string, len(targets))
	for k, v := range targets {
		out[k] = v
	}
	return out
}

// replaceTargets 用自动发现的结果整体覆盖目标表。
func replaceTargets(discovered []discoveredTarget) {
	targetsMu.Lock()
	defer targetsMu.Unlock()
	targets = make(map[string]string, len(discovered))
	for _, t := range discovered {
		if t.TargetProbeID == "" || t.TargetURL == "" {
			continue
		}
		targets[t.TargetProbeID] = t.TargetURL
	}
}

// refreshTargetsLoop 周期性从后端拉取"我应该探测谁",并整体覆盖目标表。
// 每 discoveryInterval 拉一次;失败时仅打日志,不动现有目标表(降级保留)。
func refreshTargetsLoop(ctx context.Context, backend, selfID string, discoveryInterval time.Duration) {
	client := &http.Client{Timeout: 2 * time.Second}
	url := fmt.Sprintf("%s/api/targets/%s", backend, selfID)
	ticker := time.NewTicker(discoveryInterval)
	defer ticker.Stop()

	// 启动后立即拉一次,不等第一个 tick。
	pull := func() {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			log.Printf("discover request build failed: %v", err)
			return
		}
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("discover fetch failed: %v", err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 300 {
			log.Printf("discover fetch returned status %d", resp.StatusCode)
			return
		}
		var dr discoveryResponse
		if err := json.NewDecoder(resp.Body).Decode(&dr); err != nil {
			log.Printf("discover decode failed: %v", err)
			return
		}
		replaceTargets(dr.Targets)

		ids := make([]string, 0, len(dr.Targets))
		for _, t := range dr.Targets {
			ids = append(ids, t.TargetProbeID)
		}
		log.Printf("discovered %d target(s): %v", len(dr.Targets), ids)
	}

	pull()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pull()
		}
	}
}

func main() {
	cfg := parseConfig()
	log.Printf("starting probe id=%s name=%q listen=%s address=%s", cfg.ID, cfg.Name, cfg.Listen, cfg.Address)

	mux := http.NewServeMux()
	mux.HandleFunc("/echo", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	go func() {
		log.Printf("probe %s echo server listening on %s", cfg.ID, cfg.Listen)
		if err := http.ListenAndServe(cfg.Listen, mux); err != nil {
			log.Fatalf("echo server failed: %v", err)
		}
	}()

	if err := postJSON(cfg.Backend+"/api/register", registration{
		ProbeID: cfg.ID,
		Name:    cfg.Name,
		Address: cfg.Address,
		Region:  cfg.Region,
	}); err != nil {
		log.Printf("initial registration failed: %v", err)
	}

	// 用 -targets 的初始值填一遍全局目标表,随后交给发现 goroutine 自动覆盖。
	for k, v := range cfg.Targets {
		targets[k] = v
	}
	if len(cfg.Targets) > 0 {
		log.Printf("seeded %d target(s) from -targets", len(cfg.Targets))
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go refreshTargetsLoop(ctx, cfg.Backend, cfg.ID, 10*time.Second)

	client := &http.Client{Timeout: 2 * time.Second}
	previousNet := readNetSnapshot()
	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()

	for {
		<-ticker.C
		nextNet := readNetSnapshot()
		payload := reportPayload{
			ProbeID:   cfg.ID,
			Timestamp: time.Now().UTC(),
			System:    collectSystem(previousNet, nextNet),
			Paths:     probeTargets(client),
		}
		previousNet = nextNet

		if err := postJSON(cfg.Backend+"/api/register", registration{
			ProbeID: cfg.ID,
			Name:    cfg.Name,
			Address: cfg.Address,
			Region:  cfg.Region,
		}); err != nil {
			log.Printf("registration refresh failed: %v", err)
		}

		if err := postJSON(cfg.Backend+"/api/reports", payload); err != nil {
			log.Printf("report failed: %v", err)
			continue
		}
		log.Printf("reported %d path sample(s)", len(payload.Paths))
	}
}

func parseConfig() config {
	targetsRaw := flag.String("targets", "", "comma separated targets like probe-b=http://127.0.0.1:9102/echo")
	cfg := config{}
	flag.StringVar(&cfg.ID, "id", "", "stable probe id (auto-generated from hostname+port if empty)")
	flag.StringVar(&cfg.Name, "name", "", "display name (defaults to id if empty)")
	flag.StringVar(&cfg.Region, "region", "local", "probe region label")
	flag.StringVar(&cfg.Listen, "listen", ":9101", "echo server listen address")
	flag.StringVar(&cfg.Address, "address", "", "externally reachable URL of this probe's echo server (e.g. http://192.168.1.5:9101)")
	flag.StringVar(&cfg.Backend, "backend", "http://127.0.0.1:8000", "PathLens backend base URL")
	flag.DurationVar(&cfg.Interval, "interval", 3*time.Second, "report interval")
	flag.Parse()

	// 没传 -id 时自动生成:用 主机名-端口 加上一个短随机后缀,
	// 保证同一台机器开多个实例、以及不同机器之间都不会撞 id。
	if cfg.ID == "" {
		cfg.ID = autoProbeID(cfg.Listen)
	}
	// 没传 -name 时用 id 当显示名。
	if cfg.Name == "" {
		cfg.Name = cfg.ID
	}
	// 没传 -address 时回退到 127.0.0.1:listen —— 单机演示原行为。
	// 多机部署时必须传 -address 指向本机真实可达地址,否则别的探针发现不了你。
	if cfg.Address == "" {
		cfg.Address = "http://127.0.0.1" + cfg.Listen
	}
	cfg.Targets = parseTargets(*targetsRaw)
	if cfg.ID == "" {
		fmt.Println("-id is required")
		os.Exit(1)
	}
	return cfg
}

func parseTargets(raw string) map[string]string {
	targets := map[string]string{}
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		parts := strings.SplitN(item, "=", 2)
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			log.Printf("ignoring malformed target %q", item)
			continue
		}
		targets[parts[0]] = parts[1]
	}
	return targets
}

// autoProbeID 在用户没传 -id 时生成一个稳定且唯一的探针 id。
// 格式:<主机名>-<端口>-<4字节随机十六进制>,例如 "DESKTOP-ABC-9101-a3f1c2e9"。
// 加端口让同一台机器开多个实例天然不会撞,加随机后缀做最终保险。
func autoProbeID(listen string) string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "probe"
	}
	// 取出 listen 里的端口号:" :9101 " -> " 9101 "," 127.0.0.1:9101 " -> " 9101 "。
	port := listen
	if idx := strings.LastIndex(listen, ":"); idx >= 0 {
		port = listen[idx+1:]
	}
	if port == "" {
		port = "x"
	}
	var suffix [4]byte
	_, _ = rand.Read(suffix[:])
	return fmt.Sprintf("%s-%s-%s", host, port, hex.EncodeToString(suffix[:]))
}

func collectSystem(previous, current netSnapshot) systemMetrics {
	cpuValues, _ := cpu.Percent(0, false)
	vm, _ := mem.VirtualMemory()

	cpuPercent := 0.0
	if len(cpuValues) > 0 {
		cpuPercent = round(cpuValues[0])
	}

	elapsed := current.at.Sub(previous.at).Seconds()
	if elapsed <= 0 {
		elapsed = 1
	}

	rxDelta := deltaBytes(previous.rxBytes, current.rxBytes)
	txDelta := deltaBytes(previous.txBytes, current.txBytes)

	return systemMetrics{
		CPUPercent:    cpuPercent,
		MemoryPercent: round(vm.UsedPercent),
		RXBytesPerSec: round(float64(rxDelta) / elapsed),
		TXBytesPerSec: round(float64(txDelta) / elapsed),
	}
}

func readNetSnapshot() netSnapshot {
	counters, err := net.IOCounters(false)
	if err != nil || len(counters) == 0 {
		return netSnapshot{at: time.Now()}
	}
	return netSnapshot{
		rxBytes: counters[0].BytesRecv,
		txBytes: counters[0].BytesSent,
		at:      time.Now(),
	}
}

func probeTargets(client *http.Client) []pathMeasurement {
	current := snapshotTargets()
	results := make([]pathMeasurement, 0, len(current))
	for targetID, targetURL := range current {
		results = append(results, probeOneTarget(client, targetID, targetURL))
	}
	return results
}

func probeOneTarget(client *http.Client, targetID string, targetURL string) pathMeasurement {
	const attempts = 4
	latencies := make([]float64, 0, attempts)
	losses := 0

	for i := 0; i < attempts; i++ {
		start := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
		resp, err := client.Do(req)
		cancel()

		if err != nil || resp.StatusCode >= 400 {
			losses++
			if resp != nil {
				_ = resp.Body.Close()
			}
			continue
		}
		_ = resp.Body.Close()
		latencies = append(latencies, float64(time.Since(start).Microseconds())/1000.0)
		time.Sleep(120 * time.Millisecond)
	}

	return pathMeasurement{
		TargetProbeID: targetID,
		TargetURL:     targetURL,
		LatencyMS:     round(avg(latencies)),
		PacketLoss:    round(float64(losses) / attempts),
		JitterMS:      round(stddev(latencies)),
	}
}

func postJSON(url string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s returned status %d", url, resp.StatusCode)
	}
	return nil
}

func avg(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func stddev(values []float64) float64 {
	if len(values) < 2 {
		return 0
	}
	mean := avg(values)
	total := 0.0
	for _, value := range values {
		delta := value - mean
		total += delta * delta
	}
	return math.Sqrt(total / float64(len(values)-1))
}

func round(value float64) float64 {
	return math.Round(value*10) / 10
}

func deltaBytes(previous uint64, current uint64) uint64 {
	if current < previous {
		return 0
	}
	return current - previous
}
