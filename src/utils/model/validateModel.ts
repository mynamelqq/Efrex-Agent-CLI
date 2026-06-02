// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import Anthropic from '@anthropic-ai/sdk'
import { sideQuery } from '../sideQuery.js'
import {
  NotFoundError,
  APIError,
  APIConnectionError,
  AuthenticationError,
} from '@anthropic-ai/sdk'
import { getAnthropicApiKey, getAnthropicBaseURL } from 'src/utils/anthropicConfig.js'
import { getInitialSettings } from 'src/utils/settings/settings.js'

// Cache valid models to avoid repeated API calls
const validModelCache = new Map<string, boolean>()

/**
 * Validates a model by attempting an actual API call.
 */
export async function validateModel(
  model: string,
): Promise<{ valid: boolean; error?: string }> {
  const normalizedModel = model.trim()

  // Empty model is invalid
  if (!normalizedModel) {
    return { valid: false, error: 'Model name cannot be empty' }
  }


  // Check if it matches ANTHROPIC_CUSTOM_MODEL_OPTION (pre-validated by the user)
  if (normalizedModel === process.env.ANTHROPIC_CUSTOM_MODEL_OPTION) {
    return { valid: true }
  }

  // Check cache first
  if (validModelCache.has(normalizedModel)) {
    return { valid: true }
  }

  // Try to make an actual API call with minimal parameters
  try {
    if (isAnthropicProvider()) {
      await anthropicValidationQuery(normalizedModel)
    } else {
      await sideQuery({
        model: normalizedModel,
        max_tokens: 1,
        maxRetries: 0,
        querySource: 'model_validation',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Hi',
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
        ],
      })
    }

    // If we got here, the model is valid
    validModelCache.set(normalizedModel, true)
    return { valid: true }
  } catch (error) {
    return handleValidationError(error, normalizedModel)
  }
}

function isAnthropicProvider(): boolean {
  const settingsEnv = getInitialSettings().env as Record<string, string | undefined> | undefined
  const provider = process.env.Provider ?? settingsEnv?.Provider
  if (provider?.toUpperCase() === 'ANTHROPIC') return true

  const baseURL = getAnthropicBaseURL()
  if (baseURL?.includes('anthropic')) return true

  return false
}

async function anthropicValidationQuery(model: string): Promise<void> {
  const apiKey = getAnthropicApiKey()
  if (!apiKey?.trim()) {
    throw new Error(
      'Missing Anthropic API key. Configure AUTH_TOKEN or the corresponding settings env.',
    )
  }

  const baseURL = getAnthropicBaseURL()
  const client = new Anthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    maxRetries: 0,
  })

  await client.messages.create({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'Hi' }],
  })
}

function handleValidationError(
  error: unknown,
  modelName: string,
): { valid: boolean; error: string } {
  // NotFoundError (404) means the model doesn't exist
  if (error instanceof NotFoundError) {
    const suggestion = ''
    return {
      valid: false,
      error: `Model '${modelName}' not found${suggestion}`,
    }
  }

  // For other API errors, provide context-specific messages
  if (error instanceof APIError) {
    if (error instanceof AuthenticationError) {
      return {
        valid: false,
        error: 'Authentication failed. Please check your API credentials.',
      }
    }

    if (error instanceof APIConnectionError) {
      return {
        valid: false,
        error: 'Network error. Please check your internet connection.',
      }
    }

    // Check error body for model-specific errors
    const errorBody = error.error as unknown
    if (
      errorBody &&
      typeof errorBody === 'object' &&
      'type' in errorBody &&
      errorBody.type === 'not_found_error' &&
      'message' in errorBody &&
      typeof errorBody.message === 'string' &&
      errorBody.message.includes('model:')
    ) {
      return { valid: false, error: `Model '${modelName}' not found` }
    }

    // Generic API error
    return { valid: false, error: `API error: ${error.message}` }
  }

  // For unknown errors, be safe and reject
  const errorMessage = error instanceof Error ? error.message : String(error)
  return {
    valid: false,
    error: `Unable to validate model: ${errorMessage}`,
  }
}


