import { getSettingsEnvValue } from './anthropicConfig.js'

const DEFAULT_FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v2/search'
const DEFAULT_FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape'

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') {
      return value
    }
  }
  return undefined
}

export function getFirecrawlApiKey(): string | undefined {
  return firstDefined(
    process.env.FIRECRAWL_API_KEY,
    getSettingsEnvValue('FIRECRAWL_API_KEY'),
  )
}

export function getFirecrawlSearchUrl(): string {
  return (
    firstDefined(
      process.env.FIRECRAWL_SEARCH_URL,
      getSettingsEnvValue('FIRECRAWL_SEARCH_URL'),
    ) ?? DEFAULT_FIRECRAWL_SEARCH_URL
  )
}

export function getFirecrawlScrapeUrl(): string {
  return (
    firstDefined(
      process.env.FIRECRAWL_SCRAPE_URL,
      getSettingsEnvValue('FIRECRAWL_SCRAPE_URL'),
    ) ?? DEFAULT_FIRECRAWL_SCRAPE_URL
  )
}
