import json

from backend.contracts import Health
from backend.simulation import Simulation
from tests.helpers import navigation_result


def main() -> None:
    simulation = Simulation()
    ready = simulation.snapshot().model_dump(mode="json")
    simulation.control("start")
    simulation.apply_decision(navigation_result())
    print(
        json.dumps(
            {
                "health": Health(api_configured=True, model="test-jev").model_dump(mode="json"),
                "world": simulation.world.model_dump(mode="json"),
                "ready": ready,
                "flying": simulation.snapshot().model_dump(mode="json"),
            }
        )
    )


if __name__ == "__main__":
    main()
