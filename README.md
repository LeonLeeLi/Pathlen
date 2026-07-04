
# PathLens

PathLens is a internet path observability demo. Traditional host
monitoring answers "is this machine healthy?" PathLens answers "from probe A to
probe B, is this network path healthy?"

The MVP has three parts:

- `agent-go/`: lightweight Go probe agent.
- `backend-python/`: FastAPI control plane with SQLite storage and scoring.
- `web-next/`: Next.js dashboard.

## What It Shows

- Probe online/offline state.
- CPU, memory, and network throughput for each probe.
- A -> B path latency, packet loss, jitter, and health score.
- Recent anomaly events when path quality degrades.

## Local Demo

Start the backend:

```bash
cd backend-python
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Start two probes in separate terminals:

```bash
cd agent-go
go run . -id probe-a -name "Probe A" -listen :9101 -backend http://127.0.0.1:8000 -targets probe-b=http://127.0.0.1:9102/echo
```

```bash
cd agent-go
go run . -id probe-b -name "Probe B" -listen :9102 -backend http://127.0.0.1:8000 -targets probe-a=http://127.0.0.1:9101/echo
```

Start the dashboard:

```bash
cd web-next
npm install
npm run dev
```

Open `http://localhost:3000`.

## Multi-Machine Deployment (Auto-Mesh)

Probes now discover each other automatically. Start them on as many machines
as you like — within ~10 seconds they will form a full mesh of probes with no
manual `-targets` wiring.

On each probe machine, point `-backend` at the backend host and pass
`-address` so other probes can reach this probe's `/echo` endpoint:

```bash
cd agent-go
go run . -id probe-N -name "Probe N" -listen :9101 \
  -backend http://BACKEND_HOST:8000 \
  -address http://THIS_HOST:9101
```

Notes:

- The backend must listen on all interfaces: `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
- `-address` is required in multi-machine setups — without it the probe falls
  back to `http://127.0.0.1:<listen>`, which other machines cannot reach.
- Open firewall ports: `8000` on the backend host, and each probe's `-listen`
  port (for `/echo`) on its host.
- `-targets` is still accepted as a seed; it is overwritten by discovery on
  the next refresh (~10 s).

## Architecture

```text
Go probe -> POST /api/register -> Python backend -> SQLite
Go probe -> POST /api/reports   -> Python backend -> score/events -> SQLite
Next.js  -> GET /api/dashboard  -> Python backend -> JSON dashboard
```

The Go agent uses HTTP probes instead of ICMP so the demo can run without
administrator privileges.

## Project Pitch

PathLens is a lightweight distributed path observability system. It combines
active probing and host telemetry to show whether an issue is happening on a
machine, at the edge, or on the path between two probes.

---

# 中文说明

## 项目简介

PathLens 是一个轻量级的分布式网络路径可观测性系统。传统的监控只能回答
"这台机器是否健康",而 PathLens 回答的是更关键的问题:**从探针 A 到探针 B,
这条网络路径是否健康?**

它结合主动探测与主机遥测数据,帮助判断问题究竟出在机器本身、网络边缘,
还是在两个探针之间的路径上。

## 三大组件

- `agent-go/`:轻量级 Go 探针代理,负责采集主机指标并对其他探针发起 HTTP 探测。
- `backend-python/`:基于 FastAPI 的控制面,使用 SQLite 存储,内置路径质量评分
  与异常事件生成。
- `web-next/`:基于 Next.js 的可视化仪表盘,展示探针状态、路径矩阵、趋势曲线
  与异常事件流。

## 功能亮点

- 实时探针在线/离线状态。
- 每个探针的 CPU、内存、网络吞吐。
- A → B 路径的延迟、丢包、抖动与健康分。
- 路径质量下降时自动生成异常事件。
- **多台探针自动互联**:新探针一上线,约 10 秒内全网自动形成全 mesh 探测,
  无需手动配置目标。
- **前端支持中英文一键切换**(右上角语言按钮,选择会被记忆)。

## 本地运行

启动后端:

```bash
cd backend-python
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

在两个终端分别启动两个探针:

```bash
cd agent-go
go run . -id probe-a -name "Probe A" -listen :9101 -backend http://127.0.0.1:8000 -targets probe-b=http://127.0.0.1:9102/echo
```

```bash
cd agent-go
go run . -id probe-b -name "Probe B" -listen :9102 -backend http://127.0.0.1:8000 -targets probe-a=http://127.0.0.1:9101/echo
```

启动仪表盘:

```bash
cd web-next
npm install
npm run dev
```

打开 `http://localhost:3000` 即可。

## 关于前端

> **本项目前端(`web-next/`)使用 AI 辅助开发。**
>
> 仪表盘的界面布局、组件结构、样式、图表集成(含 recharts 双 Y 轴趋势图)、
> 数据轮询逻辑,以及中英文国际化(i18n)切换功能,均在与 AI 结对协作下完成。
> 人工负责需求设计、代码审查、架构取舍与最终验收,AI 负责具体代码生成、
> 样式调优与样板代码的快速产出。
