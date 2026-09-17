from backend.contracts import Action
from backend.jev import Answers, ChoiceAnswer, JevResponse, NavigationResult, NoulAnswer
from backend.navigation import movement_candidates
from backend.world import create_world


def navigation_result(action: Action = "advance", confidence: float = 0.9) -> NavigationResult:
    world = create_world()
    candidates = movement_candidates(world, world.start, world.checkpoints[0].position)
    return NavigationResult(
        response=JevResponse(
            model="test-jev",
            answers=Answers(
                navigation=ChoiceAnswer(
                    type="choice",
                    choice=action,
                    confidence=confidence,
                    probabilities={
                        candidate.action: float(candidate.action == action)
                        for candidate in candidates
                    },
                ),
                obstructed=NoulAnswer(type="noul", noul=0),
            ),
        ),
        latency_ms=100,
        state={},
    )
