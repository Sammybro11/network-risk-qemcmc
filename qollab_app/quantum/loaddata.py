"""Loads the recorded reference run shipped as a project data file.

JavaScript cannot read project files, so main.js gets the data through
this module. The path must stay a plain string literal for the runtime
loader to pick the file up.
"""

import json


def recorded():
    with open("data/run.json") as f:
        return json.load(f)
