"""Run buttons for the book's examples (docs/js/VerseRun.js), and the links to the Verse Sandbox.

An example gets a Run button when running it shows something: the examples that print, which bin/outputs records in
examples_with_output.json. The buttons need the Verse test runner built for browsers:
docs/runtime/VerseTestScriptCmdVMWeb.js, .wasm and .data (DEVELOPMENT.md says where they come from). When the three
files are there, this hook

- publishes those examples, chapter by chapter, as snippets/<chapter>.json, made by bin/snippets with the
  implementation bin/extract makes the book's tests with, and
- adds js/VerseRun.js to the pages of the chapters that have such an example.

Without the runtime, or without Node.js to run bin/snippets with, it does neither: the site builds as it always has,
and its pages load nothing more than before.

The files are made in a temporary folder, not under docs/: `mkdocs serve` rebuilds when something under docs/ changes.

The sandbox: when mkdocs.yml's extra.verse_sandbox has its address, the navigation gets an entry for it and every page
with Run buttons says where it is (a meta element), for the buttons to point a reader there whose browser can't run
the examples.
While the setting is empty the site has no link to the sandbox.
"""

import html
import logging
import os
import shutil
import subprocess
import tempfile

from mkdocs.structure.files import File
from mkdocs.utils import get_relative_url

log = logging.getLogger("mkdocs.hooks.run_buttons")

RUNTIME_FILES = ["VerseTestScriptCmdVMWeb.js", "VerseTestScriptCmdVMWeb.wasm", "VerseTestScriptCmdVMWeb.data"]
PAGE_SCRIPT = "js/VerseRun.js"
SANDBOX_ENTRY = "▶ Verse Sandbox"
SANDBOX_ENTRY_AFTER = "api/verse_runtime_api.html"  # the navigation's other tool; the last two entries stay last

_generated = None  # this build's temporary folder, when the buttons are on
_chapters = set()  # the chapters with a Run button: "07_control" for docs/07_control.md


def _remove_generated():
    global _generated
    if _generated:
        shutil.rmtree(_generated, ignore_errors=True)
        _generated = None
    _chapters.clear()


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

    snippets = os.path.join(_generated, "snippets")
    for directory, _, names in os.walk(snippets):
        for name in names:
            path = os.path.relpath(os.path.join(directory, name), snippets).replace(os.sep, "/")
            _chapters.add(os.path.splitext(path)[0])
    return config


def on_files(files, config):
    if _generated:
        for directory, _, names in os.walk(_generated):
            for name in names:
                path = os.path.relpath(os.path.join(directory, name), _generated).replace(os.sep, "/")
                files.append(File(path, _generated, config.site_dir, config.use_directory_urls))
    return files


def on_post_page(output, page, config):
    if os.path.splitext(page.file.src_uri)[0] not in _chapters:
        return output
    script = '<script type="module" src="%s"></script>' % html.escape(get_relative_url(PAGE_SCRIPT, page.url), quote=True)
    output = output.replace("</body>", script + "</body>", 1)
    url = _sandbox(config)
    if url:
        meta = '<meta name="verse-sandbox" content="%s">' % html.escape(url, quote=True)
        output = output.replace("</head>", meta + "</head>", 1)
    return output


def on_post_build(config):
    _remove_generated()


def on_build_error(error):
    _remove_generated()
