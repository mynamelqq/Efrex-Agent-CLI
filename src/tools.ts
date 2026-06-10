// Type for any schema that outputs an object with string keys
import { GlobTool } from './tools/GlobTool/GlobTool'
import { Tools } from './Tool'
import { FileReadTool } from './tools/FileReadTool/FileReadTool'
import { GrepTool } from './tools/GrepTool/GrepTool'
import { BashTool } from './tools/BashTool/BashTool'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool'
import { FileEditTool } from './tools/FileEditTool/FileEditTool'
export function getAllBaseTools():Tools{
    return [
        BashTool,
        //PowerShellTool
        GlobTool,GrepTool,FileEditTool,FileReadTool,FileWriteTool
    ]//GlobTool,GrepTool,FileReadTool,FileEditTool,BashTool,,WebSearchTool,FileWriteTool
}
export type ShellProgress = any
export type BashProgress = any
