"""HackShop simulation worker.

Pipeline: Assembly IR -> asset resolution -> MJCF scene compile -> control
(scripted or LLM-authored) -> physics rollout (telemetry) -> render (mp4 +
trajectory). See `docs/v2-simulation-plan.md` in the repo root for the contract.
"""

__version__ = "0.1.0"
