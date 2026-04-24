import {cwd} from 'node:process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { existsSync,mkdirSync} from 'node:fs';
import {createReadStream}from "node:fs";
import  readline from 'readline';
import { appendFile } from 'fs/promises';
export function trustFoler(){
    ensureDirSync();
    const dirPath:string=join(homedir(),".efrex","projects",pathToDisplayNameSimple(cwd()));
    if(!existsSync(dirPath)){
        mkdirSync(dirPath, { recursive: true });
    }
}
function ensureDirSync(): void {
    const projectFolder=join(homedir(),".efrex","projects","")
    if(!existsSync(projectFolder)){
        mkdirSync(projectFolder, { recursive: true });
    }
}
export function isWorkSpaceTruested()
{
    ensureDirSync();
    const dirPath:string=join(homedir(),".efrex","projects",pathToDisplayNameSimple(cwd()));
    if (!existsSync(dirPath)) {
        return false;//mkdirSync(dirPath, { recursive: true });
    } else {
        return true;
    }
}
function pathToDisplayNameSimple(filePath: string): string {
    return filePath.replace(/:/g, '').replace(/\\/g, '--');
}
export interface PastedContent {
  id: number;
  type: 'text';  // 如果有其他类型可扩展，例如 'image', 'file' 等
  content: string;
}
export interface SessionHistory {
  display: string;          // 展示文本，如 "[Pasted text #1 +72 lines]"
  pastedContents: {
    [key: string]: PastedContent;  // key 为数字字符串，如 "1"
  };
  timestamp: number;        // Unix 毫秒时间戳
  project: string;          // 项目路径
  sessionId: string;        // UUID 格式的会话ID
}

export async function readHistoryJSONL(): Promise<SessionHistory[]> {
  const historyJsonPath = join(homedir(), ".efrex", "history.jsonl");
  const sessions: SessionHistory[] = [];//空数组
  try {
    const fileStream = createReadStream(historyJsonPath);
    const rl = readline.createInterface({ input: fileStream });
    for await (const line of rl) {
      if (line.trim()) { // 跳过空行
        try {
          const obj = JSON.parse(line);
          
          if (obj && typeof obj === 'object' && obj.sessionId && obj.project) {
            sessions.push(obj as SessionHistory);
          } else {
            console.warn('跳过无效的会话数据:', obj);
          }
        } catch (err) {
          console.error('解析 JSON 失败:', line, err);
        }
      }
    }
    appendFileSync("./tmp/debug.log",`[Trace] 消息${sessions.length}} \n`)
    return sessions;
    
  } catch (err) {
    
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`文件不存在: ${historyJsonPath}`);
      return [];
    }
    throw err;
  }
}

export async function saveSessionHistory(newHistory: SessionHistory) {
  const historyJsonPath = join(homedir(), ".efrex", "history.jsonl");
  const line = JSON.stringify(newHistory) + '\n';
  try {
    await appendFile(historyJsonPath, line);
  } catch (err) {
    console.error('写入失败:', err);
  }
}
export async function updateModel() {
  
}