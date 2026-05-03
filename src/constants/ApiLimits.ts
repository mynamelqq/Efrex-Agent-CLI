
/**
 * Client-side maximum dimensions for image resizing.
 *
 * Note: The API internally resizes images larger than 1568px (source:
 * encoding/full_encoding.py), but this is handled server-side and doesn't
 * cause errors. These client-side limits (2000px) are slightly larger to
 * preserve quality when beneficial.
 *
 * The API_IMAGE_MAX_BASE64_SIZE (5MB) is the actual hard limit that causes
 * API errors if exceeded.
 */
export const IMAGE_MAX_WIDTH = 2000
export const IMAGE_MAX_HEIGHT = 2000

/**
 * Maximum raw PDF file size that fits within the API request limit after encoding.
 * The API has a 32MB total request size limit. Base64 encoding increases size by
 * ~33% (4/3), so 20MB raw → ~27MB base64, leaving room for conversation context.
 */
export const PDF_TARGET_RAW_SIZE = 20 * 1024 * 1024 // 20 MB
/**
 * Maximum number of pages in a PDF accepted by the API.
 */
export const API_PDF_MAX_PAGES = 100

/**
 * Max pages the Read tool will extract in a single call with the pages parameter.
 */
export const PDF_MAX_PAGES_PER_READ = 20