// One run of an example's test: this page's instance of the Verse test runner (VerseTestScriptCmdVM, the program the
// book's checks run every example with, built for WebAssembly) tests one script and exits. The program runs its main
// once per instance, so a page makes one of these frames per run and removes it afterwards (js/VerseRun.js).
//
// From the page (window.parent, same origin only), once this frame has posted {kind: 'ready'}:
//   {kind: 'run', module, urls, text, converter, port}
//     module     the compiled runtime (a WebAssembly.Module: instantiating it takes no compiling)
//     urls       the build's files by name (<build>.wasm, <build>.data), and `glue`, its script
//     text       the test script (the program finds it as a file: /example/Example.versetest)
//     converter  for engines whose stack frames carry no binary offsets (see below): {bytes} or {data}
//     port       this run's channel to the page: everything below goes over it
// To the page, over the port:
//   {kind: 'out' | 'err', text}   a line of the test runner's stdout / stderr
//   {kind: 'converter', data}     the offset converter's tables, made from the module's bytes (the page keeps them)
//   {kind: 'exit', status}        the program ended (status: its exit code; 'abort' with `what` if the runtime died)
(() => {
	'use strict';
	const origin = location.origin;
	// A module with nothing in it, for WasmOffsetConverter to look for function names in.
	const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
	// The test script's file in the program's (in-memory) file system.
	const SCRIPT_DIRECTORY = '/example';
	const SCRIPT_NAME = 'Example.versetest';
	// Emscripten's own report while the runtime starts ("still waiting on run dependencies", every 10 s).
	const waiting = /^(still waiting on run dependencies:|dependency: \S+|\(end of list\))$/;
	let started = false;

	// Resolves once the messages already queued for this frame have been handled: a message of our own goes round a few
	// times (posted messages are handled in the order they were queued). No timer: this frame is never visible, and
	// WebKit holds back timers in frames that aren't.
	const queuedMessagesHandled = () => new Promise((resolve) => {
		const channel = new MessageChannel();
		let rounds = 0;
		channel.port1.onmessage = () => {
			if (++rounds < 3) channel.port2.postMessage(0);
			else resolve();
		};
		channel.port2.postMessage(0);
	});

	addEventListener('message', (event) => {
		if (event.origin !== origin || event.source !== parent || !event.data || event.data.kind !== 'run' || started) return;
		started = true;
		const { module, urls, text, converter, port } = event.data;
		const post = (message) => {
			port.postMessage(message);
		};
		let exited = false; // the program has exited; this frame is only delivering what it printed
		const abort = (what) => {
			if (!exited) post({ kind: 'exit', status: 'abort', what: String(what && what.message ? what.message : what) });
		};
		// A failure the runtime doesn't report itself (an exception in its script, or in one of its workers, which the
		// script throws again here): the run is over. (Not the exception Emscripten ends a program with.)
		addEventListener('error', (event) => {
			if (!(event.error && event.error.name === 'ExitStatus')) abort(event.error || event.message || 'The runtime failed.');
		});
		addEventListener('unhandledrejection', (event) => {
			if (!(event.reason && event.reason.name === 'ExitStatus')) abort(event.reason || 'The runtime failed.');
		});
		globalThis.Module = {
			// -NODEBUGOUTPUT: without the engine's log (which this platform's debug output would print in full), the
			// program prints what it does on a desktop: what the test prints, and its errors.
			arguments: [SCRIPT_DIRECTORY + '/' + SCRIPT_NAME, '-NODEBUGOUTPUT'],
			preRun: [() => {
				// Before main: the script as a file, where the test runner is told to find it. (As the build's preloaded
				// files are made: the file system takes these before the runtime starts, and creates them when it does.)
				FS.createPath('/', SCRIPT_DIRECTORY.slice(1), true, true);
				FS.createDataFile(SCRIPT_DIRECTORY, SCRIPT_NAME, new TextEncoder().encode(text), true, true, true);
				// The program runs on a thread (a worker). What it prints reaches this frame as messages; its exit comes by
				// another way, which can overtake them, and at exit Emscripten ends its workers and ignores what they sent
				// that hasn't been handled yet: the last lines were lost (in WebKit, most runs). So the workers stay as they
				// are at exit (this frame goes right after, and they with it), and the exit is reported once the messages
				// queued before it have been handled (onExit). A thread that ends meanwhile asks to be cleaned up, which
				// the exited runtime can't do (it asserts): that request is dropped.
				PThread.terminateAllThreads = () => {};
				const cleanupThread = globalThis.cleanupThread;
				globalThis.cleanupThread = (thread) => {
					if (!exited) cleanupThread(thread);
				};
			}],
			print: (line) => post({ kind: 'out', text: line }),
			printErr: (line) => {
				if (!waiting.test(line)) post({ kind: 'err', text: line });
			},
			locateFile: (path, prefix) => urls[path] || prefix + path,
			setStatus: () => {},
			onExit: (status) => {
				exited = true;
				void queuedMessagesHandled().then(() => post({ kind: 'exit', status }));
			},
			onAbort: abort,
			instantiateWasm(imports, receive) {
				// Emscripten's WasmOffsetConverter (return addresses and function names from stack traces) needs the
				// module's bytes, which its own instantiation would keep for it. Engines whose stack frames carry the
				// binary offset (V8) do without. For the others the first run makes it from the bytes and gives the page
				// its tables, which later runs get instead of the bytes.
				try {
					if (converter && converter.bytes) {
						const made = new WasmOffsetConverter(new Uint8Array(converter.bytes), new WebAssembly.Module(EMPTY_MODULE));
						globalThis.wasmOffsetConverter = made; // before receive(): threads get a copy when they start
						post({ kind: 'converter', data: { ...made } });
					} else if (converter && converter.data) {
						globalThis.wasmOffsetConverter = Object.assign(Object.create(WasmOffsetConverter.prototype), converter.data);
					}
				} catch (error) {
					abort(error);
					return {};
				}
				WebAssembly.instantiate(module, imports).then((instance) => receive(instance, module)).catch(abort);
				return {};
			},
		};
		const script = document.createElement('script');
		script.src = urls.glue;
		script.onerror = () => abort('Could not load ' + urls.glue);
		document.body.appendChild(script);
	});

	// (A statement of its own, not a tail call: WebKit names the wrong source for a message posted by a tail call.)
	parent.postMessage({ kind: 'ready' }, origin);
})();
