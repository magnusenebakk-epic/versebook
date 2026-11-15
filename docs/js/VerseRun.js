// Run buttons for the book's examples.
//
// An example that prints something when it runs gets a Run button under it (which ones: bin/outputs records them). Run
// composes the example's test as the book's checks do (VerseSnippets.mjs: the example between its hidden setup and its
// hidden checks), runs it in this page with the Verse test runner built for WebAssembly (runtime/), and shows what the
// example printed. Edit lets the reader change the example and run it again.
//
// Many examples only compile with their hidden setup (definitions of the names they use). An example with hidden setup
// or checks has a Hidden code button that shows them; with Edit they can be changed too.
//
// The page's examples come from snippets/<chapter>.json (bin/snippets, run by the site's build: hooks/run_buttons.py,
// which also adds this script to the pages of the chapters that have one, and does neither for a site built without
// the runtime); an example on the page is matched to its entry by its code. The runtime is fetched and compiled on the first Run and kept for the next
// ones; each run gets a fresh instance in a frame of its own (runtime/run.html), which Stop removes.
import { composeTest, readTestOutput } from "./VerseSnippets.mjs";

const Root = new URL("../", import.meta.url); // the site's root: this file is <root>/js/VerseRun.js
const Build = "VerseTestScriptCmdVMWeb";
const ResumeKey = "verse-run.resume"; // the example to run after the reload that isolates the page
// A run that prints more lines than this is stopped: every line is work for the page, and a loop that prints without
// end would keep it from answering (its Stop button too).
const MaxLines = 1000;
// The Verse Sandbox's address, when the site was built with one (hooks/run_buttons.py puts it in the page).
const Sandbox = document.querySelector('meta[name="verse-sandbox"]')?.content || "";
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

// The parts of an example's test that the book doesn't show (bin/extract: the comments around the example).
const HiddenParts = [
    { part: "setup", of: (snippet) => snippet.prepend, caption: "Hidden in the book: this runs before the example" },
    { part: "checks", of: (snippet) => snippet.append, caption: "Hidden in the book: this is checked after the example" },
];

function makeExample(pre, snippet) {
    // The wrapper holds, in this order: the hidden setup (if the example has one), the block (which the highlighter
    // replaces in place) or its editor, the hidden checks (if any), the bar, the result.
    const wrapper = document.createElement("div");
    wrapper.className = "verse-example";
    wrapper.dataset.snippet = snippet.number;
    pre.replaceWith(wrapper);
    wrapper.append(pre);

    const bar = document.createElement("div");
    bar.className = "verse-example-bar";
    const button = (label, title, className) => {
        const element = document.createElement("button");
        element.type = "button";
        element.textContent = label;
        element.title = title;
        element.className = className;
        bar.append(element);
        return element;
    };
    const run = button("▶ Run", "Run this example in the page", "verse-example-run");
    const edit = button("Edit", "Change the example and run it again", "verse-example-edit");
    const reset = button("Reset", "Back to the book's example", "verse-example-reset");
    reset.hidden = true;

    const result = document.createElement("div");
    result.className = "verse-example-result";
    result.hidden = true;

    const example = { wrapper, snippet, run, result, running: false };
    const editing = () => "editing" in wrapper.dataset;

    // An editor for one part of the test (the example's code, or a hidden part): {box, area}, the text area and the
    // element that holds it (drawEditor: its text is drawn underneath it with the book's highlighter).
    const linesOf = (area) => {
        const text = area.value.replace(/\r/g, "").replace(/\s+$/, "");
        return text ? text.split("\n") : [];
    };
    const makeEditor = (className, label) => {
        const box = document.createElement("div");
        box.className = "verse-example-code";
        const area = document.createElement("textarea");
        area.className = className;
        area.rows = 1; // the drawing gives the editor its height
        area.wrap = "off";
        area.spellcheck = false;
        area.autocapitalize = "off";
        area.setAttribute("aria-label", `${label}. Tab indents; Escape leaves the editor; Ctrl+Enter runs.`);
        box.append(area);
        const draw = () => drawEditor(box, area);
        Editors.add(draw);
        area.addEventListener("input", draw);
        // (The text area is as large as its text and doesn't scroll in itself: its box does.)
        area.addEventListener("scroll", () => {
            area.scrollTop = 0;
            area.scrollLeft = 0;
        });
        // Tab indents (Verse's blocks are indented, by four spaces in the book) instead of leaving the editor, which
        // Escape does; Ctrl+Enter runs.
        area.addEventListener("keydown", (event) => {
            if (event.key === "Tab" && !area.readOnly && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                area.setRangeText("    ", area.selectionStart, area.selectionEnd, "end");
                draw();
            } else if (event.key === "Escape") {
                run.focus();
            } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                start(example);
            }
        });
        return { box, area, draw };
    };
    const fill = (editor, text) => {
        editor.area.value = text;
        editor.draw();
    };
    const setReadOnly = (editor, on) => {
        editor.area.readOnly = on;
        if (on) editor.box.dataset.readonly = "";
        else delete editor.box.dataset.readonly;
    };

    const editor = makeEditor("verse-example-editor", "The example's code");
    editor.box.hidden = true;
    pre.after(editor.box);

    // The hidden parts this example has, each shown (read-only until Edit) once the reader asks for the hidden code.
    const hidden = {};
    for (const { part, of, caption } of HiddenParts) {
        const text = textOf(of(snippet));
        if (!text.trim()) continue;
        const section = document.createElement("div");
        section.className = "verse-example-hidden";
        section.dataset.part = part;
        const label = document.createElement("div");
        label.className = "verse-example-caption";
        label.textContent = caption;
        const partEditor = makeEditor("verse-example-part", caption);
        setReadOnly(partEditor, true);
        fill(partEditor, text);
        section.append(label, partEditor.box);
        if (part === "setup") wrapper.prepend(section);
        else editor.box.after(section);
        hidden[part] = { editor: partEditor, text };
    }
    example.reveal = () => {};
    if (Object.keys(hidden).length) {
        const reveal = button("", "This example runs with code the book doesn't show: what runs before it, and what is checked after it", "verse-example-reveal");
        example.reveal = (on) => {
            if (on) wrapper.dataset.revealed = "";
            else delete wrapper.dataset.revealed;
            reveal.textContent = on ? "▾ Hidden code" : "▸ Hidden code";
            reveal.setAttribute("aria-expanded", String(on));
        };
        example.reveal(false);
        reveal.addEventListener("click", () => example.reveal(!("revealed" in wrapper.dataset)));
    }

    const status = document.createElement("span");
    status.className = "verse-example-status";
    status.setAttribute("role", "status");
    bar.append(status);
    example.status = status;
    wrapper.append(bar, result);

    // The test's parts as they are now: the book's own lines for a part the reader hasn't changed.
    const part = (area, original) => {
        const lines = linesOf(area);
        return textOf(lines) === textOf(original) ? original : lines;
    };
    example.parts = () => (editing() ? {
        code: part(editor.area, snippet.code),
        prepend: hidden.setup ? part(hidden.setup.editor.area, snippet.prepend) : snippet.prepend,
        append: hidden.checks ? part(hidden.checks.editor.area, snippet.append) : snippet.append,
    } : { code: snippet.code, prepend: snippet.prepend, append: snippet.append });

    edit.addEventListener("click", () => {
        wrapper.dataset.editing = ""; // the stylesheet hides the block: whichever one the highlighter has put there
        editor.box.hidden = false;
        fill(editor, snippet.text);
        for (const hiddenPart of Object.values(hidden)) setReadOnly(hiddenPart.editor, false);
        edit.hidden = true;
        reset.hidden = false;
        editor.area.focus();
    });
    reset.addEventListener("click", () => {
        if (example.running) Runtime.stop();
        delete wrapper.dataset.editing;
        editor.box.hidden = true;
        for (const hiddenPart of Object.values(hidden)) {
            setReadOnly(hiddenPart.editor, true);
            fill(hiddenPart.editor, hiddenPart.text);
        }
        edit.hidden = false;
        reset.hidden = true;
        result.hidden = true;
        status.textContent = "";
        delete wrapper.dataset.state;
    });
    run.addEventListener("click", () => {
        if (example.running) Runtime.stop();
        else start(example);
    });
    return example;
}

// ---------- Editors that keep the code's colours ----------

// The book's highlighter (Verse.js), once it has loaded: (code) => the markup of a highlighted block in the page's
// current theme, or null while it can't make one. The buttons work without it: an editor then shows its text plainly.
let highlightVerse = null;
// Every editor's draw(): they are drawn again when the highlighter arrives, and when the page's blocks are rendered
// again (the theme changed).
const Editors = new Set();
const drawEditors = () => {
    for (const draw of Editors) draw();
};
import("./Verse.js").then((module) => {
    highlightVerse = module.HighlightVerse;
    drawEditors();
}).catch(() => {
    // No highlighter (its own imports didn't load): plain editors.
});

// What makes a text area's letters sit exactly on a drawing's: the drawing's type, and its distance from the box.
const TypeProperties = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontKerning", "fontFeatureSettings", "fontVariantLigatures",
    "lineHeight", "letterSpacing", "wordSpacing", "tabSize", "textIndent"];
const Sides = ["Top", "Right", "Bottom", "Left"];

// Draws an editor: its text area's text as a highlighted block underneath the text area (in `box`), which gives the
// editor its size. The text area on top is where the reader types; with a drawing under it, its own text isn't shown
// (the stylesheet), only its caret and selection. Without the highlighter the drawing is left blank and the text area
// shows its text.
function drawEditor(box, area) {
    // (A last line that is empty has no height in a block: a space gives it the height the caret needs.)
    const text = /\n$/.test(area.value) || area.value === "" ? `${area.value} ` : area.value;
    let markup = null;
    try {
        markup = highlightVerse && highlightVerse(text);
    } catch {
        // (The theme is changing and the new one hasn't loaded yet: plain until the blocks are rendered again.)
    }
    let drawing;
    if (markup) {
        const holder = document.createElement("div");
        holder.innerHTML = markup; // the highlighter's own markup of the text, as Verse.js puts it in the page
        drawing = holder.firstElementChild;
        drawing.removeAttribute("tabindex");
        delete box.dataset.plain;
    } else {
        drawing = document.createElement("pre");
        drawing.append(document.createElement("code"));
        drawing.firstElementChild.textContent = text;
        box.dataset.plain = "";
    }
    drawing.setAttribute("aria-hidden", "true");
    const old = box.querySelector(":scope > pre");
    if (old) old.replaceWith(drawing);
    else box.prepend(drawing);

    const code = drawing.querySelector("code") || drawing;
    const type = getComputedStyle(code);
    const frame = getComputedStyle(drawing);
    for (const property of TypeProperties) area.style[property] = type[property];
    for (const side of Sides) {
        const distance = ["padding", "border", "margin"].reduce((sum, kind) => {
            const name = kind === "border" ? `border${side}Width` : `${kind}${side}`;
            return sum + (parseFloat(type[name]) || 0) + (kind === "margin" ? 0 : parseFloat(frame[name]) || 0);
        }, 0);
        area.style[`padding${side}`] = `${distance}px`;
    }
}

// ---------- A run ----------

async function start(example) {
    const { snippet, run, status, result, wrapper } = example;
    const { code, prepend, append } = example.parts();
    const edited = code !== snippet.code || prepend !== snippet.prepend || append !== snippet.append;
    const { content, where } = composeTest({ code, prepend, append }, { printOutput: true });

    if (!Runtime.supported()) {
        show(example, "unavailable", Unsupported, true);
        return;
    }
    // (What a reload must bring back: the reader's version of the parts, and whether the hidden ones were showing.)
    const keep = { edited: edited ? { code: textOf(code), setup: textOf(prepend), checks: textOf(append) } : null, revealed: "revealed" in wrapper.dataset };
    if (!crossOriginIsolated && !(await isolate(snippet, keep))) {
        show(example, "unavailable", "Examples can't run here: this page can't be given the browser's permission to run threads.", true);
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
            report(example, interpret(outcome, where), append.length > 0);
        }
    } catch (error) {
        show(example, "unavailable", String(error && error.message ? error.message : error));
    } finally {
        example.running = false;
        run.textContent = "▶ Run";
        run.title = "Run this example in the page";
    }
}

// Shows an example's state and the line that says it. `pointToSandbox`: the example can't run on this page, and the
// reader is shown the way to the sandbox (if the site knows where it is).
function show(example, state, text, pointToSandbox = false) {
    example.wrapper.dataset.state = state;
    example.status.textContent = text;
    if (pointToSandbox && Sandbox) {
        const link = document.createElement("a");
        link.href = Sandbox;
        link.textContent = "Open the Verse Sandbox";
        example.status.append(" ", link);
    }
}

// A run's outcome read: what the test runner printed (VerseSnippets.mjs reads it, as the book's own tools do), with how
// the run ended.
function interpret(outcome, where) {
    return { ...readTestOutput(outcome.lines, where), status: outcome.status, what: outcome.what, ms: outcome.ms };
}

// Shows a run's result. `checked`: the test had hidden checks after the example.
function report(example, { errors, warnings, printed, checksFailed, status, what, ms }, checked) {
    const { result } = example;
    result.replaceChildren();
    const add = (className, text) => {
        const line = document.createElement("div");
        line.className = className;
        line.textContent = text;
        result.append(line);
    };
    const at = (place) => {
        if (place.part === "code") return `Line ${place.line}, column ${place.column}`;
        if (place.part === "setup") return `Hidden setup, line ${place.line}, column ${place.column}`;
        if (place.part === "checks") return `Hidden checks, line ${place.line}, column ${place.column}`;
        return "In the test around the example";
    };
    for (const text of printed) add("verse-example-output", text);
    for (const error of errors) add("verse-example-error", `${at(error)}: ${error.message}`);
    for (const warning of warnings) add("verse-example-warning", `${at(warning)}: warning: ${warning.message}`);
    // An error in a hidden part: the reader gets to see what it is about.
    if (errors.some((error) => error.part === "setup" || error.part === "checks")) example.reveal(true);
    const seconds = `${(ms / 1000).toFixed(1)} s`;
    let state = "passed";
    let summary = `Compiled and ran in ${seconds}${checked ? "; the hidden checks hold." : "."}${printed.length ? "" : " It prints nothing."}`;
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
        summary = checked
            ? "It compiles, but it stopped with a runtime error, or a hidden check doesn't hold."
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
// Run asked for it runs when the page is back (`keep`: the reader's version of its parts, if they changed any, and
// whether its hidden code was showing). False when that can't be done or didn't help.
async function isolate(snippet, keep) {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return false;
    const resume = JSON.parse(sessionStorage.getItem(ResumeKey) || "null");
    if (resume && resume.page === location.pathname) return false; // one try: no loop if the page still isn't isolated
    try {
        await navigator.serviceWorker.register(new URL("coi-sw.js", Root), { scope: Root.pathname });
        await navigator.serviceWorker.ready;
    } catch {
        return false;
    }
    sessionStorage.setItem(ResumeKey, JSON.stringify({ page: location.pathname, number: snippet.number, ...keep }));
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
        if (resume.revealed) wrapper.querySelector(".verse-example-reveal")?.click();
        if (resume.edited) {
            wrapper.querySelector(".verse-example-edit").click();
            const restore = (selector, text) => {
                const area = wrapper.querySelector(selector);
                if (!area || typeof text !== "string") return;
                area.value = text;
                area.dispatchEvent(new Event("input"));
            };
            restore(".verse-example-editor", resume.edited.code);
            restore('.verse-example-hidden[data-part="setup"] textarea', resume.edited.setup);
            restore('.verse-example-hidden[data-part="checks"] textarea', resume.edited.checks);
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
    let rendered = false;
    new MutationObserver((records) => {
        // (An example's block put there anew: the highlighter rendered the page's blocks, for the first time or in
        // another theme, and the editors are to be drawn to match.)
        rendered ||= records.some((record) => record.target instanceof Element && record.target.classList.contains("verse-example")
            && [...record.addedNodes].some((node) => node.nodeName === "PRE"));
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            decorate();
            if (rendered) drawEditors();
            rendered = false;
        });
    }).observe(document.body, { childList: true, subtree: true });
    resumeAfterReload();
}
