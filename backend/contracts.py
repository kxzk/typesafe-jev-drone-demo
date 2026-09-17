from typing import Annotated, Literal

from pydantic import BaseModel, Field

Action = Literal[
    "advance",
    "veer_left",
    "veer_right",
    "climb_forward",
    "descend_forward",
    "climb",
    "slide_left",
    "slide_right",
    "hold",
]
FlightStatus = Literal["ready", "flying", "paused", "complete"]
ControlAction = Literal["start", "pause", "reset", "obstacle"]
Probability = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class ControlMessage(BaseModel):
    action: ControlAction


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    api_configured: bool
    model: str
