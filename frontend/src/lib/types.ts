/**
 * Response shapes for the backend endpoints this app calls, kept in
 * sync by hand with their Pydantic schemas (backend/app/**\/schemas.py)
 * and the plain dict GET /me returns (backend/app/main.py). There's no
 * shared codegen between the two sides yet — if a backend response
 * shape changes, these need to be updated to match.
 */

export interface Me {
  id: number
  telegram_id: number
  display_name: string
  username: string | null
  status: 'active' | 'blocked'
  joined_at: string
  // How many people currently have an unanswered follow request in to
  // you — shown as a badge on the Profile tab (see GET
  // /follow/incoming-requests for the full inbox this links to).
  pending_follow_requests_count: number
}

export interface Balance {
  balance_toman: number
  balance_stars_equivalent: number
  pending_toman: number
}

export interface Offer {
  id: number
  provider_id: number
  service_type: string
  price_stars: number
  display_duration_minutes: number
  title: string
  description: string
  status: 'active' | 'inactive'
  created_at: string
}

export interface Request {
  id: number
  buyer_id: number
  offer_id: number
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
  reason: string | null
  created_at: string
  responded_at: string | null
}

export interface ChatSession {
  id: number
  request_id: number
  transaction_id: number
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  closed_by_user_id: number | null
}

export interface Transaction {
  id: number
  kind: 'chat_request' | 'content_purchase'
  buyer_id: number
  provider_id: number
  request_id: number | null
  content_id: number | null
  gross_price_stars: number
  commission_rate_percent: number
  commission_stars: number
  net_provider_stars: number
  star_to_toman_rate: number
  gross_price_toman: number
  commission_toman: number
  net_provider_toman: number
  status: 'pending' | 'succeeded' | 'failed' | 'refunded'
  created_at: string
}

export interface PublicProfile {
  user_id: number
  display_name: string
  username: string | null
  avatar_url: string | null
  bio: string | null
  location: string | null
  interests: string[]
  followers_count: number
  following_count: number
  follow_status: 'not_following' | 'pending' | 'accepted'
}

/** GET /pricing — the current Star-to-Toman rate and commission
 * percentages, used to show a price breakdown without a round trip per
 * keystroke (see lib/priceBreakdown.ts). */
export interface PricingConfig {
  star_to_toman_rate: number
  chat_commission_percent: number
  content_commission_percent: number
}

/** One row in a followers/following list — GET /follow/{id}/followers or
 * /following. Lighter than PublicProfile: no bio, no counts. */
export interface FollowListItem {
  user_id: number
  display_name: string
  username: string | null
  avatar_url: string | null
}

/** One row of GET /follow/incoming-requests — every follow request ever
 * sent to the logged-in user, pending or already responded to (see
 * backend/app/follow/schemas.py's IncomingFollowRequestOut). */
export interface IncomingFollowRequest {
  follow_id: number
  requester: FollowListItem
  status: 'pending' | 'accepted' | 'rejected'
  requested_at: string
  responded_at: string | null
  i_follow_them_back: boolean
}

/** GET /profiles/{id}/provider-summary — see backend/app/profile/schemas.py's
 * ProviderSummaryOut for which fields are real today vs. still blocked
 * on the (unbuilt) Rating entity. */
export interface ProviderSummary {
  status: 'established' | 'new'
  joined_at: string
  completed_services_count: number
  response_rate: number | null
  rejection_rate: number | null
  disputed_transactions_count: number
}

/** GET /profiles/{id}/buyer-summary — see backend/app/profile/schemas.py's
 * BuyerSummaryOut for which fields are real today vs. still blocked
 * (buyer-cancel, disputes, ratings — none of those exist yet). */
export interface BuyerSummary {
  status: 'established' | 'new'
  joined_at: string
  completed_transactions_count: number
  total_stars_spent: number
}
