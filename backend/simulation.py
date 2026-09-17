from pydantic import BaseModel, Field, JsonValue

from backend.contracts import Action, ControlAction, FlightStatus, Probability
from backend.jev import NavigationResult, TokenUsage
from backend.navigation import (
    COMMAND_SECONDS,
    CONFIDENCE_FLOOR,
    integrate_motion,
    movement_candidates,
)
from backend.world import Obstacle, Vector3, create_world


class Decision(BaseModel):
    sequence: int
    action: Action
    applied_action: Action
    confidence: Probability
    probabilities: dict[Action, Probability]
    obstructed: Probability
    latency_ms: float
    model: str
    note: str
    state: dict[str, JsonValue]
    usage: TokenUsage


class Snapshot(BaseModel):
    position: Vector3
    velocity: Vector3
    status: FlightStatus
    thinking: bool
    checkpoint_index: int
    elapsed: float
    distance_flown: float
    decisions: int
    interventions: int
    clearance: float
    error: str | None
    decision: Decision | None
    obstacles: list[Obstacle]
    obstacle_added: bool
    path: list[Vector3] = Field(default_factory=list)


class Simulation:
    def __init__(self) -> None:
        self.revision = 0
        self.reset()

    def reset(self) -> None:
        self.revision += 1
        self.world = create_world()
        self.position = self.world.start
        self.velocity = Vector3()
        self.desired_velocity = Vector3()
        self.status: FlightStatus = "ready"
        self.checkpoint_index = 0
        self.elapsed = 0.0
        self.distance_flown = 0.0
        self.decisions = 0
        self.interventions = 0
        self.consecutive_holds = 0
        self.command_expires = 0.0
        self.error: str | None = None
        self.decision: Decision | None = None
        self.path: list[Vector3] = [self.position]
        self.obstacle_added = False

    @property
    def needs_decision(self) -> bool:
        return self.status == "flying" and self.elapsed >= self.command_expires

    def invalidate_command(self) -> None:
        self.revision += 1
        self.command_expires = 0
        self.desired_velocity = Vector3()

    def control(self, action: ControlAction) -> None:
        if action == "reset":
            self.reset()
        elif action == "start" and self.status in {"ready", "paused"}:
            self.invalidate_command()
            self.status = "flying"
            self.error = None
            self.consecutive_holds = 0
        elif action == "pause":
            self.pause()
        elif action == "obstacle":
            self.add_obstacle()

    def pause(self) -> None:
        if self.status != "flying":
            return
        self.invalidate_command()
        self.status = "paused"
        self.velocity = Vector3()

    def add_obstacle(self) -> None:
        if self.status == "complete" or self.obstacle_added:
            return
        target = self.world.checkpoints[self.checkpoint_index].position
        direction = Vector3(x=target.x - self.position.x, z=target.z - self.position.z).unit()
        center = self.position.plus(direction.scaled(4.5))
        candidate = Obstacle(
            id="injected",
            center=Vector3(x=center.x, y=3, z=center.z),
            size=Vector3(x=2.8, y=6, z=2.8),
            color="#c29051",
        )
        # Keep the checkpoint volumes open so the mission stays achievable.
        if any(
            abs(point.position.x - center.x) < 2.5 and abs(point.position.z - center.z) < 2.5
            for point in self.world.checkpoints
        ):
            self.error = "Too close to a checkpoint to add a barrier. Try along the next leg."
            return
        if abs(center.x) > 16 or abs(center.z) > 16:
            self.error = "No room for a barrier here. Try farther inside the course."
            return
        self.world.obstacles.append(candidate)
        self.obstacle_added = True
        self.invalidate_command()
        self.error = None

    def advance(self, elapsed: float) -> None:
        if self.status != "flying":
            return
        self.elapsed += elapsed
        if self.elapsed >= self.command_expires:
            self.desired_velocity = Vector3()
        position, velocity, blocked = integrate_motion(
            self.world,
            self.position,
            self.velocity,
            self.desired_velocity,
            elapsed,
        )
        self.distance_flown += position.minus(self.position).length()
        self.position, self.velocity = position, velocity
        if blocked and self.desired_velocity.length() > 0:
            self.interventions += 1
            self.invalidate_command()
        if position.minus(self.path[-1]).length() > 0.35:
            self.path.append(position)
            self.path = self.path[-600:]
        target = self.world.checkpoints[self.checkpoint_index].position
        if position.minus(target).length() < 1.2:
            self.checkpoint_index += 1
            self.invalidate_command()
            if self.checkpoint_index == len(self.world.checkpoints):
                self.status = "complete"
                self.velocity = Vector3()

    def apply_decision(self, result: NavigationResult) -> None:
        if self.status != "flying":
            return
        answer = result.response.answers.navigation
        target = self.world.checkpoints[self.checkpoint_index].position
        candidates = movement_candidates(self.world, self.position, target)
        selected = next(candidate for candidate in candidates if candidate.action == answer.choice)
        applied = answer.choice
        note = "Jev selected this movement."
        if not selected.safe:
            applied = "hold"
            note = "Collision check rejected the selected movement. Hovering for a new decision."
            self.interventions += 1
        elif answer.confidence < CONFIDENCE_FLOOR:
            applied = "hold"
            note = "Model confidence below threshold. Hovering for a new decision."
            self.interventions += 1
        self.consecutive_holds = self.consecutive_holds + 1 if applied == "hold" else 0
        self.desired_velocity = selected.velocity if applied != "hold" else Vector3()
        self.command_expires = self.elapsed + COMMAND_SECONDS
        self.decisions += 1
        self.decision = Decision(
            sequence=self.decisions,
            action=answer.choice,
            applied_action=applied,
            confidence=answer.confidence,
            probabilities=answer.probabilities,
            obstructed=result.response.answers.obstructed.noul,
            latency_ms=round(result.latency_ms),
            model=result.response.model,
            note=note,
            state=result.state,
            usage=result.response.usage,
        )
        if self.consecutive_holds >= 6:
            self.pause()
            self.error = "Six consecutive holds. Flight paused; reset or resume to retry."

    def snapshot(self, *, thinking: bool = False) -> Snapshot:
        return Snapshot(
            position=self.position,
            velocity=self.velocity,
            status=self.status,
            thinking=thinking,
            checkpoint_index=self.checkpoint_index,
            elapsed=round(self.elapsed, 1),
            distance_flown=round(self.distance_flown, 1),
            decisions=self.decisions,
            interventions=self.interventions,
            clearance=round(self.world.clearance(self.position), 2),
            error=self.error,
            decision=self.decision,
            obstacles=self.world.obstacles,
            obstacle_added=self.obstacle_added,
            path=self.path,
        )
