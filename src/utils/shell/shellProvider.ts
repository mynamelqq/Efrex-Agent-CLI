export const SHELL_TYPES = ['bash', 'powershell'] as const
export type ShellType = (typeof SHELL_TYPES)[number]//数组的联合类型
export const DEFAULT_HOOK_SHELL: ShellType = 'bash'//默认bash

export type ShellProvider = {
  type: ShellType
  shellPath: string
  detached: boolean

/** * 构建完整的命令字符串，其中包括所有与 shell 相关的设置。 * 对于 bash 脚本：执行脚本加载操作、设置会话环境、禁用扩展通配符、添加脚本执行包装、跟踪当前目录。*/
  buildExecCommand(
    command: string,
    opts: {
      id: number | string
      // sandboxTmpDir?: string
      // useSandbox: boolean
    },
  ): Promise<{ commandString: string; cwdFilePath: string }>

  /**
   * Shell args for spawn (e.g., ['-c', '-l', cmd] for bash).
   */
  getSpawnArgs(commandString: string): string[]

/** * 本 shell 类型所特有的环境变量。 * 可执行异步初始化操作（例如，为 bash 进行 tmux 会话套接字的设置）。 */
  getEnvironmentOverrides(command: string): Promise<Record<string, string>>
}
