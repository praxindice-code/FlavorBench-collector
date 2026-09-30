"""Compare two reviewed annotation sessions without requiring media or model files."""
import argparse
import json
from pathlib import Path

from .schema import Event, Session


def _observed_events(session: Session) -> list[Event]:
    return [event for event in session.events
            if event.reviewed and event.evidence == "observed" and event.timestamp_s is not None]


def _match(left: list[Event], right: list[Event], tolerance_s: float) -> int:
    """Maximum one-to-one matching of action, vessel, and nearby clip timestamp."""
    neighbors = [[j for j, candidate in enumerate(right)
                  if event.action == candidate.action
                  and event.vessel.casefold() == candidate.vessel.casefold()
                  and abs(event.timestamp_s - candidate.timestamp_s) <= tolerance_s]
                 for event in left]
    assigned = {}

    def assign(i: int, seen: set[int]) -> bool:
        for j in neighbors[i]:
            if j in seen:
                continue
            seen.add(j)
            if j not in assigned or assign(assigned[j], seen):
                assigned[j] = i
                return True
        return False

    return sum(assign(i, set()) for i in range(len(left)))


def compare(reference: Session, candidate: Session, tolerance_s: float = 3.0) -> dict:
    if tolerance_s < 0:
        raise ValueError("Tolerance must be nonnegative.")
    truth, predicted = _observed_events(reference), _observed_events(candidate)
    matched = _match(predicted, truth, tolerance_s)
    precision = matched / len(predicted) if predicted else (1.0 if not truth else 0.0)
    recall = matched / len(truth) if truth else 1.0
    return {"reference_events": len(truth), "candidate_events": len(predicted),
            "matched_events": matched, "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0,
            "criteria": {"reviewed": True, "evidence": "observed", "timestamp_required": True,
                         "same_action": True, "same_vessel": True, "timestamp_tolerance_s": tolerance_s}}


def main():
    parser = argparse.ArgumentParser(description="Compare reviewed, observed cooking events.")
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--tolerance-s", type=float, default=3.0)
    args = parser.parse_args()
    reference = Session.model_validate_json(args.reference.read_text(encoding="utf-8"))
    candidate = Session.model_validate_json(args.candidate.read_text(encoding="utf-8"))
    print(json.dumps(compare(reference, candidate, args.tolerance_s), indent=2))


if __name__ == "__main__":
    main()
