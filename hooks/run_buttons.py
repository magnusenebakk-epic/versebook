"""Run buttons for the book's examples (docs/js/VerseRun.js), and the links to the Verse Sandbox.

The buttons need the Verse test runner built for browsers: docs/runtime/VerseTestScriptCmdVMWeb.js, .wasm and .data
(DEVELOPMENT.md says where they come from). When the three files are there, this hook

- publishes each chapter's tested examples as snippets/<chapter>.json, made by bin/snippets with the implementation
  bin/extract makes the book's tests with, and
- adds js/VerseRun.js to the pages' scripts.

Without them, or without Node.js to run bin/snippets with, it does neither: the site builds as it always has, and its
pages load nothing more than before.

The files are made in a temporary folder, not under docs/: `mkdocs serve` rebuilds when something under docs/ changes.

The sandbox: when mkdocs.yml's extra.verse_sandbox has its address, the navigation gets an entry for it and every page
says where it is (a meta element), for the buttons to point a reader there whose browser can't run the examples.
While the setting is empty the site has no link to the sandbox.
"""

import html
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
SANDBOX_ENTRY = "▶ Verse Sandbox"
SANDBOX_ENTRY_AFTER = "api/verse_runtime_api.html"  # the navigation's other tool; the last two entries stay last

_generated = None  # this build's temporary folder, when the buttons are on


def _remove_generated():
    global _generated
    if _generated:
        shutil.rmtree(_generated, ignore_errors=True)
        _generated = None


def _sandbox(config):
    return str(config.extra.get("verse_sandbox") or "").strip()


def _link_sandbox(config):
    url = _sandbox(config)
    if not url:
        log.info("No links to the Verse Sandbox: extra.verse_sandbox is empty")
        return
    if not config.nav or any(isinstance(entry, dict) and url in entry.values() for entry in config.nav):
        return
    position = next((index + 1 for index, entry in enumerate(config.nav)
                     if isinstance(entry, dict) and SANDBOX_ENTRY_AFTER in entry.values()), len(config.nav))
    config.nav.insert(position, {SANDBOX_ENTRY: url})
    log.info("The Verse Sandbox: %s", url)


def on_config(config):
    global _generated
    _remove_generated()
    _link_sandbox(config)

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


def on_post_page(output, page, config):
    url = _sandbox(config)
    if not url:
        return output
    meta = '<meta name="verse-sandbox" content="%s">' % html.escape(url, quote=True)
    return output.replace("</head>", meta + "</head>", 1)


def on_post_build(config):
    _remove_generated()


def on_build_error(error):
    _remove_generated()
