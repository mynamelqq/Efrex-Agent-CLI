export const WEB_SCRAPE_TOOL_NAME = 'WebScrape'

export const DESCRIPTION = `
- Scrapes a URL through Firecrawl's /v2/scrape endpoint
- Takes a URL and optional scrape settings as input
- Can return markdown, html, links, images, branding, screenshots, or an answer to a natural-language prompt
- Returns normalized scrape output plus Firecrawl metadata
- Use this tool when you need Firecrawl-backed page scraping instead of a direct fetch

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - The prompt is optional; when present, it is sent as Firecrawl's query format and the answer is returned in the result
  - If formats are omitted, markdown is requested by default
  - This tool is read-only and does not modify any files
  - Firecrawl applies caching, proxying, and content cleaning server-side
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api)
`
