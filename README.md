# ✈️ TripMate AI — Multi-Agent Travel Planner

A multi-agent travel planning system built with **LangGraph**, **FastAPI**, and the **Model Context Protocol (MCP)**. Describe a trip in plain English, and a supervised pipeline of specialist agents researches flights, hotels, and weather, checks it against your budget, drafts an itinerary, and pauses for your approval before finalizing it.

> Example: *"Plan a complete 7 days Japan trip from Bangladesh including flights, hotels and sightseeing under 2 lakhs."*

---

## Features

- 🧭 **Supervisor-routed multi-agent graph** — a supervisor agent reads each request and dynamically decides which specialist agents actually need to run, instead of always executing a fixed pipeline
- 🛡️ **Input guardrail** — an LLM-based check blocks off-topic or harmful requests before any specialist agent or tool call runs
- ✅ **Human-in-the-loop approval** — the graph pauses after drafting an itinerary and waits for the user to approve it or request a revision, using LangGraph's `interrupt()`
- 🔌 **MCP-based tool integration** — flight data, hotel search, and weather are all fetched through MCP servers (Tavily, AviationStack, a weather provider) rather than hand-rolled API wrappers
- 💾 **Persistent conversation memory** — LangGraph state is checkpointed to PostgreSQL per `thread_id`, so conversations (and paused approval steps) survive across requests
- 💰 **Budget feasibility analysis** — a dedicated agent estimates cost categories and flags budget risk before the itinerary is finalized
- 🌦️ **Live weather + forecast** — current conditions and forecast data are pulled in to inform packing and scheduling advice
- 🧾 **PDF export & copy** — the final itinerary can be copied to clipboard or downloaded as a PDF from the browser

---

## Architecture

```
User request
     │
     ▼
┌─────────────┐   blocked    ┌──────────────────────┐
│  Supervisor  │─────────────▶│ Guardrail Blocked    │──▶ END
│ + Guardrail  │              └──────────────────────┘
└──────┬───────┘
       │ allowed — routes only to the agents the request needs
       ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│Flight Agent │──▶│ Hotel Agent │──▶│Weather Agent│──▶│Budget Agent │
│  (MCP)      │   │   (MCP)     │   │   (MCP)     │   │             │
└─────────────┘   └─────────────┘   └─────────────┘   └──────┬──────┘
                                                                │
                                                                ▼
                                                      ┌───────────────────┐
                                                      │ Itinerary Agent   │
                                                      │ (drafts the plan) │
                                                      └─────────┬─────────┘
                                                                │
                                                                ▼
                                                      ┌───────────────────┐
                                                      │ Human Approval     │
                                                      │ (interrupt/resume) │
                                                      └─────────┬─────────┘
                                                                │
                                                                ▼
                                                      ┌───────────────────┐
                                                      │   Final Agent      │
                                                      │ (polished answer)  │
                                                      └─────────┬─────────┘
                                                                │
                                                                ▼
                                                               END
```

Every node reads from and writes to a single shared `TravelState`, and the whole graph is checkpointed to PostgreSQL after each step — so a paused human-approval step, or an interrupted session, can be resumed later using the same `thread_id`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Agent orchestration | [LangGraph](https://github.com/langchain-ai/langgraph) |
| LLM provider | [Groq](https://groq.com/) (`openai/gpt-oss-20b`) |
| Tool access | [MCP](https://modelcontextprotocol.io/) (Tavily, AviationStack, weather) |
| Backend API | [FastAPI](https://fastapi.tiangolo.com/) |
| Conversation memory | PostgreSQL (`PostgresSaver` checkpointer) |
| Frontend | HTML, CSS, vanilla JavaScript |
| PDF export | [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) |
| Markdown rendering | [marked.js](https://marked.js.org/) |
| Package management | [uv](https://github.com/astral-sh/uv) |

---

## Project Structure

```
Multi-Agent-Travel-Planner/
├── app.py                  # FastAPI app: routes, static/template mounting
├── backend.py               # LangGraph graph: agents, routing, checkpointing
├── route_resolver.py        # Offline city/country name -> IATA code resolution
├── mcp_client.py             # MCP client setup (Tavily, AviationStack, weather)
├── tools/                   # (legacy) earlier direct-API tool implementations
├── static/
│   ├── script.js            # Frontend logic: send, resume, approve, revise
│   └── style.css
├── templates/
│   └── index.html            # Main UI
├── src/multi_agent_travel_planner/
├── pyproject.toml / requirements.txt / uv.lock
└── README.md
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- [uv](https://github.com/astral-sh/uv) for dependency management
- A PostgreSQL database (e.g. a free [Render](https://render.com/) Postgres instance)
- API keys for:
  - [Groq](https://console.groq.com/) (LLM)
  - [Tavily](https://tavily.com/) (hotel/web search, via MCP)
  - [AviationStack](https://aviationstack.com/) (flight data, via MCP)
  - A weather API provider (used by the weather MCP tool)

### 1. Clone the repo

```bash
git clone https://github.com/riteshsal/Multi-Agent-Travel-Planner.git
cd Multi-Agent-Travel-Planner
```

### 2. Install dependencies

```bash
uv sync
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_groq_api_key
TAVILY_API_KEY=tvly-your_tavily_api_key
AVIATIONSTACK_API_KEY=your_aviationstack_api_key
DATABASE_URL=your_postgresql_connection_string
DEFAULT_ORIGIN_IATA=IND
```

### 4. Run the app

```bash
uv run uvicorn app:app --reload
```

The app will be available at **http://127.0.0.1:8000**.

---

## API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/` | Serves the main UI |
| `POST` | `/api/travel` | Submits a new travel request; returns either a final answer or an approval request |
| `POST` | `/api/resume` | Resumes a paused thread after the user approves or requests a revision |
| `GET` | `/health` | Health check |

**`POST /api/travel`** request body:
```json
{
  "message": "Plan a 7 day trip to Japan from Bangladesh under 2 lakhs",
  "thread_id": null
}
```

**`POST /api/resume`** request body:
```json
{
  "thread_id": "user_abc123",
  "approved": false,
  "feedback": "Make day 3 less packed and suggest a cheaper hotel."
}
```

---

## How the Agents Work

- **Supervisor + Guardrail** — a single LLM call first checks whether the request is a legitimate travel-planning request, then decides which of the specialist agents (flight, hotel, weather, budget) the request actually needs
- **Flight Agent** — resolves city/country names to IATA airport codes locally (`route_resolver.py`), then queries live flight schedule data via the AviationStack MCP tool
- **Hotel Agent** — searches for accommodation options via the Tavily MCP tool
- **Weather Agent** — fetches current conditions and forecast via a weather MCP tool
- **Budget Agent** — analyzes estimated costs against the user's stated budget and flags risk areas
- **Itinerary Agent** — synthesizes all specialist results into a draft day-by-day plan
- **Human Approval** — pauses the graph (`interrupt()`) and waits for the user to approve or request changes
- **Final Agent** — incorporates approval/feedback and produces the polished, final response

---

## Known Limitations

- The free AviationStack plan does not include the `airports`, `airlines`, or `routes` endpoints — only real-time flight schedule data is available, which the flight agent is scoped to use
- Conversation memory is tied to a browser-local `thread_id`, not a user account — clearing browser storage or switching devices starts a new conversation
- No rate limiting is currently implemented on `/api/travel`; deploying this publicly without one risks exhausting the LLM/API provider quotas

---

## Roadmap

- [ ] Per-user/IP rate limiting
- [ ] Move remaining direct-API tools fully to MCP-only
- [ ] Styled approval/revision UI matching the main theme
- [ ] Dockerfile + docker-compose for one-command local setup
- [ ] Usage/cost monitoring dashboard

---

## License

This project is licensed under the MIT License — see [LICENSE](./LICENSE) for details.

---

Built with FastAPI, LangGraph, Groq, PostgreSQL, Tavily, and AviationStack.