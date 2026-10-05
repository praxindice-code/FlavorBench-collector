# FlavorBench Collector

A local research tool for annotating cooking videos and images. It records ingredients, their preparation and quantity, and the ordered actions that connect them. Each entry distinguishes visible observations, recipe instructions, and estimates, and carries a human review flag.

The collector is deliberately separate from FlavorBench's sensory scoring, proprietary profiles, training data, and model artifacts. This repository contains only software and an invented sample session. It does **not** include a recipe corpus, source videos, or a flavor prediction model.

## Run on a CPU laptop

Verified with Python 3.13. From this repository in Command Prompt:

```bat
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn collector.app:app --host 127.0.0.1 --port 8010
```

Open `http://127.0.0.1:8010/`. Manual annotation requires no model or GPU. Media is selected from your computer and played in the browser; the server does not upload or save it. You can import a session, edit the annotation timeline, and validate/export a JSON session. Re-select source media after importing an annotation.
The **Use camera** control captures one local still photo for a demo. Attaching different media clears the previous timeline and ingredient review after confirmation. A browser-computed SHA-256 fingerprint identifies the file contents, so renamed identical files retain their notes and changed same-named files do not. Older notes without a fingerprint require manual source confirmation. Fingerprints identify bytes, not source ownership or authenticity.

**Save notes in browser** keeps one validated local snapshot; **Restore saved notes** reloads it. Export JSON for a portable copy. Source media is never included in either save. Notes can be lost if browser storage is cleared, and remain accessible to someone using the same browser profile.

The case library loads all twelve authored examples, including an onion-first versus all-in-first order comparison with identical ingredients. These cases have no source media: their steps use recipe order and `null` clip timestamps. The annotation views show the ordered process, recorded ingredient masses and preparation, evidence categories, and review coverage. They summarize the annotation and do not represent flavor scores. Select a timed event in your own video annotation to jump to its frame.

### Optional local flavor estimates

If the separate, private FlavorBench research workbench is running on `127.0.0.1:8000`, the collector also displays an experimental eleven-dimension flavor fingerprint. It sends the current JSON annotation only to that fixed loopback address. The public collector contains no sensory dataset, scoring weights, or flavor model. The deterministic engine is selected by default; the Mamba checkpoint is available as an exploratory option and is trained on synthetic examples.

Each displayed number is labeled **model estimate** or **demo reference proxy**. Reference proxies come from the original authored showcase case, not a measurement of the current annotation, and are shown only while its ingredient and event lists remain unchanged. After an edit, unsupported dimensions become unscored. When recipe steps have no video timestamps, a model-only schedule preserves their order without adding cooking durations to clip coordinates; it is not presented as observed clip time. Missing timestamps must be resolved when observed and instructed events are combined. These numbers are provisional and have not been validated against a controlled sensory panel. The collector continues to work as an annotation tool if the private engine is unavailable.
The onion-first and all-in-first cases also show a side-by-side difference for dimensions scored by the process model.

To make optional drafts, install [Ollama](https://ollama.com/) and a **locally downloaded vision-capable** model. The collector checks the model's capabilities and rejects Ollama entries that report a remote host or model. It sends at most six sampled JPEG frames from a video, or one attached photo, plus recipe text to Ollama on `127.0.0.1`; it never sends the video file. A still image cannot establish an observed temporal action; those drafts are rejected. On a CPU inference can take several minutes. Every draft item remains unreviewed until you check it against the source. Changing the media or annotations during analysis discards the pending draft.

## Annotation contract

`GET /api/schema` exposes the JSON schema. `POST /api/validate` validates and returns a normalized session. Exports use FlavorBench session schema `1.2`, including optional `source_sha256`; older `1.0`/`1.1` exports migrate on import. The private research tool can import these annotations. An event can have a clip timestamp, or `null` when a recipe step cannot be matched to a visible frame. The clip's timeline and a cooking step's duration are distinct fields; an edited video gap is not treated as elapsed cooking time. Optional temperature and particle size fields should be populated only when evidenced. The private deterministic prediction path requires explicit durations for reviewed heat/rest steps.

The [sample session](examples/synthetic_session.json) and [case library](examples/cases.json) are invented and may be used to try the UI. They are not observations or training data. `GET /api/cases` returns the validated cases.

To compare two reviewed annotations of the same clip, run `python -m collector.evaluate reference.json candidate.json`. Both fingerprints must match when either export has one. Older exports require the same nonempty source name and the report flags this as unverified filename matching. The tool matches only reviewed, observed events with the same action and vessel within three seconds. It reports event precision, recall, and F1; it does not measure sensory accuracy. An empty reference or nonpositive/nonfinite tolerance is rejected.

## Data and contribution boundaries

- Do not commit source videos, screenshots, user sessions, private recipes, participant information, credentials, licensed datasets, or model weights.
- Contribute code, documentation, tests, schema improvements, and wholly synthetic examples. If contributing data, confirm that you own the rights and have permission to redistribute it before opening a PR.
- This tool does not scrape or download third-party media. Check source permissions before collecting annotations and record source attribution in `source_name`.
- Review model drafts manually. Neither model confidence nor the review checkbox validates a sensory claim.

## Tests

```bat
pip install pytest==9.1.1
python -m pytest
```

## License

Software is licensed under the [MIT License](LICENSE). That license allows commercial use; it does not grant rights to any third-party media or data you annotate.
