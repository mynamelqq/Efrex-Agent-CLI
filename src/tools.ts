import type { z } from 'zod/v4'
// Type for any schema that outputs an object with string keys
import { GlobTool } from './tools/GlobTool/GlobTool'
import { WebSearchTool } from './tools/WebSearchTool/WebSearchTool'
import { Tools} from './Tool'
import { FileReadTool } from './tools/FileReadTool/FileReadTool'
import { GrepTool } from './tools/GrepTool/GrepTool'
export function getAllBaseTools():Tools{
    return [GlobTool,GrepTool,FileReadTool]

}
