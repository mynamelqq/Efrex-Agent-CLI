import {cwd} from 'node:process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { existsSync,mkdirSync} from 'node:fs';
import {createReadStream}from "node:fs";
import  readline from 'readline';
import pkg from '../package.json';
import { appendFile } from 'fs/promises';
export function trustFoler(){
    ensureDirSync();
    const dirPath:string=join(homedir(),".efrex","projects",pathToDisplayNameSimple(cwd()));
    if(!existsSync(dirPath)){
        mkdirSync(dirPath, { recursive: true });
    }
}
export const CLI_APP_NAME = pkg.name;
export const CLI_APP_VERSION = pkg.version;
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


