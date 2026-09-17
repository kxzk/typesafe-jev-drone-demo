import asyncio
import time

from backend.jev import JevNavigator, NavigationError
from backend.navigation import movement_candidates
from backend.simulation import Simulation, Snapshot


class FlightSession:
    def __init__(self, navigator: JevNavigator) -> None:
        self.navigator = navigator
        self.simulation = Simulation()
        self.request_count = 0
        self.pending_revision: int | None = None

    def snapshot(self) -> Snapshot:
        return self.simulation.snapshot(
            thinking=(
                self.pending_revision == self.simulation.revision
                and self.simulation.status == "flying"
            )
        )

    async def decide_next(self) -> None:
        simulation = self.simulation
        if not simulation.needs_decision or self.pending_revision is not None:
            return
        if self.request_count >= 150:
            simulation.pause()
            simulation.error = "Session request limit reached. Reload to start a new session."
            return
        revision = simulation.revision
        target = simulation.world.checkpoints[simulation.checkpoint_index].position
        candidates = movement_candidates(simulation.world, simulation.position, target)
        self.pending_revision = revision
        self.request_count += 1
        try:
            result = await self.navigator.decide(
                simulation.position,
                target,
                candidates,
                simulation.decision.applied_action if simulation.decision else "hold",
            )
            if revision == simulation.revision:
                simulation.apply_decision(result)
        except NavigationError as error:
            if revision == simulation.revision:
                simulation.pause()
                simulation.error = str(error)
        finally:
            self.pending_revision = None

    async def navigate(self) -> None:
        while True:
            await self.decide_next()
            await asyncio.sleep(0.05)

    async def simulate(self) -> None:
        previous_tick = time.monotonic()
        while True:
            now = time.monotonic()
            self.simulation.advance(min(now - previous_tick, 0.1))
            previous_tick = now
            await asyncio.sleep(1 / 30)
