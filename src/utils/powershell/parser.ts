import { execa } from 'execa'
import { logForDebugging } from '../debug.js'
import { memoizeWithLRU } from '../memoize.js'
import { getCachedPowerShellPath } from '../shell/powershellDetection.js'
export const PARSE_SCRIPT_BODY = `
if (-not $EncodedCommand) {
    Write-Output '{"valid":false,"errors":[{"message":"No command provided","errorId":"NoInput"}],"statements":[],"variables":[],"hasStopParsing":false,"originalCommand":""}'
    exit 0
}

$Command = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EncodedCommand))

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput(
    $Command,
    [ref]$tokens,
    [ref]$parseErrors
)

$allVariables = [System.Collections.ArrayList]::new()

function Get-RawCommandElements {
    param([System.Management.Automation.Language.CommandAst]$CmdAst)
    $elems = [System.Collections.ArrayList]::new()
    foreach ($ce in $CmdAst.CommandElements) {
        $ceData = @{ type = $ce.GetType().Name; text = $ce.Extent.Text }
        if ($ce.PSObject.Properties['Value'] -and $null -ne $ce.Value -and $ce.Value -is [string]) {
            $ceData.value = $ce.Value
        }
        if ($ce -is [System.Management.Automation.Language.CommandExpressionAst]) {
            $ceData.expressionType = $ce.Expression.GetType().Name
        }
        $a=$ce.Argument;if($a){$ceData.children=@(@{type=$a.GetType().Name;text=$a.Extent.Text})}
        [void]$elems.Add($ceData)
    }
    return $elems
}

function Get-RawRedirections {
    param($Redirections)
    $result = [System.Collections.ArrayList]::new()
    foreach ($redir in $Redirections) {
        $redirData = @{ type = $redir.GetType().Name }
        if ($redir -is [System.Management.Automation.Language.FileRedirectionAst]) {
            $redirData.append = [bool]$redir.Append
            $redirData.fromStream = $redir.FromStream.ToString()
            $redirData.locationText = $redir.Location.Extent.Text
        }
        [void]$result.Add($redirData)
    }
    return $result
}

function Get-SecurityPatterns($A) {
    $p = @{}
    foreach ($n in $A.FindAll({ param($x)
        $x -is [System.Management.Automation.Language.MemberExpressionAst] -or
        $x -is [System.Management.Automation.Language.SubExpressionAst] -or
        $x -is [System.Management.Automation.Language.ArrayExpressionAst] -or
        $x -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -or
        $x -is [System.Management.Automation.Language.ScriptBlockExpressionAst] -or
        $x -is [System.Management.Automation.Language.ParenExpressionAst]
    }, $true)) { switch ($n.GetType().Name) {
        'InvokeMemberExpressionAst' { $p.hasMemberInvocations = $true }
        'MemberExpressionAst' { $p.hasMemberInvocations = $true }
        'SubExpressionAst' { $p.hasSubExpressions = $true }
        'ArrayExpressionAst' { $p.hasSubExpressions = $true }
        'ParenExpressionAst' { $p.hasSubExpressions = $true }
        'ExpandableStringExpressionAst' { $p.hasExpandableStrings = $true }
        'ScriptBlockExpressionAst' { $p.hasScriptBlocks = $true }
    }}
    if ($p.Count -gt 0) { return $p }
    return $null
}

$varExprs = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.VariableExpressionAst] }, $true)
foreach ($v in $varExprs) {
    [void]$allVariables.Add(@{
        path = $v.VariablePath.ToString()
        isSplatted = [bool]$v.Splatted
    })
}

$typeLiterals = [System.Collections.ArrayList]::new()
foreach ($t in $ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.TypeExpressionAst] -or
    $n -is [System.Management.Automation.Language.TypeConstraintAst]
}, $true)) { [void]$typeLiterals.Add($t.TypeName.FullName) }

$hasStopParsing = $false
$tk = [System.Management.Automation.Language.TokenKind]
foreach ($tok in $tokens) {
    if ($tok.Kind -eq $tk::MinusMinus) { $hasStopParsing = $true; break }
    if ($tok.Kind -eq $tk::Generic -and ($tok.Text -replace '[\u2013\u2014\u2015]','-') -eq '--%') {
        $hasStopParsing = $true; break
    }
}

$statements = [System.Collections.ArrayList]::new()

function Process-BlockStatements {
    param($Block)
    if (-not $Block) { return }

    foreach ($stmt in $Block.Statements) {
        $statement = @{
            type = $stmt.GetType().Name
            text = $stmt.Extent.Text
        }

        if ($stmt -is [System.Management.Automation.Language.PipelineAst]) {
            $elements = [System.Collections.ArrayList]::new()
            foreach ($element in $stmt.PipelineElements) {
                $elemData = @{
                    type = $element.GetType().Name
                    text = $element.Extent.Text
                }

                if ($element -is [System.Management.Automation.Language.CommandAst]) {
                    $elemData.commandElements = @(Get-RawCommandElements -CmdAst $element)
                    $elemData.redirections = @(Get-RawRedirections -Redirections $element.Redirections)
                } elseif ($element -is [System.Management.Automation.Language.CommandExpressionAst]) {
                    $elemData.expressionType = $element.Expression.GetType().Name
                    $elemData.redirections = @(Get-RawRedirections -Redirections $element.Redirections)
                }

                [void]$elements.Add($elemData)
            }
            $statement.elements = @($elements)

            $allNestedCmds = $stmt.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
                $true
            )
            $nestedCmds = [System.Collections.ArrayList]::new()
            foreach ($cmd in $allNestedCmds) {
                if ($cmd.Parent -eq $stmt) { continue }
                $nested = @{
                    type = $cmd.GetType().Name
                    text = $cmd.Extent.Text
                    commandElements = @(Get-RawCommandElements -CmdAst $cmd)
                    redirections = @(Get-RawRedirections -Redirections $cmd.Redirections)
                }
                [void]$nestedCmds.Add($nested)
            }
            if ($nestedCmds.Count -gt 0) {
                $statement.nestedCommands = @($nestedCmds)
            }
            $r = $stmt.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
            if ($r.Count -gt 0) {
                $rr = @(Get-RawRedirections -Redirections $r)
                $statement.redirections = if ($statement.redirections) { @($statement.redirections) + $rr } else { $rr }
            }
        } else {
            $nestedCmdAsts = $stmt.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
                $true
            )
            $nested = [System.Collections.ArrayList]::new()
            foreach ($cmd in $nestedCmdAsts) {
                [void]$nested.Add(@{
                    type = 'CommandAst'
                    text = $cmd.Extent.Text
                    commandElements = @(Get-RawCommandElements -CmdAst $cmd)
                    redirections = @(Get-RawRedirections -Redirections $cmd.Redirections)
                })
            }
            if ($nested.Count -gt 0) {
                $statement.nestedCommands = @($nested)
            }
            $r = $stmt.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
            if ($r.Count -gt 0) { $statement.redirections = @(Get-RawRedirections -Redirections $r) }
        }

        $sp = Get-SecurityPatterns $stmt
        if ($sp) { $statement.securityPatterns = $sp }

        [void]$statements.Add($statement)
    }

    if ($Block.Traps) {
        foreach ($trap in $Block.Traps) {
            $statement = @{
                type = 'TrapStatementAst'
                text = $trap.Extent.Text
            }
            $nestedCmdAsts = $trap.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
                $true
            )
            $nestedCmds = [System.Collections.ArrayList]::new()
            foreach ($cmd in $nestedCmdAsts) {
                $nested = @{
                    type = $cmd.GetType().Name
                    text = $cmd.Extent.Text
                    commandElements = @(Get-RawCommandElements -CmdAst $cmd)
                    redirections = @(Get-RawRedirections -Redirections $cmd.Redirections)
                }
                [void]$nestedCmds.Add($nested)
            }
            if ($nestedCmds.Count -gt 0) {
                $statement.nestedCommands = @($nestedCmds)
            }
            $r = $trap.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
            if ($r.Count -gt 0) { $statement.redirections = @(Get-RawRedirections -Redirections $r) }
            $sp = Get-SecurityPatterns $trap
            if ($sp) { $statement.securityPatterns = $sp }
            [void]$statements.Add($statement)
        }
    }
}

Process-BlockStatements -Block $ast.BeginBlock
Process-BlockStatements -Block $ast.ProcessBlock
Process-BlockStatements -Block $ast.EndBlock
Process-BlockStatements -Block $ast.CleanBlock
Process-BlockStatements -Block $ast.DynamicParamBlock

if ($ast.ParamBlock) {
  $pb = $ast.ParamBlock
  $pn = [System.Collections.ArrayList]::new()
  foreach ($c in $pb.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]}, $true)) {
    [void]$pn.Add(@{type='CommandAst';text=$c.Extent.Text;commandElements=@(Get-RawCommandElements -CmdAst $c);redirections=@(Get-RawRedirections -Redirections $c.Redirections)})
  }
  $pr = $pb.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
  $ps = Get-SecurityPatterns $pb
  if ($pn.Count -gt 0 -or $pr.Count -gt 0 -or $ps) {
    $st = @{type='ParamBlockAst';text=$pb.Extent.Text}
    if ($pn.Count -gt 0) { $st.nestedCommands = @($pn) }
    if ($pr.Count -gt 0) { $st.redirections = @(Get-RawRedirections -Redirections $pr) }
    if ($ps) { $st.securityPatterns = $ps }
    [void]$statements.Add($st)
  }
}

$hasUsingStatements = $ast.UsingStatements -and $ast.UsingStatements.Count -gt 0
$hasScriptRequirements = $ast.ScriptRequirements -ne $null

$output = @{
    valid = ($parseErrors.Count -eq 0)
    errors = @($parseErrors | ForEach-Object {
        @{
            message = $_.Message
            errorId = $_.ErrorId
        }
    })
    statements = @($statements)
    variables = @($allVariables)
    hasStopParsing = $hasStopParsing
    originalCommand = $Command
    typeLiterals = @($typeLiterals)
    hasUsingStatements = [bool]$hasUsingStatements
    hasScriptRequirements = [bool]$hasScriptRequirements
}

$output | ConvertTo-Json -Depth 10 -Compress
`
const INVALID_RESULT_BASE: Omit<
  ParsedPowerShellCommand,
  'errors' | 'originalCommand'
> = {
  valid: false,
  statements: [],
  variables: [],
  hasStopParsing: false,
}

const WINDOWS_ARGV_CAP = 32_767
// pwsh path + " -NoProfile -NonInteractive -NoLogo -EncodedCommand " +
// argv quoting. A long Windows pwsh path (C:\Program Files\PowerShell\7\
// pwsh.exe) + flags is ~95 chars; 200 leaves headroom for unusual installs.
const FIXED_ARGV_OVERHEAD = 200
// "$EncodedCommand = '" + "'\n" wrapper around the user command's base64
const ENCODED_CMD_WRAPPER = `$EncodedCommand = ''\n`.length
// Margin for base64 padding rounding (≤4 chars at each of 2 levels) and minor
// estimation drift. Multibyte expansion is NOT absorbed here — the gate
// measures actual UTF-8 bytes (Buffer.byteLength), not code units.
const SAFETY_MARGIN = 100
const SCRIPT_CHARS_BUDGET = ((WINDOWS_ARGV_CAP - FIXED_ARGV_OVERHEAD) * 3) / 8
const CMD_B64_BUDGET =
  SCRIPT_CHARS_BUDGET - PARSE_SCRIPT_BODY.length - ENCODED_CMD_WRAPPER
// Exported for drift-guard tests (the drift-prone value is the Windows one).
// Unit: UTF-8 BYTES. Compare against Buffer.byteLength, not .length.
export const WINDOWS_MAX_COMMAND_LENGTH = Math.max(
  0,
  Math.floor((CMD_B64_BUDGET * 3) / 4) - SAFETY_MARGIN,
)
const UNIX_MAX_COMMAND_LENGTH = 4_500
// Unit: UTF-8 BYTES (see SECURITY note above).
export const MAX_COMMAND_LENGTH =
  process.platform === 'win32'
    ? WINDOWS_MAX_COMMAND_LENGTH
    : UNIX_MAX_COMMAND_LENGTH
// ---------------------------------------------------------------------------
// Public types describing the parsed output returned to callers.
// These map to System.Management.Automation.Language AST classes.
// Raw internal types (RawParsedOutput etc.) are defined further below.
// ---------------------------------------------------------------------------

/**
 * The PowerShell AST element type for pipeline elements.
 * Maps directly to CommandBaseAst derivatives in System.Management.Automation.Language.
 */
type PipelineElementType =
  | 'CommandAst'
  | 'CommandExpressionAst'
  | 'ParenExpressionAst'
/**
 * The AST node type for individual command elements (arguments, expressions).
 * Used to classify each element during the AST walk so TypeScript can derive
 * security flags without extra Find-AstNodes calls in PowerShell.
 */
type CommandElementType =
  | 'ScriptBlock'
  | 'SubExpression'
  | 'ExpandableString'
  | 'MemberInvocation'
  | 'Variable'
  | 'StringConstant'
  | 'Parameter'
  | 'Other'
/**
 * A child node of a command element (one level deep). Populated for
 * CommandParameterAst → .Argument (colon-bound parameters like
 * `-InputObject:$env:SECRET`). Consumers check `child.type` to classify
 * the bound value (Variable, StringConstant, Other) without parsing text.
 */
export type CommandElementChild = {
  type: CommandElementType
  text: string
}
export type RawRedirection = {
  type: string // "FileRedirectionAst" or "MergingRedirectionAst"
  append?: boolean // .Append (FileRedirectionAst only)
  fromStream?: string // .FromStream.ToString() e.g. "Output", "Error", "All"
  locationText?: string // .Location.Extent.Text (FileRedirectionAst only)
}
export type RawCommandElement = {
  type: string // .GetType().Name e.g. "StringConstantExpressionAst"
  text: string // .Extent.Text
  value?: string // .Value if available (resolves backtick escapes)
  expressionType?: string // .Expression.GetType().Name for CommandExpressionAst
  children?: { type: string; text: string }[] // CommandParameterAst.Argument, one level
}
export type RawPipelineElement = {
  type: string // .GetType().Name e.g. "CommandAst", "CommandExpressionAst"
  text: string // .Extent.Text
  commandElements?: RawCommandElement[]
  redirections?: RawRedirection[]
  expressionType?: string // for CommandExpressionAst: .Expression.GetType().Name
}
export type RawStatement = {
  type: string // .GetType().Name e.g. "PipelineAst", "IfStatementAst", "TrapStatementAst"
  text: string // .Extent.Text
  elements?: RawPipelineElement[] // for PipelineAst: the pipeline elements
  nestedCommands?: RawPipelineElement[] // commands found via FindAll (all statement types)
  redirections?: RawRedirection[] // FileRedirectionAst found via FindAll (non-PipelineAst only)
  securityPatterns?: {
    // Security-relevant AST node types found via FindAll on the statement
    hasMemberInvocations?: boolean
    hasSubExpressions?: boolean
    hasExpandableStrings?: boolean
    hasScriptBlocks?: boolean
  }
}

type RawParsedOutput = {
  valid: boolean
  errors: { message: string; errorId: string }[]
  statements: RawStatement[]
  variables: { path: string; isSplatted: boolean }[]
  hasStopParsing: boolean
  originalCommand: string
  typeLiterals?: string[]
  hasUsingStatements?: boolean
  hasScriptRequirements?: boolean
}

/**
 * The PowerShell AST statement type.
 * Maps directly to StatementAst derivatives in System.Management.Automation.Language.
 */
type StatementType =
  | 'PipelineAst'
  | 'PipelineChainAst'
  | 'AssignmentStatementAst'
  | 'IfStatementAst'
  | 'ForStatementAst'
  | 'ForEachStatementAst'
  | 'WhileStatementAst'
  | 'DoWhileStatementAst'
  | 'DoUntilStatementAst'
  | 'SwitchStatementAst'
  | 'TryStatementAst'
  | 'TrapStatementAst'
  | 'FunctionDefinitionAst'
  | 'DataStatementAst'
  | 'UnknownStatementAst'
/**
 * A command invocation within a pipeline segment.
 */
export type ParsedCommandElement = {
  /** The command/cmdlet name (e.g., "Get-ChildItem", "git") */
  name: string
  /** The command name type: cmdlet, application (exe), or unknown */
  nameType: 'cmdlet' | 'application' | 'unknown'
  /** The AST element type from PowerShell's parser */
  elementType: PipelineElementType
  /** All arguments as strings (includes flags like "-Recurse") */
  args: string[]
  /** The full text of this command element */
  text: string
  /** AST node types for each element in this command (arguments, expressions, etc.) */
  elementTypes?: CommandElementType[]
  /**
   * Child nodes of each argument, aligned with `args[]` (so
   * `children[i]` ↔ `args[i]` ↔ `elementTypes[i+1]`). Only populated for
   * Parameter elements with a colon-bound argument. Undefined for elements
   * with no children. Lets consumers check `children[i].some(c => c.type
   * !== 'StringConstant')` instead of parsing the arg text for `:` + `$`.
   */
  children?: (CommandElementChild[] | undefined)[]
  /** Redirections on this command element (from nested commands in && / || chains) */
  redirections?: ParsedRedirection[]
}
/**
 * A redirection found in the command.
 */
type ParsedRedirection = {//重定向
  /** The redirection operator */
  operator: '>' | '>>' | '2>' | '2>>' | '*>' | '*>>' | '2>&1'
  /** The target (file path or stream number) */
  target: string
  /** Whether this is a merging redirection like 2>&1 */
  isMerging: boolean
}

/**
 * A parsed statement from PowerShell.
 * Can be a pipeline, assignment, control flow statement, etc.
 */
type ParsedStatement = {
  /** The AST statement type from PowerShell's parser */
  statementType: StatementType
  /** Individual commands in this statement (for pipelines) */
  commands: ParsedCommandElement[]
  /** Redirections on this statement */
  redirections: ParsedRedirection[]
  /** Full text of the statement */
  text: string
  /**
   * For control flow statements (if, for, foreach, while, try, etc.),
   * commands found recursively inside the body blocks.
   * Uses FindAll() to extract ALL nested CommandAst nodes at any depth.
   */
  nestedCommands?: ParsedCommandElement[]
  /**
   * Security-relevant AST patterns found via FindAll() on the entire statement,
   * regardless of statement type. This catches patterns that elementTypes may
   * miss (e.g. member invocations inside assignments, subexpressions in
   * non-pipeline statements). Computed in the PS1 script using instanceof
   * checks against the PowerShell AST type system.
   */
  securityPatterns?: {
    hasMemberInvocations?: boolean
    hasSubExpressions?: boolean
    hasExpandableStrings?: boolean
    hasScriptBlocks?: boolean
  }
}

/**
 * A variable reference found in the command.
 */
type ParsedVariable = {
  /** The variable path (e.g., "HOME", "env:PATH", "global:x") */
  path: string
  /** Whether this variable uses splatting (@var instead of $var) */
  isSplatted: boolean
}
/**
 * A parse error from PowerShell's parser.
 */
type ParseError = {
  message: string
  errorId: string
}

/**
 * The complete parsed result from the PowerShell AST parser.
 */
export type ParsedPowerShellCommand = {
  /** Whether the command parsed successfully (no syntax errors) */
  valid: boolean
  /** Parse errors, if any */
  errors: ParseError[]
  /** Top-level statements, separated by ; or newlines */
  statements: ParsedStatement[]
  /** All variable references found */
  variables: ParsedVariable[]
  /** Whether the token stream contains a stop-parsing (--%) token */
  hasStopParsing: boolean
  /** The original command text */
  originalCommand: string
  /**
   * All .NET type literals found anywhere in the AST (TypeExpressionAst +
   * TypeConstraintAst). TypeName.FullName — the literal text as written, NOT
   * the resolved .NET type (e.g. [int] → "int", not "System.Int32").
   * Consumed by the CLM-allowlist check in powershellSecurity.ts.
   */
  typeLiterals?: string[]
  /**
   * Whether the command contains `using module` or `using assembly` statements.
   * These load external code (modules/assemblies) and execute their top-level
   * script body or module initializers. The using statement is a sibling of
   * the named blocks on ScriptBlockAst, not a child, so it is not visible
   * to Process-BlockStatements or any downstream command walker.
   */
  hasUsingStatements?: boolean
  /**
   * Whether the command contains `#Requires` directives (ScriptRequirements).
   * `#Requires -Modules <name>` triggers module loading from PSModulePath.
   */
  hasScriptRequirements?: boolean
}

// Error IDs from makeInvalidResult that represent transient process failures.
// These should be evicted from the cache so subsequent calls can retry.
// Deterministic failures (CommandTooLong, syntax errors from successful parses)
// should stay cached since retrying would produce the same result.
const TRANSIENT_ERROR_IDS = new Set([
  'PwshSpawnError',
  'PwshError',
  'PwshTimeout',
  'EmptyOutput',
  'InvalidJson',
])

// Default 5s is fine for interactive use (warm pwsh spawn is ~450ms). Windows
// CI under Defender/AMSI load can exceed 5s on consecutive spawns even after
// CAN_SPAWN_PARSE_SCRIPT() warms the JIT (run 23574701241 windows-shard-5:
// attackVectors F1 hit 2×5s timeout → valid:false → 'ask' instead of 'deny').
// Override via env for tests. Read inside parsePowerShellCommandImpl, not
// top-level, per CLAUDE.md (globalSettings.env ordering).
const DEFAULT_PARSE_TIMEOUT_MS = 5_000
function getParseTimeoutMs(): number {
  const env = process.env.PWSH_PARSE_TIMEOUT_MS
  if (env) {
    const parsed = parseInt(env, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_PARSE_TIMEOUT_MS
}
export const parsePowerShellCommandCached = memoizeWithLRU(
  (command: string) => {
    const promise = parsePowerShellCommandImpl(command)
    // Evict transient failures after resolution so they can be retried.
    // The current caller still receives the cached promise for this call,
    // ensuring concurrent callers share the same result.
    void promise.then(result => {
      if (
        !result.valid &&
        TRANSIENT_ERROR_IDS.has(result.errors[0]?.errorId ?? '')
      ) {
        parsePowerShellCommandCached.cache.delete(command)
      }
    })
    return promise
  },
  (command: string) => command,
  256,
)
export { parsePowerShellCommandCached as parsePowerShellCommand }

/**
 * Parse a PowerShell command using the native AST parser.
 * Spawns pwsh to parse the command and returns structured results.
 * Results are memoized by command string.
 *
 * @param command - The PowerShell command to parse
 * @returns Parsed command structure, or a result with valid=false on failure
 */
async function parsePowerShellCommandImpl(
  command: string,
): Promise<ParsedPowerShellCommand> {
  // SECURITY: MAX_COMMAND_LENGTH is a UTF-8 BYTE budget (see derivation at the
  // constant definition). command.length counts UTF-16 code units; a CJK
  // character is 1 code unit but 3 UTF-8 bytes, so .length under-reports by
  // up to 3× and allows argv overflow on Windows → CreateProcess fails →
  // valid:false → deny rules degrade to ask. Finding #36.
  const commandBytes = Buffer.byteLength(command, 'utf8')
  if (commandBytes > MAX_COMMAND_LENGTH) {//命令长度太长
    return makeInvalidResult(
      command,
      `Command too long for parsing (${commandBytes} bytes). Maximum supported length is ${MAX_COMMAND_LENGTH} bytes.`,
      'CommandTooLong',
    )
  }

  const pwshPath = await getCachedPowerShellPath()//能不能获取powershell的路径
  if (!pwshPath) {
    return makeInvalidResult(
      command,
      'PowerShell is not available',
      'NoPowerShell',
    )
  }

  const script = buildParseScript(command)//生成完整 PowerShell 脚本，里面包含 $EncodedCommand = '...' 和 PARSE_SCRIPT_BODY。

  // Pass the script to PowerShell via -EncodedCommand.
  // -EncodedCommand takes a Base64-encoded UTF-16LE string and executes it,
  // which avoids: (1) stdin interactive-mode issues where -File - produces
  // PS prompts and ANSI escapes in stdout, (2) command-line escaping issues,
  // (3) temp files. The script itself is large but well within OS arg limits
  // (Windows: 32K chars, Unix: typically 2MB+).
  const encodedScript = toUtf16LeBase64(script)//因为 PowerShell 的 -EncodedCommand 要求是 UTF-16LE 编码后再 Base64，不是 UTF-8。
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-NoLogo',
    '-EncodedCommand',
    encodedScript,
  ]

  // Spawn pwsh with one retry on timeout. On loaded CI runners (Windows
  // especially), pwsh spawn + .NET JIT + ParseInput occasionally exceeds 5s
  // even after CAN_SPAWN_PARSE_SCRIPT() warms the JIT. execa kills the process
  // but exitCode is undefined, which the old code reported as the misleading
  // "pwsh exited with code 1:" with empty stderr. A single retry absorbs
  // transient load spikes; a double timeout is reported as PwshTimeout.
  // 用 execa 启动：pwsh -NoProfile -NonInteractive -NoLogo -EncodedCommand <base64>也就是让 pwsh 执行那段“解析器脚本”。
  const parseTimeoutMs = getParseTimeoutMs()
  let stdout = ''
  let stderr = ''
  let code: number | null = null
  let timedOut = false
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await execa(pwshPath, args, {
        timeout: parseTimeoutMs,
        reject: false,
      })
      stdout = result.stdout
      stderr = result.stderr
      timedOut = result.timedOut
      code = result.failed ? (result.exitCode ?? 1) : 0
    } catch (e: unknown) {
      logForDebugging(
        `PowerShell parser: failed to spawn pwsh: ${e instanceof Error ? e.message : e}`,
      )
      return makeInvalidResult(
        command,
        `Failed to spawn PowerShell: ${e instanceof Error ? e.message : e}`,
        'PwshSpawnError',
      )
    }
    if (!timedOut) break
    logForDebugging(
      `PowerShell parser: pwsh timed out after ${parseTimeoutMs}ms (attempt ${attempt + 1})`,
    )
  }

  if (timedOut) {
    return makeInvalidResult(
      command,
      `pwsh timed out after ${parseTimeoutMs}ms (2 attempts)`,
      'PwshTimeout',
    )
  }

  if (code !== 0) {
    logForDebugging(
      `PowerShell parser: pwsh exited with code ${code}, stderr: ${stderr}`,
    )
    return makeInvalidResult(
      command,
      `pwsh exited with code ${code}: ${stderr}`,
      'PwshError',
    )
  }

  const trimmed = stdout.trim()
  if (!trimmed) {
    logForDebugging('PowerShell parser: empty stdout from pwsh')
    return makeInvalidResult(
      command,
      'No output from PowerShell parser',
      'EmptyOutput',
    )
  }

  try {
    const raw = JSON.parse(trimmed) as RawParsedOutput
    return transformRawOutput(raw)
  } catch {
    logForDebugging(
      `PowerShell parser: invalid JSON output: ${trimmed.slice(0, 200)}`,
    )
    return makeInvalidResult(
      command,
      'Invalid JSON from PowerShell parser',
      'InvalidJson',
    )
  }
}
function makeInvalidResult(
  command: string,
  message: string,
  errorId: string,
): ParsedPowerShellCommand {
  return {
    ...INVALID_RESULT_BASE,
    errors: [{ message, errorId }],
    originalCommand: command,
  }
}
/**
 * Build the full PowerShell script that parses a command.
 * The user command is Base64-encoded (UTF-8) and embedded in a variable
 * to prevent injection attacks.把命令解析成：AST（抽象语法树）
  把用户输入的 PowerShell 命令安全地嵌入到一个 PowerShell 解析脚本里，并避免命令注入。因为直接拼接用户输入很危险。
*/
function buildParseScript(command: string): string {
  const encoded =
    typeof Buffer !== 'undefined'
      ? Buffer.from(command, 'utf8').toString('base64')//把用户输入编码
      : btoa(
          new TextEncoder()
            .encode(command)
            .reduce((s, b) => s + String.fromCharCode(b), ''),
        )
  return `$EncodedCommand = '${encoded}'\n${PARSE_SCRIPT_BODY}`//然后拼接上完整 PowerShell AST 解析器脚本。
}
/**
 * Base64-encode a string as UTF-16LE, which is the encoding required by
 * PowerShell's -EncodedCommand parameter.
 */
function toUtf16LeBase64(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf16le').toString('base64')
  }
  // Fallback for non-Node environments
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes.push(code & 0xff, (code >> 8) & 0xff)
  }
  return btoa(bytes.map(b => String.fromCharCode(b)).join(''))
}
/** Transform the complete raw PS output into ParsedPowerShellCommand */
function transformRawOutput(raw: RawParsedOutput): ParsedPowerShellCommand {
  const result: ParsedPowerShellCommand = {
    valid: raw.valid,
    errors: ensureArray(raw.errors),
    statements: ensureArray(raw.statements).map(transformStatement),
    variables: ensureArray(raw.variables),
    hasStopParsing: raw.hasStopParsing,
    originalCommand: raw.originalCommand,
  }
  const tl = ensureArray(raw.typeLiterals)
  if (tl.length > 0) {
    result.typeLiterals = tl
  }
  if (raw.hasUsingStatements) {
    result.hasUsingStatements = true
  }
  if (raw.hasScriptRequirements) {
    result.hasScriptRequirements = true
  }
  return result
}
/**
 * Ensure a value is an array. PowerShell 5.1's ConvertTo-Json may unwrap
 * single-element arrays into plain objects.
 */
function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}
/** Transform a raw statement into ParsedStatement */
// exported for testing
export function transformStatement(raw: RawStatement): ParsedStatement {
  const statementType = mapStatementType(raw.type)
  const commands: ParsedCommandElement[] = []
  const redirections: ParsedRedirection[] = []

  if (raw.elements) {
    // PipelineAst: walk pipeline elements
    for (const elem of ensureArray(raw.elements)) {
      if (elem.type === 'CommandAst') {
        commands.push(transformCommandAst(elem))
        for (const redir of ensureArray(elem.redirections)) {
          redirections.push(transformRedirection(redir))
        }
      } else {
        commands.push(transformExpressionElement(elem))
        // SECURITY: CommandExpressionAst also carries .Redirections (inherited
        // from CommandBaseAst). `1 > /tmp/evil.txt` is a CommandExpressionAst
        // with a FileRedirectionAst. Must extract here or getFileRedirections()
        // misses it and compound commands like `Get-ChildItem; 1 > /tmp/x`
        // auto-allow at step 5 (only Get-ChildItem is checked).
        for (const redir of ensureArray(elem.redirections)) {
          redirections.push(transformRedirection(redir))
        }
      }
    }
    // SECURITY: The PS1 PipelineAst branch does a deep FindAll for
    // FileRedirectionAst to catch redirections hidden inside:
    //  - colon-bound ParenExpressionAst args: -Name:('payload' > file)
    //  - hashtable value statements: @{k='payload' > ~/.bashrc}
    // Both are invisible at the element level — the redirection's parent
    // is a child of CommandParameterAst / CommandExpressionAst, not a
    // separate pipeline element. Merge into statement-level redirections.
    //
    // The FindAll ALSO re-discovers direct-element redirections already
    // captured in the per-element loop above. Dedupe by (operator, target)
    // so tests and consumers see the real count.
    const seen = new Set(redirections.map(r => `${r.operator}\0${r.target}`))
    for (const redir of ensureArray(raw.redirections)) {
      const r = transformRedirection(redir)
      const key = `${r.operator}\0${r.target}`
      if (!seen.has(key)) {
        seen.add(key)
        redirections.push(r)
      }
    }
  } else {
    // Non-pipeline statement: add synthetic command entry with full text
    commands.push({
      name: raw.text,
      nameType: 'unknown',
      elementType: 'CommandExpressionAst',
      args: [],
      text: raw.text,
    })
    // SECURITY: The PS1 else-branch does a direct recursive FindAll on
    // FileRedirectionAst to catch expression redirections inside control flow
    // (if/for/foreach/while/switch/try/trap/&& and ||). The CommandAst FindAll
    // above CANNOT see these: in if ($x) { 1 > /tmp/evil }, the literal 1 with
    // its attached redirection is a CommandExpressionAst — a SIBLING of
    // CommandAst in the type hierarchy, not a subclass. So nestedCommands never
    // contains it, and without this hoist the redirection is invisible to
    // getFileRedirections → step 4.6 misses it → compound commands like
    // `Get-Process && 1 > /tmp/evil` auto-allow at step 5 (only Get-Process
    // is checked, allowlisted).
    //
    // Finding FileRedirectionAst DIRECTLY (rather than finding CommandExpressionAst
    // and extracting .Redirections) is both simpler and more robust: it catches
    // redirections on any node type, including ones we don't know about yet.
    //
    // Double-counts redirections already on nested CommandAst commands (those are
    // extracted at line ~395 into nestedCommands[i].redirections AND found again
    // here). Harmless: step 4.6 only checks fileRedirections.length > 0, not
    // the exact count. No code does arithmetic on redirection counts.
    //
    // PS1 SIZE NOTE: The full rationale lives here (TS), not in the PS1 script,
    // because PS1 comments bloat the -EncodedCommand payload and push the
    // Windows CreateProcess 32K limit. Keep PS1 comments terse; point them here.
    for (const redir of ensureArray(raw.redirections)) {
      redirections.push(transformRedirection(redir))
    }
  }

  let nestedCommands: ParsedCommandElement[] | undefined
  const rawNested = ensureArray(raw.nestedCommands)
  if (rawNested.length > 0) {
    nestedCommands = rawNested.map(transformCommandAst)
  }

  const result: ParsedStatement = {
    statementType,
    commands,
    redirections,
    text: raw.text,
    nestedCommands,
  }

  if (raw.securityPatterns) {
    result.securityPatterns = raw.securityPatterns
  }

  return result
}
/** Map raw .NET AST type name to our StatementType union */
// exported for testing
export function mapStatementType(rawType: string): StatementType {
  switch (rawType) {
    case 'PipelineAst':
      return 'PipelineAst'
    case 'PipelineChainAst':
      return 'PipelineChainAst'
    case 'AssignmentStatementAst':
      return 'AssignmentStatementAst'
    case 'IfStatementAst':
      return 'IfStatementAst'
    case 'ForStatementAst':
      return 'ForStatementAst'
    case 'ForEachStatementAst':
      return 'ForEachStatementAst'
    case 'WhileStatementAst':
      return 'WhileStatementAst'
    case 'DoWhileStatementAst':
      return 'DoWhileStatementAst'
    case 'DoUntilStatementAst':
      return 'DoUntilStatementAst'
    case 'SwitchStatementAst':
      return 'SwitchStatementAst'
    case 'TryStatementAst':
      return 'TryStatementAst'
    case 'TrapStatementAst':
      return 'TrapStatementAst'
    case 'FunctionDefinitionAst':
      return 'FunctionDefinitionAst'
    case 'DataStatementAst':
      return 'DataStatementAst'
    default:
      return 'UnknownStatementAst'
  }
}
/** Transform a raw CommandAst pipeline element into ParsedCommandElement */
// exported for testing
export function transformCommandAst(
  raw: RawPipelineElement,
): ParsedCommandElement {
  const cmdElements = ensureArray(raw.commandElements)
  let name = ''
  const args: string[] = []
  const elementTypes: CommandElementType[] = []
  const children: (CommandElementChild[] | undefined)[] = []
  let hasChildren = false

  // SECURITY: nameType MUST be computed from the raw name (before
  // stripModulePrefix). classifyCommandName('scripts\\Get-Process') returns
  // 'application' (contains \\) — the correct answer, since PowerShell resolves
  // this as a file path. After stripping it becomes 'Get-Process' which
  // classifies as 'cmdlet' — wrong, and allowlist checks would trust it.
  // Auto-allow paths gate on nameType !== 'application' to catch this.
  // name (stripped) is still used for deny-rule matching symmetry, which is
  // fail-safe: deny rules over-match (Module\\Remove-Item still hits a
  // Remove-Item deny), allow rules are separately gated by nameType.
  let nameType: 'cmdlet' | 'application' | 'unknown' = 'unknown'
  if (cmdElements.length > 0) {
    const first = cmdElements[0]!
    // SECURITY: only trust .value for string-literal element types with a
    // string-typed value. Numeric ConstantExpressionAst (e.g. `& 1`) emits an
    // integer .value that crashes stripModulePrefix() → parser falls through
    // to passthrough. For non-string-literal or non-string .value, use .text.
    const isFirstStringLiteral =
      first.type === 'StringConstantExpressionAst' ||
      first.type === 'ExpandableStringExpressionAst'
    const rawNameUnstripped =
      isFirstStringLiteral && typeof first.value === 'string'
        ? first.value
        : first.text
    // SECURITY: strip surrounding quotes from the command name. When .value is
    // unavailable (no StaticType on the raw node), .text preserves quotes —
    // `& 'Invoke-Expression' 'x'` yields "'Invoke-Expression'". Stripping here
    // at the source means every downstream reader of element.name (deny-rule
    // matching, GIT_SAFETY_WRITE_CMDLETS lookup, resolveToCanonical, etc.)
    // sees the bare cmdlet name. No-op when .value already stripped.
    const rawName = rawNameUnstripped.replace(/^['"]|['"]$/g, '')
    // SECURITY: PowerShell built-in cmdlet names are ASCII-only. Non-ASCII
    // characters in cmdlet position are inherently suspicious — .NET
    // OrdinalIgnoreCase folds U+017F (ſ) → S and U+0131 (ı) → I per
    // UnicodeData.txt SimpleUppercaseMapping, so PowerShell resolves
    // `ſtart-proceſſ` → Start-Process at runtime. JS .toLowerCase() does NOT
    // fold these (ſ is already lowercase), so every downstream name
    // comparison (NEVER_SUGGEST, deny-rule strEquals, resolveToCanonical,
    // security validators) misses. Force 'application' to gate auto-allow
    // (blocks at the nameType !== 'application' checks). Finding #31.
    // Verified on Windows (pwsh 7.x, 2026-03): ſtart-proceſſ does NOT resolve.
    // Retained as defense-in-depth against future .NET/PS behavior changes
    // or module-provided command resolution hooks.
    if (/[\u0080-\uFFFF]/.test(rawName)) {
      nameType = 'application'
    } else {
      nameType = classifyCommandName(rawName)
    }
    name = stripModulePrefix(rawName)
    elementTypes.push(mapElementType(first.type, first.expressionType))

    for (let i = 1; i < cmdElements.length; i++) {
      const ce = cmdElements[i]!
      // Use resolved .value for string constants (strips quotes, resolves
      // backtick escapes like `n -> newline) but keep raw .text for parameters
      // (where .value loses the dash prefix, e.g. '-Path' -> 'Path'),
      // variables, and other non-string types.
      const isStringLiteral =
        ce.type === 'StringConstantExpressionAst' ||
        ce.type === 'ExpandableStringExpressionAst'
      args.push(isStringLiteral && ce.value != null ? ce.value : ce.text)
      elementTypes.push(mapElementType(ce.type, ce.expressionType))
      // Map raw children (CommandParameterAst.Argument) through
      // mapElementType so consumers see 'Variable', 'StringConstant', etc.
      const rawChildren = ensureArray(ce.children)
      if (rawChildren.length > 0) {
        hasChildren = true
        children.push(
          rawChildren.map(c => ({
            type: mapElementType(c.type),
            text: c.text,
          })),
        )
      } else {
        children.push(undefined)
      }
    }
  }

  const result: ParsedCommandElement = {
    name,
    nameType,
    elementType: 'CommandAst',
    args,
    text: raw.text,
    elementTypes,
    ...(hasChildren ? { children } : {}),
  }

  // Preserve redirections from nested commands (e.g., in && / || chains)
  const rawRedirs = ensureArray(raw.redirections)
  if (rawRedirs.length > 0) {
    result.redirections = rawRedirs.map(transformRedirection)
  }

  return result
}
/** Map raw redirection to ParsedRedirection */
// exported for testing
export function transformRedirection(raw: RawRedirection): ParsedRedirection {
  if (raw.type === 'MergingRedirectionAst') {
    return { operator: '2>&1', target: '', isMerging: true }
  }

  const append = raw.append ?? false
  const fromStream = raw.fromStream ?? 'Output'

  let operator: ParsedRedirection['operator']
  if (append) {
    switch (fromStream) {
      case 'Error':
        operator = '2>>'
        break
      case 'All':
        operator = '*>>'
        break
      default:
        operator = '>>'
        break
    }
  } else {
    switch (fromStream) {
      case 'Error':
        operator = '2>'
        break
      case 'All':
        operator = '*>'
        break
      default:
        operator = '>'
        break
    }
  }

  return { operator, target: raw.locationText ?? '', isMerging: false }
}
/** Transform a non-CommandAst pipeline element into ParsedCommandElement */
// exported for testing
export function transformExpressionElement(
  raw: RawPipelineElement,
): ParsedCommandElement {
  const elementType: PipelineElementType =
    raw.type === 'ParenExpressionAst'
      ? 'ParenExpressionAst'
      : 'CommandExpressionAst'
  const elementTypes: CommandElementType[] = [
    mapElementType(raw.type, raw.expressionType),
  ]

  return {
    name: raw.text,
    nameType: 'unknown',
    elementType,
    args: [],
    text: raw.text,
    elementTypes,
  }
}

/** Map raw .NET AST type name to our CommandElementType union */
// exported for testing
export function mapElementType(
  rawType: string,
  expressionType?: string,
): CommandElementType {
  switch (rawType) {
    case 'ScriptBlockExpressionAst':
      return 'ScriptBlock'
    case 'SubExpressionAst':
    case 'ArrayExpressionAst':
      // SECURITY: ArrayExpressionAst (@()) is a sibling of SubExpressionAst,
      // not a subclass. Both evaluate arbitrary pipelines with side effects:
      // Get-ChildItem @(Remove-Item ./data) runs Remove-Item inside @().
      // Map both to SubExpression so hasSubExpressions fires and isReadOnlyCommand
      // rejects (it doesn't check nestedCommands, only pipeline.commands[]).
      return 'SubExpression'
    case 'ExpandableStringExpressionAst':
      return 'ExpandableString'
    case 'InvokeMemberExpressionAst':
    case 'MemberExpressionAst':
      return 'MemberInvocation'
    case 'VariableExpressionAst':
      return 'Variable'
    case 'StringConstantExpressionAst':
    case 'ConstantExpressionAst':
      // ConstantExpressionAst covers numeric literals (5, 3.14). For
      // permission purposes a numeric literal is as safe as a string
      // literal — it's an inert value, not code. Without this mapping,
      // `-Seconds:5` produced children[0].type='Other' and consumers
      // checking `children.some(c => c.type !== 'StringConstant')` would
      // false-positive ask on harmless numeric args.
      return 'StringConstant'
    case 'CommandParameterAst':
      return 'Parameter'
    case 'ParenExpressionAst':
      return 'SubExpression'
    case 'CommandExpressionAst':
      // Delegate to the wrapped expression type so we catch SubExpressionAst,
      // ExpandableStringExpressionAst, ScriptBlockExpressionAst, etc.
      // without maintaining a manual list. Falls through to 'Other' if the
      // inner type is unrecognised.
      if (expressionType) {
        return mapElementType(expressionType)
      }
      return 'Other'
    default:
      return 'Other'
  }
}
/** Classify command name as cmdlet, application, or unknown */
// exported for testing
export function classifyCommandName(
  name: string,
): 'cmdlet' | 'application' | 'unknown' {
  if (/^[A-Za-z]+-[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return 'cmdlet'
  }
  if (/[.\\/]/.test(name)) {
    return 'application'
  }
  return 'unknown'
}
/** Strip module prefix from command name (e.g. "Microsoft.PowerShell.Utility\\Invoke-Expression" -> "Invoke-Expression") */
// exported for testing
export function stripModulePrefix(name: string): string {
  const idx = name.lastIndexOf('\\')
  if (idx < 0) return name
  // Don't strip file paths: drive letters (C:\...), UNC paths (\\server\...), or relative paths (.\, ..\)
  if (
    /^[A-Za-z]:/.test(name) ||
    name.startsWith('\\\\') ||
    name.startsWith('.\\') ||
    name.startsWith('..\\')
  )
    return name
  return name.substring(idx + 1)
}
