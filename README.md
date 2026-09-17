# Jev Flight Lab

A live Three.js drone simulation with a fully typed Python/FastAPI backend. TypeSafe's `jev-latest` chooses each navigation action; its actual probabilities, confidence, latency, model input, and output are visible beside the flight.

## Run

Requires Node.js 20.19+ (or 22.12+) and [uv](https://docs.astral.sh/uv/).

```sh
uv sync
npm install
cp .env.example .env  # Only on a fresh checkout; preserve an existing .env.
```

Set `TYPESAFE_API_KEY` in `.env`. Environment files are ignored by Git; only the empty `.env.example` is tracked. The key is never sent to the browser.

```sh
npm run build
uv run uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000** and select **Start flight**. The Python process serves both the built frontend and API. Rebuild and restart it after frontend changes.

For development, run the backend above and `npm run dev` in a second terminal. Open **http://127.0.0.1:5173**; Vite proxies the API and WebSocket to Python.

## Try it

- Fly through four checkpoints; the bright trail shows the actual path.
- Switch between orbit, follow, and overhead cameras. Drag and scroll in orbit mode.
- Add a barrier to change the scene and force a fresh model decision. Reset removes it.
- Inspect the live **Choice** distribution and **Noul** obstruction estimate.
- Select **Inspect** to see exactly what Jev received and returned in a contained dialog.
- Pause immediately or reset the course. Switching away from the tab pauses flight. Reconnecting starts a new, idle simulation.

The workspace uses the available browser viewport without page scrolling. On narrow or short windows, it prioritizes the scene, flight controls, and decision summary; the complete probabilities remain available in Inspect. The JSON inspector scrolls internally so it never expands the page.

## How the model flies

1. Python owns world geometry, position, velocity, and checkpoint progress.
2. It predicts nine short candidate movements: advance, left/right detours, climb, descend, sideways moves, and hover. Each includes swept collision clearance, predicted endpoint, and progress toward the checkpoint.
3. That structured state goes to `POST https://api.typesafe.ai/v1/systemone`. A **Choice** question selects the next action; an independent **Noul** question estimates whether the direct route is blocked.
4. Python validates the typed response and rechecks the chosen movement against the current world. If the action is blocked or confidence is below 0.12, it hovers. It never substitutes a heuristic navigation decision for a failed model request.
5. The selected velocity is applied for 1.15 seconds with a smoothed velocity controller. Physics ticks at about 30 Hz; telemetry streams at about 10 Hz. When a command expires, motion decelerates while the next answer is pending.
6. Three.js interpolates the telemetry for rendering. Checkpoint completion, collisions, and movement remain authoritative on the backend.

Jev receives numeric/textual state, **not images or video**. This is a simulation with perfect geometric observations and simplified motion, not a real aircraft controller. Hovering between model calls, geometric candidate generation, and collision rejection are visible parts of the design. Confidence is the API's distribution statistic, not a calibrated probability of safe flight. The Noul estimate is displayed for inspection; deterministic geometry enforces collision checks.

There is no offline fake-model mode. Authentication, timeout, and malformed-response failures pause the flight with an error. Rate limits/overload retry twice with backoff. Six consecutive holds pause a stalled flight. Each connected flight session allows at most 150 navigation requests (retries can add HTTP calls); resetting does not clear that counter. Flights consume real API credits only while running. Each browser tab has its own session.

## Code map

| File | Responsibility |
| --- | --- |
| `backend/jev.py` | Request schema, typed answers, validation, API errors and retries |
| `backend/navigation.py` | Candidate movements and motion/collision controller |
| `backend/world.py` | Course geometry, checkpoints, and clearance calculations |
| `backend/contracts.py` | Closed navigation/control types and API health contract |
| `backend/simulation.py` | Deterministic flight state, control transitions, command application |
| `backend/session.py` | Asynchronous model requests, request budget, physics clock, stale-result rejection |
| `backend/app.py` | FastAPI routes, WebSocket lifecycle, static frontend |
| `frontend/contracts.ts` | Runtime validation and inferred TypeScript types |
| `frontend/connection.ts` | WebSocket transport, validation, reconnection, teardown |
| `frontend/scene.ts` | Scene lifecycle, cameras, telemetry interpolation, animation |
| `frontend/scene/objects.ts` | Geometry construction |
| `frontend/scene/resources.ts` | Geometry, material, and texture disposal |
| `frontend/view.ts` | Controls and presentation using validated telemetry |
| `frontend/layout.html` | Interface structure |
| `frontend/main.ts` | Application composition and lifecycle |

## Checks

```sh
uv run pytest -q
uv run mypy backend scripts tests
uv run ruff check backend scripts tests
npm run build
npm test
```

With the backend running, these checks fly complete missions using the real API and consume credits:

```sh
uv run python -m scripts.check_live
uv run python -m scripts.check_live --barrier
```

Frontend contract tests consume actual Python-serialized fixtures to detect drift between the two languages. Runtime checks reject malformed telemetry before it reaches the scene. The optional WebMCP experiment was removed during the maintainability review; flight controls use one validated transport path.

The completed maintainability audit and verification evidence are in [REVIEW.md](REVIEW.md).

Built against the [TypeSafe HTTP API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), and [state format](https://docs.typesafe.ai/concepts/state) documentation. The server binds to loopback and allows local browser origins; remote deployment and real drone integration are outside this demo.
