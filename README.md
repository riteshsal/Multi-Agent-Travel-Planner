# ✈️ TripMate AI — Multi-Agent Travel Planner (LangGraph + MCP + Groq)

TripMate AI is a multi-agent travel-planning assistant. You describe a trip in plain English, for example *"Plan a 7 day Japan trip from Bangladesh including flights, hotels and sightseeing under 2 lakhs"*, and a LangGraph pipeline of specialist agents researches flights, hotels and weather, checks the plan against your budget, drafts an itinerary, and **pauses for your approval** before producing the final plan.

It combines a **Supervisor** that routes work, an **input guardrail** that filters requests, **MCP-based tools** for live data, and a **human-in-the-loop (HITL)** review step, all served through a FastAPI backend with a simple web UI.

## Key ideas

- **Supervisor-routed agents**: a supervisor reads each request and picks only the specialist agents it needs, instead of running a fixed pipeline every time.
- **Input guardrail**: an LLM check blocks off-topic or harmful requests before any agent or tool runs.
- **MCP tool access**: flights (AviationStack), hotels (Tavily) and weather are fetched through MCP servers rather than hand-written API wrappers.
- **Human-in-the-loop approval**: the graph stops after the draft itinerary using LangGraph's `interrupt()` and waits for you to approve or request changes.
- **Persistent state**: the whole graph is checkpointed to PostgreSQL per `thread_id`, so a paused review can be resumed later.

## Tech stack

| Layer | Technology |
| --- | --- |
| Agent orchestration | LangGraph |
| LLM | Groq, model `openai/gpt-oss-20b` (via `langchain_groq`) |
| Tools | MCP: Tavily (hotels), AviationStack (flights), custom weather MCP server |
| Backend API | FastAPI |
| Memory / checkpointing | PostgreSQL (`PostgresSaver`) |
| Frontend | HTML, CSS, vanilla JavaScript (Jinja2 template) |
| Dependency management | uv (`pyproject.toml`, `uv.lock`) or pip (`requirements.txt`) |

## How it works

```
User request
     │
     ▼
┌──────────────┐  blocked   ┌───────────────────┐
│  Supervisor   │──────────▶│ guardrail_blocked │──▶ END
│ + Guardrail   │            └───────────────────┘
└──────┬───────┘
       │ allowed: routes only to the agents the request needs
       ▼
 flight_agent ─▶ hotel_agent ─▶ weather_agent ─▶ budget_agent
   (MCP)           (MCP)           (MCP)            (LLM)
       └──────────────┴───────────────┴───────────────┘
                              │  (unselected agents are skipped)
                              ▼
                      itinerary_agent   (drafts the plan)
                              │
                              ▼
                      human_approval    (interrupt → resume)
                              │
                              ▼
                        final_agent     (polished answer)
                              │
                              ▼
                             END
```

All nodes read from and write to a single shared `TravelState`.

### The nodes

1. **Supervisor + guardrail** makes two LLM calls.
   - The guardrail returns `{allowed, reason}`. Blocked requests go to `guardrail_blocked` and end there.
   - The supervisor returns `selected_agents`, `trip_constraints` (destination, origin, duration, budget, travel style, special preferences) and its reasoning. `itinerary_agent` is always included.
   - If either response can't be parsed, the guardrail fails open and the supervisor falls back to running every agent.
2. **Flight agent** calls the AviationStack MCP tools for airport and airline data, then asks the LLM to turn it into route guidance: likely airports, airlines, typical duration, fare range, peak-season warnings and booking advice.
3. **Hotel agent** searches for accommodation through the Tavily MCP tool. If the search fails, it falls back to general advice clearly labelled as non-live.
4. **Weather agent** extracts the destination, then fetches current conditions and a forecast through the weather MCP tools. It also falls back gracefully if the tools are unavailable.
5. **Budget agent** compares the collected results with your budget and returns estimated cost categories, risk areas, saving tips and an overall feasibility verdict.
6. **Itinerary agent** combines every result into a day-by-day draft ready for review.
7. **Human approval** pauses the graph with `interrupt()` and returns the draft to the UI.
8. **Final agent** resumes with your decision. If you approved, it polishes the draft. If you asked for changes, it applies your feedback. The final answer has seven sections: Trip Summary, Flight Information, Hotel Suggestions, Weather Information, Day-by-Day Itinerary, Estimated Budget and Final Recommendations.

## Project structure

```
Multi-Agent-Travel-Planner/
├── app.py                          # FastAPI app: routes, static files, templates
├── backend.py                      # LangGraph graph: state, agents, routing, checkpointer
├── mcp_client.py                   # MCP client helpers (Tavily, AviationStack, weather)
├── custom_weather_mcp_server.py    # Example custom MCP server for weather
├── tools/                          # Earlier direct-API tools (backend.py now uses MCP instead)
├── templates/                      # index.html (main UI)
├── static/                         # Frontend JavaScript and CSS
├── pyproject.toml / uv.lock        # uv dependency files
├── requirements.txt                # pip dependency list
└── LICENSE
```

## Getting started

### Prerequisites

- Python 3.10+ (see `.python-version`)
- Git
- A PostgreSQL database (a free Render Postgres instance works well)
- API keys for Groq, Tavily and AviationStack, plus whatever your weather MCP server needs

### 1. Clone the repo

```powershell
git clone https://github.com/riteshsal/Multi-Agent-Travel-Planner.git
cd Multi-Agent-Travel-Planner
```

### 2. Create a virtual environment and install dependencies

Using uv:

```powershell
uv sync
```

Or using pip:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3. Configure environment variables

Create a `.env` file in the project root (never commit it):

```
GROQ_API_KEY=your_groq_api_key
DATABASE_URL=your_postgresql_connection_string
TAVILY_API_KEY=your_tavily_api_key
AVIATIONSTACK_API_KEY=your_aviationstack_api_key
```

`GROQ_API_KEY` and `DATABASE_URL` are required. The app raises an error at startup if either is missing. If the database URL has no `sslmode`, `sslmode=require` is added automatically. On first start, `PostgresSaver` creates its checkpoint tables.

### 4. Run the app

```powershell
# option A
python app.py

# option B
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000 in your browser to use the TripMate UI.

### Custom weather MCP server (optional)

`custom_weather_mcp_server.py` is the custom MCP server used for weather data. To run it on its own in a separate terminal:

```powershell
python custom_weather_mcp_server.py
```

## API endpoints

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/` | Serves the web UI |
| `POST` | `/api/travel` | Starts a new travel request; returns the draft itinerary and pauses for approval, or a guardrail message |
| `POST` | `/api/travel/approve` | Resumes a paused thread with your approval or revision feedback |
| `GET` | `/health` | Health check |

**`POST /api/travel`**

```json
{
  "message": "Plan a 7 day trip to Japan from Bangladesh under 2 lakhs",
  "thread_id": null
}
```

Leave `thread_id` empty to start a new conversation. The response includes the `thread_id` to reuse, the `answer` (the draft itinerary while waiting for approval), `requires_approval`, the per-agent results (`flight_results`, `hotel_results`, `weather_results`, `budget_results`), `selected_agents`, `trip_constraints`, `supervisor_reasoning`, guardrail status and `llm_calls`.

**`POST /api/travel/approve`**

```json
{
  "thread_id": "user_abc123",
  "approved": false,
  "feedback": "Make day 3 less packed and suggest a cheaper hotel."
}
```

Set `approved` to `true` to finalize the draft as it is, or `false` with `feedback` to have the final agent apply your changes.

## Configuration notes

- Secrets are never stored in the repo. Keep them in `.env` or your environment variables.
- The graph (and its PostgreSQL connection) is created when `backend.py` is imported, so the database must be reachable before the app starts.
- The sync agent nodes call async MCP helpers with `asyncio.run`. Because the FastAPI server is async, `nest_asyncio` is applied in `app.py` to make this work.
- Conversation memory is keyed by `thread_id`, not by user account.

## Known limitations

- Flight output is route guidance built from the available AviationStack data. Live ticket prices may not be available, and the final answer says so.
- A revision request is applied in a single pass by the final agent. It does not loop back through the specialist agents.
- LLM output varies between runs, so budgets and itineraries are estimates to review, not booking-ready quotes.
- The guardrail fails open: if its response can't be parsed, the request is allowed through.
- There are no automated tests yet. Try the UI or call the endpoints directly.

## Contributing

Contributions are welcome. Please open an issue or pull request for bug fixes, documentation improvements or new MCP adapters.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgements

Built with [LangGraph](https://github.com/langchain-ai/langgraph), [MCP](https://modelcontextprotocol.io/), [Groq](https://groq.com/), [FastAPI](https://fastapi.tiangolo.com/), [Tavily](https://tavily.com/) and [AviationStack](https://aviationstack.com/).
