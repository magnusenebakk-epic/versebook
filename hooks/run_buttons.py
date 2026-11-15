"""Run buttons for the book's examples (docs/js/VerseRun.js).

The buttons need the Verse test runner built for browsers: docs/runtime/VerseTestScriptCmdVMWeb.js, .wasm and .data
(DEVELOPMENT.md says where they come from). When the three files are there, this hook

- publishes each chapter's tested examples as snippets/<chapter>.json, made by bin/snippets with the implementation
  bin/extract makes the book's tests with, and
- adds js/VerseRun.js to the pages' scripts.

Without them, or without Node.js to run bin/snippets with, it does neither: the site builds as it always has, and its
pages load nothing more than before.

The files are made in a temporary folder, not under docs/: `mkdocs serve` rebuilds when something under docs/ changes.
"""

import logging
import os
import shutil
import subprocess
import tempfile

from mkdocs.config.config_options import ExtraScriptValue
from mkdocs.structure.files import File

log = logging.getLogger("mkdocs.hooks.run_buttons")

RUNTIME_FILES = ["VerseTestScriptCmdVMWeb.js", "VerseTestScriptCmdVMWeb.wasm", "VerseTestScriptCmdVMWeb.data"]
PAGE_SCRIPT = "js/VerseRun.js"

_generated = None  # this build's temporary folder, when the buttons are on


def _remove_generated():
    global _generated
    if _generated:
        shutil.rmtree(_generated, ignore_errors=True)
        _generated = None


def on_config(config):
    global _generated
    _remove_generated()
    root = os.path.dirname(os.path.abspath(config.config_file_path))
    runtime = os.path.join(config.docs_dir, "runtime")
    missing = [name for name in RUNTIME_FILES if not os.path.isfile(os.path.join(runtime, name))]
    if missing:
        log.info("Run buttons are off: docs/runtime has no %s", ", ".join(missing))
        return config
    node = shutil.which("node")
    if not node:
        log.warning("Run buttons are off: bin/snippets needs Node.js, which isn't installed")
        return config

    _generated = tempfile.mkdtemp(prefix="verse-book-")
    result = subprocess.run([node, os.path.join(root, "bin", "snippets"), os.path.join(_generated, "snippets")],
                            cwd=root, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        log.warning("Run buttons are off: bin/snippets failed:\n%s", result.stderr.strip() or result.stdout.strip())
        _remove_generated()
        return config
    log.info("Run buttons: %s", result.stdout.strip())

    if not any(str(script) == PAGE_SCRIPT for script in config.extra_javascript):
        script = ExtraScriptValue(PAGE_SCRIPT)
        script.type = "module"
        config.extra_javascript.append(script)
    return config


def on_files(files, config):
    if _generated:
        for directory, _, names in os.walk(_generated):
            for name in names:
                path = os.path.relpath(os.path.join(directory, name), _generated).replace(os.sep, "/")
                files.append(File(path, _generated, config.site_dir, config.use_directory_urls))
    return files


def on_post_build(config):
    _remove_generated()


def on_build_error(error):
    _remove_generated()
