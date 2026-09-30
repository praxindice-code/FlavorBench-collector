import base64
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from collector.app import app
from collector.cases import sample_cases
from collector import local_vision
from collector.evaluate import compare
from collector.schema import Session


client = TestClient(app)
SAMPLE = Path(__file__).resolve().parents[1] / "examples" / "synthetic_session.json"


def test_synthetic_session_roundtrip_and_order():
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    response = client.post("/api/validate", json=sample)
    assert response.status_code == 200
    validated = response.json()
    assert [event["action"] for event in validated["events"]] == ["heat", "add", "mix", "add"]
    assert validated["ingredients"][0]["preparation"] == "diced"
    assert "recipe_graph" not in validated
    assert "sensory_observations" not in validated


def test_timestamp_after_clip_rejected():
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    sample["events"][0]["timestamp_s"] = 61
    assert client.post("/api/validate", json=sample).status_code == 422


def test_old_schema_version_can_import():
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    sample["schema_version"] = "1.0"
    assert Session.model_validate(sample).schema_version == "1.1"


def test_evaluation_matches_reviewed_observed_events_once():
    sample = json.loads(SAMPLE.read_text(encoding="utf-8"))
    for event in sample["events"]:
        event["evidence"] = "observed"
    reference = Session.model_validate(sample)
    candidate = Session.model_validate(sample)
    candidate.events.append(candidate.events[0].model_copy())
    candidate.events[-1].timestamp_s = 1
    result = compare(reference, candidate)
    assert result["matched_events"] == 4
    assert result["precision"] == 0.8
    assert result["recall"] == 1.0
    candidate.events[0].reviewed = False
    assert compare(reference, candidate)["candidate_events"] == 4


def test_cross_origin_write_rejected():
    response = client.post("/api/validate", json={}, headers={"origin": "https://outside.example"})
    assert response.status_code == 403


def test_public_schema_excludes_private_fields():
    schema = client.get("/api/schema").json()
    properties = schema["properties"]
    assert "recipe_graph" not in properties
    assert "sensory_observations" not in properties


def test_server_does_not_expose_media_upload_route():
    paths = set(app.openapi()["paths"])
    assert not any("upload" in path or "media" in path for path in paths)


def test_all_illustrative_cases_are_valid_and_have_no_fake_video_times():
    cases = sample_cases()
    assert len(cases) == 12
    assert len({case["id"] for case in cases}) == 12
    for case in cases:
        session = Session.model_validate(case["session"])
        assert session.events
        assert session.source_name == "Synthetic demonstration; no source media"
        assert all(event.timestamp_s is None for event in session.events)
        assert all(event.evidence == "instructed" for event in session.events)
    assert len(client.get("/api/cases").json()["cases"]) == 12


def test_order_pair_has_matching_ingredients_and_different_first_addition():
    cases = {case["id"]: Session.model_validate(case["session"]) for case in sample_cases()}
    late, early = cases["tomato-miso-late"], cases["tomato-miso-early"]
    assert [(i.name, i.quantity_g) for i in late.ingredients] == [
        (i.name, i.quantity_g) for i in early.ingredients]
    assert late.events[0].ingredient != early.events[0].ingredient
    assert [event.duration_s for event in late.events if event.action == "heat"] == [420]
    assert [event.duration_s for event in early.events if event.action == "heat"] == [420]


def test_visualization_assets_are_served():
    page = client.get("/")
    assert page.status_code == 200
    assert "visuals.js" in page.text
    assert "case-select" in page.text
    assert client.get("/visuals.js").status_code == 200


def test_local_model_result_requires_review(monkeypatch):
    picture = Image.new("RGB", (2, 2), "red")
    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG")
    request = local_vision.AnalysisRequest(model="local-vision", duration_s=10,
        frames=[{"timestamp_s": 1, "jpeg": base64.b64encode(buffer.getvalue()).decode()}])

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"message": {"content": json.dumps({
                "ingredients": [{"name": "onion", "reviewed": True}],
                "events": [{"description": "Add onion", "timestamp_s": 1, "reviewed": True}],
            })}}

    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs["trust_env"] is False

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, json):
            assert url == "http://127.0.0.1:11434/api/chat"
            assert len(json["messages"][1]["images"]) == 1
            return FakeResponse()

    monkeypatch.setattr(local_vision.httpx, "Client", FakeClient)
    monkeypatch.setattr(local_vision, "local_model_info", lambda client, name: {})
    result = local_vision.analyze(request)
    assert not result["ingredients"][0]["reviewed"]
    assert not result["events"][0]["reviewed"]
