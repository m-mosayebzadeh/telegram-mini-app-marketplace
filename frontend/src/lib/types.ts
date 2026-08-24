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
  kind: 'chat_request' | 'photo_purchase'
  buyer_id: number
  provider_id: number
  request_id: number | null
  photo_id: number | null
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
}
