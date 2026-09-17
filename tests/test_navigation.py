import math

import pytest

from backend.contracts import ControlAction
from backend.jev import ChoiceAnswer
from backend.navigation import COMMAND_SECONDS, integrate_motion, movement_candidates
from backend.simulation import Simulation
from backend.world import Obstacle, Vector3, create_world
from tests.helpers import navigation_result


def test_swept_collision_catches_thin_wall() -> None:
    world = create_world()
    world.obstacles = [Obstacle(id="wall", center=Vector3(y=3), size=Vector3(x=0.1, y=6, z=6))]
    assert world.clearance(Vector3(x=-4, y=3)) > 0
    assert world.clearance(Vector3(x=4, y=3)) > 0
    assert world.path_clearance(Vector3(x=-4, y=3), Vector3(x=4, y=3)) < 0


def test_collision_controller_stops_motion_through_wall() -> None:
    world = create_world()
    position = Vector3(x=-7.3, y=3, z=1)
    next_position, velocity, blocked = integrate_motion(
        world,
        position,
        Vector3(x=10),
        Vector3(x=10),
        0.1,
    )
    assert blocked
    assert next_position == position
    assert velocity.length() == 0


def test_candidates_account_for_bounds_and_obstacles() -> None:
    candidates = movement_candidates(
        create_world(),
        Vector3(x=-8, y=3, z=1),
        Vector3(x=0, y=3, z=1),
    )
    assert not next(candidate for candidate in candidates if candidate.action == "advance").safe
    assert any(candidate.safe and candidate.action != "hold" for candidate in candidates)
    assert all(math.isfinite(candidate.progress_m) for candidate in candidates)


def test_left_and_right_match_the_y_up_world_coordinates() -> None:
    candidates = movement_candidates(
        create_world(),
        Vector3(y=10),
        Vector3(y=10, z=-10),
    )
    left = next(candidate for candidate in candidates if candidate.action == "slide_left")
    right = next(candidate for candidate in candidates if candidate.action == "slide_right")
    assert left.velocity.x < 0
    assert right.velocity.x > 0


def test_low_confidence_hovers() -> None:
    simulation = Simulation()
    simulation.control("start")
    simulation.apply_decision(navigation_result(confidence=0.01))
    assert simulation.desired_velocity.length() == 0
    assert simulation.decision is not None
    assert simulation.decision.applied_action == "hold"
    assert simulation.interventions == 1


def test_pause_stops_immediately_and_repeated_start_is_noop() -> None:
    simulation = Simulation()
    simulation.control("start")
    revision = simulation.revision
    simulation.control("start")
    assert simulation.revision == revision
    simulation.velocity = Vector3(x=2)
    simulation.pause()
    assert simulation.velocity.length() == 0
    assert simulation.status == "paused"


@pytest.mark.parametrize("control", ["start", "pause", "obstacle"])
def test_complete_is_terminal_until_reset(control: ControlAction) -> None:
    simulation = Simulation()
    simulation.control("start")
    for checkpoint in simulation.world.checkpoints:
        simulation.position = checkpoint.position
        simulation.advance(0.01)
    assert simulation.status == "complete"
    revision = simulation.revision
    simulation.control(control)
    simulation.advance(1)
    simulation.apply_decision(navigation_result())
    assert simulation.status == "complete"
    assert simulation.revision == revision
    assert simulation.decision is None
    simulation.control("reset")
    assert simulation.snapshot().status == "ready"
    assert simulation.checkpoint_index == 0


def test_command_expiry_uses_simulation_time() -> None:
    simulation = Simulation()
    simulation.control("start")
    simulation.apply_decision(navigation_result())
    assert not simulation.needs_decision
    for _ in range(40):
        simulation.advance(COMMAND_SECONDS / 39)
    assert simulation.needs_decision
    assert simulation.desired_velocity.length() == 0


def test_model_action_rechecked_against_changed_world() -> None:
    simulation = Simulation()
    simulation.control("start")
    simulation.world.obstacles.append(
        Obstacle(
            id="new-wall",
            center=Vector3(x=-13, y=3, z=10),
            size=Vector3(x=3, y=6, z=0.5),
        )
    )
    simulation.apply_decision(navigation_result())
    assert simulation.desired_velocity.length() == 0
    assert simulation.decision is not None
    assert simulation.decision.action == "advance"
    assert simulation.decision.applied_action == "hold"
    assert simulation.interventions == 1


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -0.1, 1.1])
def test_invalid_model_probability_rejected(value: float) -> None:
    answer = navigation_result().response.answers.navigation.model_dump()
    answer["probabilities"]["advance"] = value
    with pytest.raises(ValueError):
        ChoiceAnswer.model_validate(answer)


def test_incomplete_distribution_and_nonmaximal_choice_rejected() -> None:
    answer = navigation_result().response.answers.navigation.model_dump()
    answer["choice"] = "climb"
    with pytest.raises(ValueError, match="highest-probability"):
        ChoiceAnswer.model_validate(answer)
    del answer["probabilities"]["climb"]
    with pytest.raises(ValueError, match="every navigation action"):
        ChoiceAnswer.model_validate(answer)
