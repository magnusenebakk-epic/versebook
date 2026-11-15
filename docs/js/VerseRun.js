// Run buttons for the book's examples.
//
// Every example the book's checks test (bin/extract) gets a Run button under it. Run composes the example's test as the
// checks do (VerseSnippets.mjs: the example between its hidden setup and its hidden checks), runs it in this page with
// the Verse test runner built for WebAssembly (runtime/), and shows what the example printed and whether its checks
// held. Edit lets the reader change the example and run it again.
//
// The page's examples come from snippets/<chapter>.json (bin/snippets, run by the site's build: hooks/run_buttons.py,
// which also adds this script to the pages, and does neither for a site built without the runtime); an example on the
// page is matched to its entry by its code. The runtime is fetched and compiled on the first Run and kept for the next
// ones; each run gets a fresh instance in a frame of its own (runtime/run.html), which Stop removes.
import { composeTest } from "./VerseSnippets.mjs";

const Root = new URL("../", import.meta.url); // the site's root: this file is <root>/js/VerseRun.js
const Build = "VerseTestScriptCmdVMWeb";
const ResumeKey = "verse-run.resume"; // the example to run after the reload that isolates the page
// A run that prints more lines than this is stopped: every line is work for the page, and a loop that prints without
// end would keep it from answering (its Stop button too).
const MaxLines = 1000;
const Unsupported = "Running examples needs a browser with 64-bit WebAssembly: a current Chrome, Edge or Firefox.";

// ---------- The page's examples ----------

// The chapter this page shows, as its source file is named under docs/ ("01_expressions", "api/index", ...).
const chapterOf = (pathname) => {
    let path = pathname.startsWith(Root.pathname) ? pathname.slice(Root.pathname.length) : pathname;
    path = path.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, "").replace(/\/$/, "");
    return path;
};

const textOf = (lines) => lines.join("\n").replace(/\s+$/, "");
const normalized = (text) => text.replace(/\r/g, "").replace(/\s+$/, "");

let snippets = []; // this chapter's, each with `used` once an example on the page has taken it

async function loadSnippets() {
    // (A page is its source's name as a folder, or the folder of a source named index.)
    const chapter = chapterOf(location.pathname);
    for (const name of chapter ? [chapter, `${chapter}/index`] : ["index"]) {
        try {
            const response = await fetch(new URL(`snippets/${name}.json`, Root));
            if (!response.ok) continue;
            snippets = (await response.json()).snippets.map((snippet) => ({ ...snippet, text: textOf(snippet.code), used: false }));
            return;
        } catch {
            // No examples to run on this page.
        }
    }
}

// Gives every tested example on the page that doesn't have them yet its bar and result area. Called again whenever the
// page's code blocks change: the highlighter (Verse.js) replaces each block's <pre> once it has loaded, and again when
// the reader switches between light and dark.
function decorate() {
    for (const code of document.querySelectorAll("code.language-verse")) {
        const pre = code.closest("pre");
        if (!pre || pre.parentElement.classList.contains("verse-example")) continue;
        const text = normalized(code.textContent);
        const snippet = snippets.find((candidate) => !candidate.used && candidate.text === text);
        if (!snippet) continue;
        snippet.used = true;
        makeExample(pre, snippet);
    }
}

function makeExample(pre, snippet) {
    // The block stays the wrapper's first child: the highlighter replaces it there.
    const wrapper = document.createElement("div");
    wrapper.className = "verse-example";
    wrapper.dataset.snippet = snippet.number;
    pre.replaceWith(wrapper);
    wrapper.append(pre);

    const editor = document.createElement("textarea");
    editor.className = "verse-example-editor";
    editor.spellcheck = false;
    editor.autocapitalize = "off";
    editor.hidden = true;
    editor.setAttribute("aria-label", "The example's code. Tab indents; Escape leaves the editor; Ctrl+Enter runs.");

    const bar = document.createElement("div");
    bar.className = "verse-example-bar";
    const button = (label, title) => {
        const element = document.createElement("button");
        element.type = "button";
        element.textContent = label;
        element.title = title;
        bar.append(element);
        return element;
    };
    const run = button("▶ Run", "Run this example in the page");
    run.className = "verse-example-run";
    const edit = button("Edit", "Change the example and run it again");
    edit.className = "verse-example-edit";
    const reset = button("Reset", "Back to the book's example");
    reset.hidden = true;
    const status = document.createElement("span");
    status.className = "verse-example-status";
    status.setAttribute("role", "status");
    bar.append(status);

    const result = document.createElement("div");
    result.className = "verse-example-result";
    result.hidden = true;

    wrapper.append(editor, bar, result);
    const example = { wrapper, snippet, editor, run, status, result, running: false };

    const editing = () => "editing" in wrapper.dataset;
    const currentLines = () => (editing() ? editor.value.replace(/\r/g, "").replace(/\s+$/, "").split("\n") : snippet.code);
    const clear = () => {
        result.hidden = true;
        status.textContent = "";
        delete wrapper.dataset.state;
    };

    edit.addEventListener("click", () => {
        editor.value = snippet.text;
        editor.rows = snippet.code.length + 1;
        wrapper.dataset.editing = ""; // the stylesheet hides the block: whichever one the highlighter has put there
        editor.hidden = false;
        edit.hidden = true;
        reset.hidden = false;
        editor.focus();
    });
    editor.addEventListener("input", () => {
        editor.rows = editor.value.split("\n").length + 1;
    });
    // Tab indents (Verse's blocks are indented, by four spaces in the book) instead of leaving the editor, which Escape
    // does; Ctrl+Enter runs.
    editor.addEventListener("keydown", (event) => {
        if (event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            editor.setRangeText("    ", editor.selectionStart, editor.selectionEnd, "end");
            editor.dispatchEvent(new Event("input"));
        } else if (event.key === "Escape") {
            run.focus();
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            start(example, currentLines());
        }
    });
    reset.addEventListener("click", () => {
        if (example.running) Runtime.stop();
        delete wrapper.dataset.editing;
        editor.hidden = true;
        edit.hidden = false;
        reset.hidden = true;
        clear();
    });
    run.addEventListener("click", () => {
        if (example.running) Runtime.stop();
        else start(example, currentLines());
    });
    return example;
}

// ---------- A run ----------

async function start(example, lines) {
    const { snippet, run, status, result, wrapper } = example;
    const edited = textOf(lines) !== snippet.text;
    const { content, origin, shift } = composeTest({ code: lines, prepend: snippet.prepend, append: snippet.append }, { printOutput: true });

    if (!Runtime.supported()) {
        show(example, "unavailable", Unsupported);
        return;
    }
    if (!crossOriginIsolated && !(await isolate(snippet, edited ? textOf(lines) : null))) {
        show(example, "unavailable", "Examples can't run here: this page can't be given the browser's permission to run threads.");
        return;
    }

    Runtime.stop(); // one run at a time: another example's run ends
    example.running = true;
    run.textContent = "■ Stop";
    run.title = "Stop this run";
    result.hidden = true;
    show(example, "running", Runtime.loaded ? "Running…" : "Getting the Verse compiler…");
    try {
        // (The file's text as bin/extract saves a test: its content and two line ends.)
        const outcome = await Runtime.run(content + "\n\n", (progress) => {
            status.textContent = progress;
        });
        if (outcome.stopped) {
            show(example, "stopped", "Stopped.");
        } else {
            report(example, interpret(outcome, origin, shift), edited);
        }
    } catch (error) {
        show(example, "unavailable", String(error && error.message ? error.message : error));
    } finally {
        example.running = false;
        run.textContent = "▶ Run";
        run.title = "Run this example in the page";
    }
}

function show(example, state, text) {
    example.wrapper.dataset.state = state;
    example.status.textContent = text;
}

// Lines the runtime prints that aren't the example's: the engine's log lines and compile errors' second lines, and what
// the WebAssembly build says while it starts.
const Noise = /^(Log\w*: |\[\d{4}\.\d\d\.\d\d-|Used inside function |Used memory before allocating anything was |Failed to open read: |Blocking on the main thread is very dangerous)/;

// What the test runner printed, read as the book's own checks read it (bin/vtest): compile errors and failed checks
// with their positions, mapped from the composed test's lines to the example's; everything else it printed that isn't
// the runtime's own is what the example printed.
function interpret(outcome, origin, shift) {
    const located = /^(?:LogVerseBuild: (?:Error|Warning): )?(.*?)\((\d+),(\d+),\s*(\d+),(\d+)\):\s*(.*)$/;
    const errors = [];
    const warnings = [];
    const printed = [];
    let checksFailed = false;
    for (const line of outcome.lines) {
        const text = line.replace(/\r$/, "");
        const match = located.exec(text);
        if (match) {
            const row = Number(match[2]);
            const column = Number(match[3]);
            const kind = /^(Script Warning|Script Error|Verse compiler error)(?: [A-Z]?\d+)?:\s*/.exec(match[6]);
            const message = kind ? match[6].slice(kind[0].length) : match[6];
            if (/^Failed to compile:/.test(message)) continue; // the summary after the errors themselves
            if (/Expected result but encountered runtime error/.test(message)) {
                checksFailed = true;
                continue;
            }
            const source = row >= 1 && row <= origin.length ? origin[row - 1] : -1;
            const place = source >= 0 ? { line: source + 1, column: Math.max(1, column - shift[row - 1]), message } : { line: null, message };
            // A warning doesn't fail the test (bin/vtest passes it too); one in the hidden part isn't the reader's.
            if (kind && kind[1] === "Script Warning") {
                if (place.line) warnings.push(place);
            } else {
                errors.push(place);
            }
        } else if (/^\*\*\* Testing completed with \d+ errors?\. \*\*\*/.test(text)) {
            if (errors.length === 0) checksFailed = true;
        } else if (text.trim() && !Noise.test(text)) {
            printed.push(text);
        }
    }
    return { errors, warnings, printed, checksFailed, status: outcome.status, what: outcome.what, ms: outcome.ms };
}

function report(example, { errors, warnings, printed, checksFailed, status, what, ms }, edited) {
    const { result, snippet } = example;
    result.replaceChildren();
    const add = (className, text) => {
        const line = document.createElement("div");
        line.className = className;
        line.textContent = text;
        result.append(line);
    };
    for (const text of printed) add("verse-example-output", text);
    for (const error of errors) {
        add("verse-example-error", error.line ? `Line ${error.line}, column ${error.column}: ${error.message}` : `In the example's hidden setup: ${error.message}`);
    }
    for (const warning of warnings) {
        add("verse-example-warning", `Line ${warning.line}, column ${warning.column}: warning: ${warning.message}`);
    }
    const seconds = `${(ms / 1000).toFixed(1)} s`;
    let state = "passed";
    let summary = (snippet.append.length ? `Ran in ${seconds} and passed the book's checks.` : `Ran in ${seconds}.`) + (printed.length ? "" : " It prints nothing.");
    if (status === "flood") {
        state = "stopped";
        summary = `Stopped: it printed more than ${MaxLines.toLocaleString("en")} lines.`;
    } else if (status === "abort") {
        state = "failed";
        summary = `The Verse runtime stopped: ${what}`;
    } else if (errors.length) {
        state = "failed";
        summary = errors.length === 1 ? "It doesn't compile." : `It doesn't compile (${errors.length} errors).`;
    } else if (checksFailed) {
        state = "failed";
        summary = edited && snippet.append.length
            ? "It compiles, but it stopped with a runtime error, or what the book checks about this example no longer holds."
            : "It compiles, but it stopped with a runtime error.";
    } else if (status !== 0) {
        state = "failed";
        summary = `The test runner ended with status ${status}.`;
    }
    result.hidden = result.childElementCount === 0;
    show(example, state, summary);
}

// ---------- Cross-origin isolation ----------

// The runtime runs threads, which browsers allow only on cross-origin isolated pages (two response headers). Where the
// site's host doesn't send them, a service worker adds them (coi-sw.js) and the page reloads once; the example whose
// Run asked for it runs when the page is back (`edited`: the reader's version of it, if they changed it). False when
// that can't be done or didn't help.
async function isolate(snippet, edited) {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return false;
    const resume = JSON.parse(sessionStorage.getItem(ResumeKey) || "null");
    if (resume && resume.page === location.pathname) return false; // one try: no loop if the page still isn't isolated
    try {
        await navigator.serviceWorker.register(new URL("coi-sw.js", Root), { scope: Root.pathname });
        await navigator.serviceWorker.ready;
    } catch {
        return false;
    }
    sessionStorage.setItem(ResumeKey, JSON.stringify({ page: location.pathname, number: snippet.number, edited }));
    location.reload();
    return new Promise(() => {}); // the reload takes over
}

function resumeAfterReload() {
    const resume = JSON.parse(sessionStorage.getItem(ResumeKey) || "null");
    if (!resume || resume.page !== location.pathname) {
        sessionStorage.removeItem(ResumeKey); // another page's: a try there says nothing about this one
        return;
    }
    if (!crossOriginIsolated) return; // the note stays: Run then says it can't, without another reload
    sessionStorage.removeItem(ResumeKey);
    const wrapper = document.querySelector(`.verse-example[data-snippet="${CSS.escape(resume.number)}"]`);
    if (wrapper) {
        wrapper.scrollIntoView({ block: "center" });
        if (typeof resume.edited === "string") {
            wrapper.querySelector(".verse-example-edit").click();
            const editor = wrapper.querySelector(".verse-example-editor");
            editor.value = resume.edited;
            editor.dispatchEvent(new Event("input"));
        }
        wrapper.querySelector(".verse-example-run").click();
    }
}

// ---------- The runtime ----------

const Runtime = {
    loaded: null, // {module, urls, converter} once the runtime is here
    loading: null,
    current: null, // the run under way: {progress, finish}

    supported() {
        // 64-bit memory and relaxed SIMD, which the build uses: each a module of a few bytes that needs it.
        const header = [0, 97, 115, 109, 1, 0, 0, 0];
        const valid = (bytes) => {
            try {
                return WebAssembly.validate(new Uint8Array(bytes));
            } catch {
                return false;
            }
        };
        return valid([...header, 5, 3, 1, 4, 0]) &&
            valid([...header, 1, 8, 1, 0x60, 3, 0x7b, 0x7b, 0x7b, 1, 0x7b, 3, 2, 1, 0, 10, 13, 1, 11, 0, 0x20, 0, 0x20, 1, 0x20, 2, 0xfd, 0x85, 0x02, 0x0b]);
    },

    // Whether this engine's stack frames for WebAssembly give binary offsets (then runs need no offset converter): a
    // tiny module's function calls back into JavaScript, which looks at the frame.
    framesHaveBinaryOffsets() {
        try {
            let stack = "";
            const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0, 2, 7, 1, 1, 0x65, 1, 0x66, 0, 0, 3, 2, 1, 0,
                7, 5, 1, 1, 0x67, 0, 1, 10, 6, 1, 4, 0, 0x10, 0, 0x0b]);
            const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { f: () => { stack = new Error().stack || ""; } } });
            instance.exports.g();
            return /wasm-function\[\d+\]:0x[0-9a-f]+/.test(stack);
        } catch {
            return false;
        }
    },

    // Fetches and compiles the runtime, once: later calls get the same one. Progress goes to the run under way.
    load() {
        this.loading ??= (async () => {
            const progress = (text) => this.current?.progress(text);
            const url = (name) => new URL(`runtime/${name}`, Root).href;
            const response = await fetch(url(`${Build}.wasm`));
            if (!response.ok || !response.body) throw new Error(`The Verse compiler isn't on this site (${response.status}).`);
            // (A compressed transfer's length is the compressed one: then only what has arrived is known.)
            const total = response.headers.get("Content-Encoding") ? 0 : Number(response.headers.get("Content-Length")) || 0;
            const megabytes = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;
            const chunks = [];
            let received = 0;
            const reader = response.body.getReader();
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                received += value.byteLength;
                progress(total >= received ? `Getting the Verse compiler… ${megabytes(received)} of ${megabytes(total)}` : `Getting the Verse compiler… ${megabytes(received)}`);
            }
            const bytes = new Uint8Array(received);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            progress("Starting the Verse compiler…");
            const module = await WebAssembly.compile(bytes);
            this.loaded = {
                module,
                urls: { glue: url(`${Build}.js`), [`${Build}.wasm`]: url(`${Build}.wasm`), [`${Build}.data`]: url(`${Build}.data`) },
                converter: this.framesHaveBinaryOffsets() ? null : { bytes: bytes.buffer },
            };
            return this.loaded;
        })().catch((error) => {
            this.loading = null; // the next Run tries again
            throw error;
        });
        return this.loading;
    },

    // Runs a test script. Resolves with {status, what, lines, ms}, or {stopped: true} when stop() ended it.
    async run(text, progress) {
        let stop;
        const stopped = new Promise((resolve) => {
            stop = resolve;
        });
        const mine = { progress, finish: () => stop(null) };
        this.current = mine;
        let runtime;
        try {
            runtime = await Promise.race([this.load(), stopped]);
        } catch (error) {
            if (this.current === mine) this.current = null;
            throw error;
        }
        if (!runtime) {
            if (this.current === mine) this.current = null;
            return { stopped: true };
        }
        progress("Running…");
        const started = performance.now();
        return new Promise((resolve) => {
            const channel = new MessageChannel();
            const frame = document.createElement("iframe");
            const lines = [];
            const ready = (event) => {
                if (event.origin !== location.origin || event.source !== frame.contentWindow || !event.data || event.data.kind !== "ready") return;
                // (The converter's bytes are copied to the run, not moved: a run stopped before it made the tables
                // would take them with it.)
                frame.contentWindow.postMessage({ kind: "run", module: runtime.module, urls: runtime.urls, text, converter: runtime.converter, port: channel.port2 }, location.origin, [channel.port2]);
            };
            mine.finish = (outcome) => {
                if (this.current === mine) this.current = null;
                mine.finish = () => {};
                window.removeEventListener("message", ready);
                channel.port1.close();
                frame.remove();
                resolve({ ...outcome, lines, ms: performance.now() - started });
            };
            window.addEventListener("message", ready);
            channel.port1.onmessage = ({ data }) => {
                if (!data) return;
                if (data.kind === "out" || data.kind === "err") {
                    lines.push(String(data.text));
                    if (lines.length > MaxLines) mine.finish({ status: "flood" });
                }
                else if (data.kind === "converter") runtime.converter = { data: data.data };
                else if (data.kind === "exit") mine.finish({ status: data.status, what: data.what });
            };
            frame.title = "Verse run";
            frame.className = "verse-example-frame";
            frame.hidden = true;
            frame.src = new URL("runtime/run.html", Root).href;
            document.body.append(frame);
        });
    },

    stop() {
        if (this.current) this.current.finish({ stopped: true });
    },
};

// ---------- Start ----------

await loadSnippets();
if (snippets.length) {
    decorate();
    let scheduled = false;
    new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            decorate();
        });
    }).observe(document.body, { childList: true, subtree: true });
    resumeAfterReload();
}
