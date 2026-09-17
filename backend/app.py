import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.middleware.trustedhost import TrustedHostMiddleware

from backend.contracts import ControlMessage, Health
from backend.jev import JevNavigator, Settings
from backend.session import FlightSession
from backend.simulation import Simulation
from backend.world import World, create_world

ROOT = Path(__file__).resolve().parent.parent
settings = Settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with httpx.AsyncClient(timeout=20) as client:
        app.state.navigator = JevNavigator(settings, client)
        yield


app = FastAPI(title="Jev Flight Lab", lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])


@app.get("/api/health")
async def health() -> Health:
    return Health(api_configured=bool(settings.typesafe_api_key), model=settings.typesafe_model)


@app.get("/api/world")
async def world() -> World:
    return create_world()


async def receive_controls(socket: WebSocket, simulation: Simulation) -> None:
    while True:
        try:
            command = ControlMessage.model_validate_json(await socket.receive_text())
        except ValidationError:
            continue
        simulation.control(command.action)


async def stream_flight(socket: WebSocket, session: FlightSession) -> None:
    while True:
        await socket.send_text(session.snapshot().model_dump_json())
        await asyncio.sleep(0.1)


@app.websocket("/ws/flight")
async def flight(socket: WebSocket) -> None:
    origin = socket.headers.get("origin")
    if origin and urlparse(origin).netloc not in {
        "127.0.0.1:8000",
        "localhost:8000",
        "127.0.0.1:5173",
        "localhost:5173",
    }:
        await socket.close(code=1008)
        return
    await socket.accept()
    session = FlightSession(socket.app.state.navigator)
    tasks = [
        asyncio.create_task(receive_controls(socket, session.simulation)),
        asyncio.create_task(stream_flight(socket, session)),
        asyncio.create_task(session.navigate()),
        asyncio.create_task(session.simulate()),
    ]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app.mount(
    "/assets", StaticFiles(directory=ROOT / "dist" / "assets", check_dir=False), name="assets"
)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(ROOT / "dist" / "index.html")
