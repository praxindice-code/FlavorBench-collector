"""Optional loopback bridge to a separately running FlavorBench research engine."""
from typing import Literal

import httpx
from fastapi import HTTPException

from .cases import sample_cases
from .schema import Session, StrictModel

ENGINE = "http://127.0.0.1:8000"


class FlavorRequest(StrictModel):
    session: Session
    case_id: str | None = None
    residual: Literal["none", "mamba"] = "none"


def engine_status():
    try:
        with httpx.Client(timeout=3, trust_env=False) as client:
            response = client.get(f"{ENGINE}/health")
            response.raise_for_status()
            return {"available": response.json().get("status") == "ok", "local_only": True}
    except (httpx.HTTPError, ValueError):
        return {"available": False, "local_only": True}


def _model_session(session: Session) -> tuple[dict, str]:
    """Assign a model-only sequence schedule if recipe steps lack video times."""
    data = session.model_dump(mode="json")
    events = data["events"]
    if not any(event["timestamp_s"] is None and event["reviewed"] for event in events):
        return data, "provided_event_times"
    cursor = 0.0
    for event in events:
        event["timestamp_s"] = cursor
        cursor += (event["duration_s"] or 0) + 1
    if cursor > 600:
        raise HTTPException(422, "The ordered steps exceed the engine's ten-minute schedule limit.")
    data["duration_s"] = max(data["duration_s"], cursor)
    return data, "recipe_order_model_schedule"


def _unchanged_case(session: Session, case_id: str | None) -> bool:
    case = next((item for item in sample_cases() if item["id"] == case_id), None)
    if case is None:
        return False
    original = case["session"]
    current = session.model_dump(mode="json")
    return current["ingredients"] == original["ingredients"] and current["events"] == original["events"]


def _predict(client: httpx.Client, session: dict, residual: str) -> dict:
    response = client.post(f"{ENGINE}/mvp/predict", params={"residual": residual}, json=session)
    if response.status_code == 422:
        try:
            detail = response.json().get("detail", "The research engine rejected the session.")
        except ValueError:
            detail = "The research engine rejected the session."
        raise HTTPException(422, detail)
    response.raise_for_status()
    return response.json()


def predict(request: FlavorRequest) -> dict:
    model_input, timeline_basis = _model_session(request.session)
    unchanged = _unchanged_case(request.session, request.case_id)
    try:
        with httpx.Client(timeout=httpx.Timeout(90, connect=3), trust_env=False) as client:
            current = _predict(client, model_input, request.residual)
            reference = None
            comparison = None
            if unchanged:
                demos_response = client.get(f"{ENGINE}/mvp/demos")
                demos_response.raise_for_status()
                demo = next((item for item in demos_response.json()["demos"]
                             if item["id"] == request.case_id), None)
                if demo is not None:
                    reference = _predict(client, demo["session"], request.residual)
                other_id = {"tomato-miso-late": "tomato-miso-early",
                            "tomato-miso-early": "tomato-miso-late"}.get(request.case_id)
                if other_id:
                    other = next(item for item in sample_cases() if item["id"] == other_id)
                    other_input, _ = _model_session(Session.model_validate(other["session"]))
                    other_result = _predict(client, other_input, request.residual)
                    comparison = {
                        "title": other["session"]["title"],
                        "axes": {name: axis["score"] for name, axis in other_result["axes"].items()
                                 if axis.get("score_source") == "ingredient_model"},
                    }
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Local FlavorBench engine is unavailable. Start the private workbench on port 8000.") from exc

    axes = {}
    for name, axis in current["axes"].items():
        score = axis.get("score")
        source = axis.get("score_source")
        if score is None and reference is not None:
            proxy = reference["axes"].get(name, {})
            if proxy.get("score_source") == "illustrative_demo_proxy":
                score = proxy["score"]
                source = "illustrative_reference_proxy"
        axes[name] = {
            "score": score, "score_source": source,
            "status": axis.get("status"),
            "confidence_tier": axis.get("confidence_tier"),
            "process_adjusted": axis.get("process_adjusted", False),
        }
    versions = current.get("versions", {})
    return {
        "axes": axes,
        "timeline_basis": timeline_basis,
        "process_adjusted": current["process_adjusted"],
        "basis": current["basis"],
        "sequence_model": current["sequence_model"],
        "unsupported_ingredients": current["unsupported_ingredients"],
        "reference_proxies": reference is not None,
        "comparison": comparison,
        "versions": {
            "architecture_schema": versions.get("architecture_schema"),
            "deterministic_engine": versions.get("deterministic_engine"),
            "sensory_dataset": versions.get("sensory_dataset", {}).get("version"),
            "ingredient_profiles": versions.get("ingredient_profiles", {}).get("version"),
        },
    }
