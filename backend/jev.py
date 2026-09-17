import asyncio
import time
from pathlib import Path
from typing import Literal, get_args

import httpx
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from backend.contracts import Action, Probability
from backend.navigation import COMMAND_SECONDS, Candidate
from backend.world import Vector3


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env", extra="ignore"
    )
    typesafe_api_key: str = ""
    typesafe_model: str = "jev-latest"


class ChoiceAnswer(BaseModel):
    type: Literal["choice"]
    choice: Action
    probabilities: dict[Action, Probability]
    confidence: Probability

    @model_validator(mode="after")
    def validate_distribution(self) -> "ChoiceAnswer":
        if set(self.probabilities) != set(get_args(Action)):
            raise ValueError("Expected a probability for every navigation action")
        if abs(sum(self.probabilities.values()) - 1) > 0.03:
            raise ValueError("Invalid probability distribution")
        if self.probabilities[self.choice] < max(self.probabilities.values()):
            raise ValueError("Chosen action is not a highest-probability action")
        return self


class NoulAnswer(BaseModel):
    type: Literal["noul"]
    noul: Probability


class Answers(BaseModel):
    navigation: ChoiceAnswer
    obstructed: NoulAnswer


class TokenUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class JevResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    model: str
    answers: Answers
    usage: TokenUsage = Field(default_factory=TokenUsage)


class NavigationResult(BaseModel):
    response: JevResponse
    latency_ms: float
    state: dict[str, JsonValue]


class NavigationError(Exception):
    pass


class JevNavigator:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client

    async def decide(
        self,
        position: Vector3,
        target: Vector3,
        candidates: list[Candidate],
        previous_action: Action,
    ) -> NavigationResult:
        if not self.settings.typesafe_api_key:
            raise NavigationError("Add TYPESAFE_API_KEY to .env and restart the backend.")
        state: dict[str, JsonValue] = {
            "task": "Navigate a simulated drone to the next checkpoint without hitting obstacles.",
            "position_m": position.model_dump(mode="json"),
            "target_m": target.model_dump(mode="json"),
            "previous_action": previous_action,
            "command_duration_s": COMMAND_SECONDS,
            "candidates": [candidate.model_dump(mode="json") for candidate in candidates],
            "interpretation": (
                "safe=false means the entire swept movement is blocked: do not select it. "
                "progress_m is reduction in distance to checkpoint; higher is better. "
                "clearance_m includes drone radius; positive means no predicted collision. "
                "If direct travel is blocked, detour or climb. Continue the previous detour "
                "when left and right are equally useful. Hold only if every movement is unsafe."
            ),
        }
        payload: dict[str, JsonValue] = {
            "model": self.settings.typesafe_model,
            "state": state,
            "questions": {
                "navigation": {
                    "type": "choice",
                    "instructions": (
                        "Which single safe movement best advances this drone toward its "
                        "checkpoint? Prefer advance if safe. If blocked, choose a safe "
                        "detour with good progress and clearance. Never choose an unsafe action."
                    ),
                    "criteria": {
                        candidate.action: candidate.description for candidate in candidates
                    },
                },
                "obstructed": {
                    "type": "noul",
                    "instructions": "Is the direct advance candidate blocked (safe=false)?",
                },
            },
        }
        started = time.monotonic()
        for attempt in range(3):
            try:
                response = await self.client.post(
                    "https://api.typesafe.ai/v1/systemone",
                    headers={"Authorization": f"Bearer {self.settings.typesafe_api_key}"},
                    json=payload,
                )
            except httpx.RequestError as error:
                raise NavigationError(
                    "TypeSafe could not be reached. Flight paused; try again."
                ) from error
            if response.status_code in {429, 529} and attempt < 2:
                await asyncio.sleep(2**attempt)
                continue
            if response.status_code == 401:
                raise NavigationError("TypeSafe rejected the API key. Update .env and restart.")
            if response.is_error:
                raise NavigationError(
                    f"TypeSafe returned HTTP {response.status_code}. Flight paused."
                )
            try:
                parsed = JevResponse.model_validate_json(response.content)
            except ValidationError as error:
                raise NavigationError(
                    "TypeSafe returned an invalid answer. Flight paused."
                ) from error
            return NavigationResult(
                response=parsed,
                state=state,
                latency_ms=(time.monotonic() - started) * 1000,
            )
        raise NavigationError("TypeSafe is busy. Flight paused; try again shortly.")
