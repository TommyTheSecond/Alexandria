import sys
from pathlib import Path

# `pytest scanner` runs from the repo root; make `fixtures` and `scanner` importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
