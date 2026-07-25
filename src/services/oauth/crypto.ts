import { createHash, randomBytes } from 'crypto'

function base64URLEncode(buffer: Buffer): string {//标准 RFC4648 base64url 转换
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export function generateCodeVerifier(): string {//生成原始校验串 code_verifier 本地保存，授权码换 token 时传给服务端做校验
  return base64URLEncode(randomBytes(32))
}

export function generateCodeChallenge(verifier: string): string {//根据 verifier 算出挑战码 code_challenge 传给服务端
  const hash = createHash('sha256')
  hash.update(verifier)
  return base64URLEncode(hash.digest())
}

export function generateState(): string {
  return base64URLEncode(randomBytes(32))
}
