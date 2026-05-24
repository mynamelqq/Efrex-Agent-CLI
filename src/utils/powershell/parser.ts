import { execa } from 'execa'
import { logForDebugging } from '../debug.js'
import { memoizeWithLRU } from '../memoize.js'
import { getCachedPowerShellPath } from '../shell/powershellDetection.js'
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
