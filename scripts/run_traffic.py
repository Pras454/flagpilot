#!/usr/bin/env python3
"""Send demo traffic to the running FlagPilot Flagsmith experiment.

Each synthetic visitor resolves the experiment flag (recording an
exposure) and converts with a seeded probability that depends on the
variant served. This produces real warehouse events for the demo
experiment; the visitors are synthetic and labelled as such.
"""
import argparse
import json
import random
import sys

sys.path.insert(0, "/tmp/flagsmith-sdk")

import importlib.util  # noqa: E402

from flagsmith import Flagsmith  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "flagsmith_helper",
    "/home/hatch/workspace/custom-connectors/custom.flagsmith/bin/flagsmith.py",
)
helper = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(helper)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--users", type=int, default=400)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--seed", default="flagpilot-track1")
    args = parser.parse_args()

    env = helper.find_environment()
    environment_key = env["api_key"]
    client = Flagsmith(environment_key=environment_key, enable_events=True)

    counts = {}
    conversions = {}
    for i in range(args.start, args.start + args.users):
        identifier = f"flagpilot-user-{i:03d}"
        # get_experiment_flag records the exposure with the flag's
        # variant key. The variation key must be set (v_get_yours) or
        # variant exposures are silently skipped.
        flag = client.get_experiment_flag("checkout_button", identifier=identifier)
        value = str(flag.value)
        counts[value] = counts.get(value, 0) + 1
        rng = random.Random(f"{args.seed}-{i}")
        probability = 0.16 if value == "Get yours" else 0.10
        if rng.random() < probability:
            client.track_event("purchase", identifier=identifier)
            conversions[value] = conversions.get(value, 0) + 1

    client.flush_events()
    client.close()
    print(json.dumps({"exposures": counts, "conversions": conversions}, indent=2))


if __name__ == "__main__":
    main()
