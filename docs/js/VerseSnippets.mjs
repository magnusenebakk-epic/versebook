// The Verse examples of a chapter and the test each one becomes.
//
// One implementation for two users: bin/extract writes every example's test to a .versetest file, which the book's
// checks run; a chapter's page composes the same test when a reader runs an example (js/VerseRun.js), from the parts
// bin/snippets saves for it. An ES module with no dependencies, so that Node and browsers both load it.

function extractPrependComment(lines, verseBlockStart) {
  // Look backwards from verseBlockStart to find <!--versetest or <!-- comment
  let commentLines = [];
  let i = verseBlockStart - 1;

  // Skip empty lines
  while (i >= 0 && lines[i].trim() === '') {
    i--;
  }

  // Skip numbered comment like <!-- 04 -->
  if (i >= 0 && /^<!--\s*\d+\s*-->$/.test(lines[i].trim())) {
    i--;
    // Skip more empty lines after the numbered comment
    while (i >= 0 && lines[i].trim() === '') {
      i--;
    }
  }

  if (i >= 0) {
    const trimmed = lines[i].trim();

    // Check for single-line marker <!--versetest-->
    if (trimmed === '<!--versetest-->') {
      // Empty marker - continue looking backward for actual content
      i--;
      // Skip empty lines
      while (i >= 0 && lines[i].trim() === '') {
        i--;
      }
      // Continue to check if there's a closing --> for a multi-line comment below
      if (i < 0) {
        return commentLines;
      }
      // Re-read the trimmed value at new position
      const newTrimmed = lines[i].trim();
      if (newTrimmed !== '-->') {
        // No --> found, return empty
        return commentLines;
      }
      // Fall through to the --> handling with updated trimmed value
      // (We don't return here, we let it continue to the --> block below)
    }

    // Re-read trimmed in case it was updated above
    const currentTrimmed = lines[i].trim();

    // Check if we found a closing --> (multi-line comment)
    if (currentTrimmed === '-->') {
      i--;
      // Collect lines until we find <!--versetest or <!--
      while (i >= 0) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith('<!--versetest') || trimmed.startsWith('<!-- versetest')) {
          // Found <!--versetest, extract content after it
          const marker = trimmed.startsWith('<!--versetest') ? '<!--versetest' : '<!-- versetest';
          const markerIndex = line.indexOf(marker);
          const firstLine = line.substring(markerIndex + marker.length).trim();
          if (firstLine) {
            commentLines.unshift(firstLine);
          }
          break;
        } else if (trimmed === '<!--') {
          // Found plain <!--, don't include the marker itself
          break;
        }
        commentLines.unshift(line);
        i--;
      }
    }
  }

  return commentLines;
}

// Comments that introduce the *following* snippet rather than annotate the
// preceding one: <!-- 04 -->, <!-- 28 FAILURE ... -->, <!--NoCompile--> and a
// bare <!--versetest-->. extractAppendComment must never consume one of these
// as trailing test code, or the marker word leaks into the generated file as a
// bare expression (e.g. "Unknown identifier `NoCompile`").
function isSnippetMarker(trimmed) {
  return /^<!--\s*\d+(\s+FAILURE.*?)?\s*-->$/.test(trimmed) ||
         /^<!--\s*NoCompile\s*-->$/.test(trimmed) ||
         /^<!--\s*versetest\s*-->$/.test(trimmed);
}

function extractAppendComment(lines, verseBlockEnd) {
  // Look forward from verseBlockEnd to find <!--versetest or <!-- comment
  let commentLines = [];
  let i = verseBlockEnd + 1;

  // Skip empty lines
  while (i < lines.length && lines[i].trim() === '') {
    i++;
  }

  // Check if we found an opening <!--versetest or <!--
  if (i < lines.length) {
    const trimmed = lines[i].trim();

    // Markers belong to the next snippet, not this one.
    if (isSnippetMarker(trimmed)) {
      return commentLines;
    }

    // Check for single-line comment like <!-- content -->
    if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) {
      // Extract content between <!-- and -->
      const match = trimmed.match(/^<!--\s*(.*?)\s*-->$/);
      if (match && match[1]) {
        commentLines.push(match[1]);
      }
      return commentLines;
    }

    if (trimmed.startsWith('<!--versetest') || trimmed.startsWith('<!-- versetest')) {
      // Extract content after <!--versetest on the same line
      const marker = trimmed.startsWith('<!--versetest') ? '<!--versetest' : '<!-- versetest';
      const markerIndex = lines[i].indexOf(marker);
      const firstLine = lines[i].substring(markerIndex + marker.length).trim();
      if (firstLine && firstLine !== '') {
        commentLines.push(firstLine);
      }
      i++;

      // Collect lines until we find -->
      while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '-->') {
          break;
        }
        commentLines.push(line);
        i++;
      }
    } else if (trimmed === '<!--') {
      // Found plain <!--
      i++;

      // Collect lines until we find -->
      while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '-->') {
          break;
        }
        commentLines.push(line);
        i++;
      }
    }
  }

  return commentLines;
}

function extractSnippetNumber(lines, verseBlockStart) {
  // Look backwards from verseBlockStart to find <!-- XX --> comment
  let i = verseBlockStart - 1;

  // Skip empty lines
  while (i >= 0 && lines[i].trim() === '') {
    i--;
  }

  // Check for numbered comment like <!-- 01 --> or <!-- 02 --> or <!-- 01 FAILURE... -->
  if (i >= 0) {
    const trimmed = lines[i].trim();
    const match = trimmed.match(/^<!--\s*(\d+)(?:\s+FAILURE.*)?\s*-->$/);
    if (match) {
      return match[1]; // Return the number as a string (already padded)
    }
  }

  return null;
}

// True when `lines[end]` is the closing `-->` of a multi-line marker whose
// opening line is `<!-- NN FAILURE`. Scans back at most 40 lines so a stray
// `-->` cannot make this walk the whole file.
function isMultilineFailureEnd(lines, end) {
  if (lines[end].trim() !== '-->') return false;
  for (let i = end - 1; i >= 0 && i > end - 40; i--) {
    const trimmed = lines[i].trim();
    if (/^<!--\s*\d+\s+FAILURE/.test(trimmed)) return true;
    // Any other marker opening means this `-->` belongs to something else.
    if (trimmed.startsWith('<!--')) return false;
  }
  return false;
}

function shouldSkipSnippet(lines, verseBlockStart) {
  // Look backwards from verseBlockStart to check for <!--NoCompile--> or FAILURE
  let i = verseBlockStart - 1;

  // Skip empty lines
  while (i >= 0 && lines[i].trim() === '') {
    i--;
  }

  // Check for numbered comment with FAILURE like <!-- 28 FAILURE... -->
  if (i >= 0) {
    const trimmed = lines[i].trim();
    if (/^<!--\s*\d+\s+FAILURE.*\s*-->$/.test(trimmed)) {
      return true;
    }
    // `bin/test_and_annotate` records the compiler output inside the marker,
    // which spreads it over several lines and leaves a bare `-->` here. Without
    // this case such a block still gets skipped, but by falling through to the
    // "no id" path below, so it is never counted as a known failure.
    if (isMultilineFailureEnd(lines, i)) {
      return true;
    }
  }

  // Skip numbered comments without FAILURE
  while (i >= 0 && /^<!--\s*\d+\s*-->$/.test(lines[i].trim())) {
    i--;
  }

  // Check if we found <!--NoCompile--> or <!-- NoCompile-->
  if (i >= 0 && (lines[i].trim() === '<!--NoCompile-->' || lines[i].trim() === '<!-- NoCompile-->')) {
    return true;
  }

  return false;
}
// Separate type definitions from test code. typeDefIndices and testCodeIndices give, for each line of the two
// lists, its index in the snippet (for mapping a composed test's lines back to the snippet's).
function separateTypeDefinitions(snippetLines) {
  const typeDefLines = [];
  const testCodeLines = [];
  const typeDefIndices = [];
  const testCodeIndices = [];

  let i = 0;
  while (i < snippetLines.length) {
    const line = snippetLines[i];
    const trimmed = line.trim();

    // Check if this line starts a type definition at base indentation
    // Pattern: identifier := (class|struct|module|interface|enum):
    // The optional parameter list covers parametric definitions such as
    // `container(t:type) := class:`, which must be hoisted to module scope too
    // (class definitions are not allowed inside an assert block).
    const isTypeDef = /^[a-zA-Z_][a-zA-Z0-9_]*\s*(\([^()]*\))?\s*:=\s*(class|struct|module|interface|enum)/.test(trimmed);

    // A type alias such as `ArrayType := []int` is also a type definition and
    // so also module scope only. Only right-hand sides that cannot be anything
    // but a type count, which keeps ordinary bindings like `X := 5` out; a call
    // such as `generic_class(int)` is indistinguishable from a function call and
    // is therefore left alone.
    const isTypeAlias = /^[a-zA-Z_][a-zA-Z0-9_]*\s*:=\s*(\[|\?|tuple\(|subtype\(|type\{|\S+\s*->)/.test(trimmed);

    if (isTypeAlias && line.match(/^\S/)) {
      // An alias is a single line with no body to collect
      typeDefLines.push(line);
      typeDefIndices.push(i);
      i++;
    } else if (isTypeDef && line.match(/^\S/)) {
      // This is a type definition at base indentation
      typeDefLines.push(line);
      typeDefIndices.push(i);
      i++;

      // Collect all indented lines that follow (the body of the type definition)
      while (i < snippetLines.length) {
        const nextLine = snippetLines[i];
        const nextTrimmed = nextLine.trim();

        // If we hit an empty line or a line at base indentation that's not indented, check if type def continues
        if (nextTrimmed === '') {
          // Empty line - include it
          typeDefLines.push(nextLine);
          typeDefIndices.push(i);
          i++;
        } else if (nextLine.match(/^\s/)) {
          // Indented line - part of the type definition body
          typeDefLines.push(nextLine);
          typeDefIndices.push(i);
          i++;
        } else {
          // Non-indented, non-empty line - type definition has ended
          break;
        }
      }
    } else {
      // Not a type definition, it's test code
      testCodeLines.push(line);
      testCodeIndices.push(i);
      i++;
    }
  }

  return { typeDefLines, testCodeLines, typeDefIndices, testCodeIndices };
}

// What every test starts with. Run in bulk, the tests print nothing: Print is a stub. `printOutput` has it print
// through the test runner's DebugPrint instead, for a reader who runs one example and wants to see what it prints.
const TEST_USING = [
  'using { /Verse.org/Tests/VerseTestScriptCmd }',
  'using { /Verse.org/Concurrency }'
];
const SLEEP_STUB = 'Sleep(:float)<transacts><suspends>:void={}';
const PRINT_STUB = 'Print(Message:string)<computes>:void={}';
const PRINT_OUTPUT = 'Print(Message:string)<computes>:void=DebugPrint(Message)';

// Composes a snippet's test from its parts: `code` (the displayed lines), `prepend` and `append` (the hidden setup
// before it and checks after it). Returns the test's text (`content`) and where each of its lines came from (`where`):
// null for a line of the test's own (the stubs, the assert block's first line), or {part, line, shift}: the part
// ('code', 'setup' for prepend, 'checks' for append), the line's index in it, and how many columns to the right of its
// place there it starts in the test (the assert block's indentation).
export function composeTest({ code, prepend, append }, options = {}) {
  // Separate type definitions from test code
  const { typeDefLines, testCodeLines, typeDefIndices, testCodeIndices } = separateTypeDefinitions(code);

  // Always use test infrastructure (all snippets are treated as tests), then the stub definitions
  const parts = [
    ...TEST_USING,
    SLEEP_STUB,
    options.printOutput ? PRINT_OUTPUT : PRINT_STUB
  ];
  const where = parts.map(() => null);
  parts.push(...prepend);
  where.push(...prepend.map((_, line) => ({ part: 'setup', line, shift: 0 })));

  // Add type definitions at module scope (if any)
  if (typeDefLines.length > 0) {
    parts.push(...typeDefLines);
    where.push(...typeDefIndices.map(line => ({ part: 'code', line, shift: 0 })));
  }

  // Only add assert: block if there's test code or append lines
  if (testCodeLines.length > 0 || append.length > 0) {
    parts.push('assert:');
    where.push(null);

    // Add test code (indented)
    parts.push(...testCodeLines.map(line => '    ' + line));
    where.push(...testCodeIndices.map(line => ({ part: 'code', line, shift: 4 })));

    // Add append lines (indented)
    parts.push(...append.map(line => '    ' + line));
    where.push(...append.map((_, line) => ({ part: 'checks', line, shift: 4 })));
  }

  return { content: parts.join('\n'), where };
}

// Lines the test runner prints that aren't the example's: the engine's log lines, compile errors' second lines, the
// runner's own remarks ("*** Warning: test had zero asserts in it ***"), and what the WebAssembly build says while it
// starts.
const NOT_THE_EXAMPLES = /^(Log\w*: |\[\d{4}\.\d\d\.\d\d-|Used inside function |\*\*\* .* \*\*\*$|Used memory before allocating anything was |Failed to open read: |Blocking on the main thread is very dangerous)/;

// Reads what the test runner printed for a test composed by composeTest (`lines`: its output; `where`: the test's), as
// bin/vtest reads it. Returns
//   errors, warnings  the compiler's, each {part, line, column, message} placed in the part of the test it is in
//                     (line and column counted from 1 there; part: null for a line of the test's own). A warning
//                     doesn't fail the test; only those in the example's code are kept.
//   checksFailed      the test compiled and then failed: a runtime error in the example, or a check after it
//   printed           every other line that isn't the runner's own: what the example printed
export function readTestOutput(lines, where) {
  const located = /^(?:LogVerseBuild: (?:Error|Warning): )?(.*?)\((\d+),(\d+),\s*(\d+),(\d+)\):\s*(.*)$/;
  const errors = [];
  const warnings = [];
  const printed = [];
  let checksFailed = false;
  for (const line of lines) {
    const text = line.replace(/\r$/, '');
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
      const from = row >= 1 && row <= where.length ? where[row - 1] : null;
      const place = from
        ? { part: from.part, line: from.line + 1, column: Math.max(1, column - from.shift), message }
        : { part: null, message };
      if (kind && kind[1] === 'Script Warning') {
        if (place.part === 'code') warnings.push(place);
      } else {
        errors.push(place);
      }
    } else if (/^\*\*\* Testing completed with \d+ errors?\. \*\*\*/.test(text)) {
      if (errors.length === 0) checksFailed = true;
    } else if (text.trim() && !NOT_THE_EXAMPLES.test(text)) {
      printed.push(text);
    }
  }
  return { errors, warnings, printed, checksFailed };
}

export function extractVerseSnippets(markdownContent, sourceName) {
  const snippets = [];
  const skipped = [];
  const lines = markdownContent.split('\n');
  let inVerseBlock = false;
  let currentSnippet = [];
  let verseBlockStart = -1;
  const seenNumbers = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```verse')) {
      inVerseBlock = true;
      verseBlockStart = i;
      currentSnippet = [];
    } else if (inVerseBlock && line.trim().startsWith('```')) {
      inVerseBlock = false;

      // Skip this snippet if it has <!--NoCompile--> marker
      if (shouldSkipSnippet(lines, verseBlockStart)) {
        skipped.push({ line: verseBlockStart + 1, reason: 'marked NoCompile or FAILURE' });
        continue;
      }

      // Extract the snippet number from the comment
      const snippetNumber = extractSnippetNumber(lines, verseBlockStart);

      // Skip snippets without explicit number. This is the silent-rot case: an
      // id that is missing, or spelled in a way the pattern above rejects (a
      // letter suffix such as `46b`), drops the block from the test suite while
      // it still renders as an example, so report it rather than just skipping.
      if (!snippetNumber) {
        skipped.push({ line: verseBlockStart + 1, reason: 'no usable <!-- NN --> id' });
        continue;
      }

      const number = snippetNumber;

      // Look for prepend comment before the ```verse block
      // If no <!--versetest marker found, returns empty array (treats as empty versetest)
      const prependLines = extractPrependComment(lines, verseBlockStart);

      // Look for append comment after the closing ```
      // If no comment found, returns empty array
      const appendLines = extractAppendComment(lines, i);

      // The "display-only" convention: a prepend ending in `<#` comments out
      // everything emitted after it (hoisted types, the assert block and the
      // displayed snippet), and an appended `#>` closes that comment. If only
      // one half is present the generated file cannot parse, so say so instead
      // of silently writing a file that fails with a confusing syntax error.
      // `<#` may sit on its own line or be tacked onto the end of the last
      // prepend line (e.g. `}<#`), so match a trailing occurrence either way.
      const opensComment = prependLines.some(l => l.trim().endsWith('<#'));
      const closesComment = appendLines.some(l => l.trim().endsWith('#>'));
      if (opensComment !== closesComment) {
        const detail = opensComment
              ? 'prepend opens `<#` but no `<!-- #> -->` follows the block'
              : 'appended `#>` has no matching `<#` at the end of the prepend';
        console.warn(`Warning: ${sourceName} snippet ${number}: ${detail}`);
      }

      // Snippet numbers become filenames, so a duplicate silently overwrites
      // the earlier snippet's test. Catch that rather than losing coverage.
      if (seenNumbers.has(number)) {
        console.warn(`Warning: ${sourceName} snippet ${number}: duplicate number, ` +
                     `this snippet overwrites the earlier one`);
      }
      seenNumbers.add(number);

      // Claim check: if the displayed code says something is an error, the
      // prepend should prove it with assert_semantic_error/assert_syntax_error.
      // Otherwise the claim is untested prose and can be (and has been) wrong.
      const claimsError = currentSnippet.some(l => /#.*\bERROR\b/.test(l));
      const provesError = prependLines.some(
        l => /assert_semantic_error|assert_syntax_error/.test(l));
      if (claimsError && !provesError) {
        console.warn(`Warning: ${sourceName} snippet ${number}: displayed code claims an ` +
                     `ERROR but the prepend does not assert one`);
      }

      // The test: stubs, the hidden setup, the snippet (types hoisted, the rest in an assert block), the hidden checks
      const { content } = composeTest({ code: currentSnippet, prepend: prependLines, append: appendLines });

      snippets.push({
        number: number,
        content: content,
        // The parts, for a page that composes the test again from an edited snippet
        code: currentSnippet,
        prepend: prependLines,
        append: appendLines,
        line: verseBlockStart + 1
      });
    } else if (inVerseBlock) {
      currentSnippet.push(line);
    }
  }

  snippets.skipped = skipped;
  return snippets;
}
