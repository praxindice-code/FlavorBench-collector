"""Portable annotation format compatible with FlavorBench session imports."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Action = Literal["add", "mix", "heat", "cut", "rest", "transfer", "observe", "serve"]
Evidence = Literal["observed", "instructed", "estimated"]
Seconds = Annotated[float, Field(ge=0, le=600, allow_inf_nan=False)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Ingredient(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    quantity_g: float | None = Field(default=None, gt=0, le=100000, allow_inf_nan=False)
    evidence: Evidence = "estimated"
    reviewed: bool = False
    preparation: Literal["unknown", "whole", "sliced", "diced", "chopped", "minced", "pureed", "ground"] = "unknown"


class Event(StrictModel):
    timestamp_s: Seconds | None = None
    action: Action = "observe"
    ingredient: str = Field(default="", max_length=120)
    vessel: str = Field(default="bowl", min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=1000)
    evidence: Evidence = "observed"
    confidence: Literal["low", "medium", "high"] = "low"
    reviewed: bool = False
    duration_s: float | None = Field(default=None, gt=0, le=172800, allow_inf_nan=False)
    target_temperature_c: float | None = Field(default=None, ge=-100, le=400, allow_inf_nan=False)
    particle_size_mm: float | None = Field(default=None, gt=0, le=1000, allow_inf_nan=False)


class Session(StrictModel):
    schema_version: Literal["1.1"] = "1.1"
    title: str = Field(default="Untitled cooking session", min_length=1, max_length=120)
    source_name: str = Field(default="", max_length=255)
    duration_s: Seconds = 0
    recipe_text: str = Field(default="", max_length=12000)
    ingredients: list[Ingredient] = Field(default_factory=list, max_length=80)
    events: list[Event] = Field(default_factory=list, max_length=200)
    analysis_model: str = Field(default="manual", max_length=150)

    @model_validator(mode="before")
    @classmethod
    def migrate_v1(cls, value):
        if isinstance(value, dict) and value.get("schema_version") == "1.0":
            return {**value, "schema_version": "1.1"}
        return value

    @model_validator(mode="after")
    def valid_timestamps(self):
        if any(e.timestamp_s is not None and e.timestamp_s > self.duration_s for e in self.events):
            raise ValueError("An event timestamp exceeds the clip duration.")
        return self
