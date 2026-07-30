// Auto-generated stub — replace with real implementation
export type BillingType = any
export type ReferralEligibilityResponse = any
export type OAuthTokens = any
export type SubscriptionType = any
export type ReferralRedemptionsResponse = any
export type ReferrerRewardInfo = any
export interface OAuthProfileResponse {
    id: string | number
    email: string
    plan?: {
        code?: string
        name?: string
        monthly_price_cents?: number
        monthly_standard_tokens?: number
        rpm_limit?: number
        period_start?: string
        period_end?: string
    }
    used_standard_tokens?: number
    remaining_standard_tokens?: number
    available_models?: string[]
}
export type OAuthTokenExchangeResponse = any
export type RateLimitTier = any
export type UserRolesResponse = any
export type ReferralCampaign = any
