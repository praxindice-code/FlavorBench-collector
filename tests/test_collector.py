import base64
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from collector.app import app
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
