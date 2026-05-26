import type { z } from 'zod/v4'
// Type for any schema that outputs an object with string keys
import { GlobTool } from './tools/GlobTool/GlobTool'
import { WebSearchTool } from './tools/WebSearchTool/WebSearchTool'
import { Tools} from './Tool'
import { FileReadTool } from './tools/FileReadTool/FileReadTool'
import { GrepTool } from './tools/GrepTool/GrepTool'
import { WebFetchTool } from './tools/WebFetchTool/WebFetchTool'
import { BashTool } from './tools/BashTool/BashTools'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool'
import { FileEditTool } from './tools/FileEditTool/FileEditTool'
import { PowerShellTool } from './tools/PowerShellTool/PowerShellTool'
import { findGitBashPath } from './utils/windowsPaths'
export function getAllBaseTools():Tools{
    return [
        PowerShellTool,FileWriteTool,FileReadTool
        // GlobTool,GrepTool,FileEditTool,FileReadTool,FileWriteTool
    ]//GlobTool,GrepTool,FileReadTool,FileEditTool,BashTool,WebFetchTool,WebSearchTool,FileWriteTool
}

export type BashProgress = any