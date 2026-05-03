const STATE = {
  cwd: '',
  originalCwd: '',
  projectRoot: '',
  lastAPIRequest: null as Record<string, unknown> | null,
  lastAPIRequestMessages: null as unknown[] | null,
}

export function getCwdState():string {
  return STATE.cwd
}

export function setCwdState(cwd:string):void{
  STATE.cwd = cwd.normalize('NFC')
}

export function getOriginalCwd() {
  return STATE.originalCwd
}

export function setOriginalCwd(cwd:string):void {
  STATE.originalCwd = cwd.normalize('NFC')
}

export function getProjectRoot() :string{
  return STATE.projectRoot
}

export function setProjectRoot(cwd:string) :void{
  STATE.projectRoot = cwd.normalize('NFC')
}

export function getLastAPIRequest(): Record<string, unknown> | null {
  return STATE.lastAPIRequest
}

export function setLastAPIRequest(params: Record<string, unknown> | null): void {
  STATE.lastAPIRequest = params
}

export function getLastAPIRequestMessages(): unknown[] | null {
  return STATE.lastAPIRequestMessages
}

export function setLastAPIRequestMessages(messages: unknown[] | null): void {
  STATE.lastAPIRequestMessages = messages
}
