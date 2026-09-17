import asyncio

import httpx
import pytest

from backend.contracts import ControlAction
from backend.jev import JevNavigator, Settings
from backend.session import FlightSession
from tests.helpers import navigation_result


@pytest.mark.asyncio
@pytest.mark.parametrize("control", ["pause", "reset", "obstacle"])
async def test_pending_answer_cannot_override_new_control(control: ControlAction) -> None:
    request_started = asyncio.Event()
    release_response = asyncio.Event()

    async def delayed_response(request: httpx.Request) -> httpx.Response:
        request_started.set()
        await release_response.wait()
        return httpx.Response(200, json=navigation_result().response.model_dump(mode="json"))

    async with httpx.AsyncClient(transport=httpx.MockTransport(delayed_response)) as client:
        session = FlightSession(JevNavigator(Settings(typesafe_api_key="test"), client))
        simulation = session.simulation
        simulation.control("start")
        task = asyncio.create_task(session.decide_next())
        try:
            await asyncio.wait_for(request_started.wait(), timeout=1)
            assert session.snapshot().thinking
            simulation.control(control)
            assert not session.snapshot().thinking
            release_response.set()
            await asyncio.wait_for(task, timeout=1)
            assert simulation.decision is None
            assert simulation.desired_velocity.length() == 0
            assert simulation.position == simulation.world.start
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_reset_keeps_session_request_budget_and_removes_barrier() -> None:
    async with httpx.AsyncClient() as client:
        session = FlightSession(JevNavigator(Settings(typesafe_api_key="test"), client))
        session.request_count = 150
        simulation = session.simulation
        simulation.control("obstacle")
        assert simulation.obstacle_added
        simulation.control("reset")
        assert not simulation.obstacle_added
        assert len(simulation.world.obstacles) == 7
        simulation.control("start")
        await session.decide_next()
        assert session.request_count == 150
        assert simulation.status == "paused"
        assert simulation.error and "limit" in simulation.error


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 500])
async def test_api_failure_pauses_without_fake_navigation(status: int) -> None:
    def reject_request(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test"
        return httpx.Response(status, json={"error": "test failure"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(reject_request)) as client:
        session = FlightSession(JevNavigator(Settings(typesafe_api_key="test"), client))
        session.simulation.control("start")
        await session.decide_next()
        assert session.simulation.status == "paused"
        assert session.simulation.error
        assert session.simulation.decision is None
        assert not session.snapshot().thinking


@pytest.mark.asyncio
async def test_valid_api_response_drives_motion_and_request_cadence() -> None:
    def answer_request(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/systemone"
        return httpx.Response(200, json=navigation_result().response.model_dump(mode="json"))

    async with httpx.AsyncClient(transport=httpx.MockTransport(answer_request)) as client:
        session = FlightSession(JevNavigator(Settings(typesafe_api_key="test"), client))
        session.simulation.control("start")
        await session.decide_next()
        await session.decide_next()
        assert session.request_count == 1
        session.simulation.advance(0.1)
        assert session.simulation.position != session.simulation.world.start
        assert session.simulation.desired_velocity.length() > 0
