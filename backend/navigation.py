import math

from pydantic import BaseModel

from backend.contracts import Action
from backend.world import Vector3, World

COMMAND_SECONDS = 1.15
CRUISE_SPEED = 2.7
CONFIDENCE_FLOOR = 0.12


class Candidate(BaseModel):
    action: Action
    description: str
    velocity: Vector3
    endpoint: Vector3
    clearance_m: float
    progress_m: float
    distance_to_target_m: float
    safe: bool


def movement_candidates(world: World, position: Vector3, target: Vector3) -> list[Candidate]:
    delta = target.minus(position)
    forward = delta.unit()
    horizontal = Vector3(x=delta.x, z=delta.z).unit()
    left = Vector3(x=horizontal.z, z=-horizontal.x)
    directions: list[tuple[Action, str, Vector3]] = [
        ("advance", "Fly directly toward the checkpoint", forward),
        ("veer_left", "Go forward and left around an obstruction", forward.plus(left).unit()),
        ("veer_right", "Go forward and right around an obstruction", forward.minus(left).unit()),
        (
            "climb_forward",
            "Gain altitude while moving toward the checkpoint",
            horizontal.plus(Vector3(y=1)).unit(),
        ),
        (
            "descend_forward",
            "Lose altitude while moving toward the checkpoint",
            horizontal.plus(Vector3(y=-0.7)).unit(),
        ),
        ("climb", "Rise vertically to clear an obstruction", Vector3(y=1)),
        ("slide_left", "Move sideways to the left to find a passage", left),
        ("slide_right", "Move sideways to the right to find a passage", left.scaled(-1)),
        ("hold", "Hover when no safe movement is available", Vector3()),
    ]
    candidates: list[Candidate] = []
    speed = min(CRUISE_SPEED, delta.length() / COMMAND_SECONDS)
    for action, description, direction in directions:
        velocity = direction.scaled(speed)
        endpoint = position.plus(velocity.scaled(COMMAND_SECONDS))
        clearance = world.path_clearance(position, endpoint)
        distance = endpoint.minus(target).length()
        candidates.append(
            Candidate(
                action=action,
                description=description,
                velocity=velocity,
                endpoint=endpoint,
                clearance_m=round(clearance, 2),
                progress_m=round(delta.length() - distance, 2),
                distance_to_target_m=round(distance, 2),
                safe=clearance >= 0.15,
            )
        )
    return candidates


def integrate_motion(
    world: World,
    position: Vector3,
    velocity: Vector3,
    desired: Vector3,
    elapsed: float,
) -> tuple[Vector3, Vector3, bool]:
    blend = 1 - math.exp(-elapsed * 7)
    next_velocity = velocity.plus(desired.minus(velocity).scaled(blend))
    next_position = position.plus(next_velocity.scaled(elapsed))
    if world.path_clearance(position, next_position) < 0.08:
        return position, Vector3(), True
    return next_position, next_velocity, False
