import argparse
import asyncio
import json
import time

import httpx
from websockets.asyncio.client import connect

from backend.simulation import Snapshot


async def check_flight(add_barrier: bool) -> None:
    async with httpx.AsyncClient() as client:
        health = await client.get("http://127.0.0.1:8000/api/health")
        health.raise_for_status()
        if not health.json()["api_configured"]:
            raise RuntimeError("No TypeSafe API key configured")
    async with connect("ws://127.0.0.1:8000/ws/flight") as socket:
        initial = Snapshot.model_validate_json(await socket.recv())
        assert initial.status == "ready"
        if add_barrier:
            await socket.send(json.dumps({"action": "obstacle"}))
        await socket.send(json.dumps({"action": "start"}))
        deadline = time.monotonic() + 240
        sequence = 0
        async with asyncio.timeout(245):
            async for message in socket:
                snapshot = Snapshot.model_validate_json(message)
                if snapshot.decision and snapshot.decision.sequence != sequence:
                    decision = snapshot.decision
                    sequence = decision.sequence
                    print(
                        json.dumps(
                            {
                                "decision": sequence,
                                "action": decision.action,
                                "applied": decision.applied_action,
                                "confidence": round(decision.confidence, 3),
                                "latency_ms": decision.latency_ms,
                                "checkpoint": snapshot.checkpoint_index,
                                "position": {
                                    key: round(value, 2)
                                    for key, value in snapshot.position.model_dump().items()
                                },
                            }
                        ),
                        flush=True,
                    )
                if snapshot.error:
                    raise RuntimeError(snapshot.error)
                if snapshot.status == "complete":
                    assert snapshot.distance_flown > 30
                    assert snapshot.checkpoint_index == 4
                    print(
                        json.dumps(
                            {
                                "result": "complete",
                                "decisions": sequence,
                                "distance_m": snapshot.distance_flown,
                                "elapsed_s": snapshot.elapsed,
                                "interventions": snapshot.interventions,
                            }
                        ),
                        flush=True,
                    )
                    return
                if time.monotonic() > deadline:
                    await socket.send(json.dumps({"action": "pause"}))
                    raise TimeoutError("Flight did not finish within four minutes")
    raise RuntimeError("Flight connection closed before completion")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a real Jev flight; consumes API credits.")
    parser.add_argument("--barrier", action="store_true", help="Inject a barrier before takeoff")
    arguments = parser.parse_args()
    asyncio.run(check_flight(arguments.barrier))


if __name__ == "__main__":
    main()
