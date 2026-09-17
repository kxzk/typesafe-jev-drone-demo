import math

from pydantic import BaseModel, ConfigDict


class Vector3(BaseModel):
    model_config = ConfigDict(frozen=True, allow_inf_nan=False)
    x: float = 0
    y: float = 0
    z: float = 0

    def plus(self, other: "Vector3") -> "Vector3":
        return Vector3(x=self.x + other.x, y=self.y + other.y, z=self.z + other.z)

    def minus(self, other: "Vector3") -> "Vector3":
        return Vector3(x=self.x - other.x, y=self.y - other.y, z=self.z - other.z)

    def scaled(self, scale: float) -> "Vector3":
        return Vector3(x=self.x * scale, y=self.y * scale, z=self.z * scale)

    def length(self) -> float:
        return math.sqrt(self.x**2 + self.y**2 + self.z**2)

    def unit(self) -> "Vector3":
        return self.scaled(1 / max(self.length(), 0.0001))


class Obstacle(BaseModel):
    id: str
    center: Vector3
    size: Vector3
    color: str = "#536168"


class Checkpoint(BaseModel):
    name: str
    position: Vector3


class World(BaseModel):
    start: Vector3
    checkpoints: list[Checkpoint]
    obstacles: list[Obstacle]
    boundary: float = 19
    ceiling: float = 13
    drone_radius: float = 0.65

    def clearance(self, position: Vector3) -> float:
        distances = [
            self.boundary - abs(position.x),
            self.boundary - abs(position.z),
            position.y - 0.25,
            self.ceiling - position.y,
        ]
        for obstacle in self.obstacles:
            delta = position.minus(obstacle.center)
            distances.append(
                math.sqrt(
                    max(abs(delta.x) - obstacle.size.x / 2, 0) ** 2
                    + max(abs(delta.y) - obstacle.size.y / 2, 0) ** 2
                    + max(abs(delta.z) - obstacle.size.z / 2, 0) ** 2
                )
            )
        return min(distances) - self.drone_radius

    def path_clearance(self, start: Vector3, end: Vector3) -> float:
        delta = end.minus(start)
        samples = max(1, math.ceil(delta.length() / 0.15))
        return min(
            self.clearance(start.plus(delta.scaled(i / samples))) for i in range(samples + 1)
        )


def create_world() -> World:
    return World(
        start=Vector3(x=-13, y=2.2, z=12),
        checkpoints=[
            Checkpoint(name="Lift corridor", position=Vector3(x=-11, y=4.5, z=1)),
            Checkpoint(name="Tower passage", position=Vector3(x=1, y=5, z=-10)),
            Checkpoint(name="East approach", position=Vector3(x=12, y=4, z=-1)),
            Checkpoint(name="Landing approach", position=Vector3(x=8, y=2.2, z=12)),
        ],
        obstacles=[
            Obstacle(id="tower-a", center=Vector3(x=-4, y=3.5, z=1), size=Vector3(x=5, y=7, z=6)),
            Obstacle(id="tower-b", center=Vector3(x=5, y=4.5, z=-3), size=Vector3(x=4, y=9, z=5)),
            Obstacle(id="depot-a", center=Vector3(x=-13, y=1.5, z=-9), size=Vector3(x=5, y=3, z=5)),
            Obstacle(
                id="depot-b", center=Vector3(x=1, y=1.25, z=10), size=Vector3(x=5, y=2.5, z=4)
            ),
            Obstacle(id="depot-c", center=Vector3(x=14, y=2, z=-12), size=Vector3(x=4, y=4, z=5)),
            Obstacle(
                id="barrier",
                center=Vector3(x=-11, y=1.8, z=6),
                size=Vector3(x=4, y=3.6, z=1.5),
                color="#a58151",
            ),
            Obstacle(id="depot-d", center=Vector3(x=14, y=1.3, z=7), size=Vector3(x=3, y=2.6, z=4)),
        ],
    )
