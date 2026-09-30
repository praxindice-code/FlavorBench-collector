"""Authored demonstration cases; no video frames or sensory measurements."""
import json
from functools import lru_cache
from pathlib import Path

from .schema import Event, Ingredient, Session

CATALOG = Path(__file__).resolve().parents[1] / "examples" / "cases.json"


@lru_cache(maxsize=1)
def sample_cases() -> list[dict]:
    cases = json.loads(CATALOG.read_text(encoding="utf-8"))
    output = []
    for case in cases:
        ingredients = [Ingredient(
            name=row[0], quantity_g=row[1],
            preparation=row[2] if len(row) > 2 else "unknown",
            evidence="instructed", reviewed=True,
        ) for row in case["ingredients"]]
        steps = case.get("steps") or [
            {"action": "add", "ingredient": row[0], "vessel": "bowl",
             "description": f"Add {row[0]}."} for row in case["ingredients"]
        ] + [{"action": "mix", "ingredient": "mixture", "vessel": "bowl",
              "description": case["finish"]}]
        events = [Event(
            timestamp_s=None, action=step["action"],
            ingredient=step.get("ingredient", ""),
            vessel=step.get("vessel", "pan"),
            description=step["description"],
            evidence="instructed", confidence="high", reviewed=True,
            duration_s=step.get("duration_s"),
        ) for step in steps]
        amounts = ", ".join(f"{row[1]} g {row[0]}" for row in case["ingredients"])
        directions = " ".join(step["description"] for step in steps)
        session = Session(
            title=case["title"], source_name="Synthetic demonstration; no source media",
            duration_s=0, recipe_text=f"Illustrative ingredients: {amounts}. {directions}",
            ingredients=ingredients, events=events,
            analysis_model="authored illustrative case",
        )
        output.append({"id": case["id"], "description": case["description"],
                       "session": session.model_dump(mode="json")})
    return output
