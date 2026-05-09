import { toJSONSchema } from 'zod/v4'
import { SettingsSchema } from './types.js'

export function generateSettingsJSONSchema(): string {
  const jsonSchema = toJSONSchema(SettingsSchema(), { unrepresentable: 'any' })
  return JSON.stringify(jsonSchema, null, 2)
}
