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
  // Whether ANY of your own offers has a request you haven't seen yet
  // (see backend/app/offer/router.py's list_offers and
  // backend/app/request/router.py's list_requests_for_offer, which own
  // the actual per-offer counting/clearing) — just a plain "something
  // needs attention" dot on the Activity tab's bottom-nav icon (see
  // App.tsx), not an exact count.
  has_unseen_requests: boolean
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
  // Only set when listing your OWN offers (see backend/app/offer/schemas.py's
  // OfferOut) — how many requests it's received in total, shown as a
  // badge on the Activity tab's Offers segment.
  request_count: number | null
  // Only populated by GET /offers/{id} for a non-owner viewer — see
  // backend/app/offer/schemas.py's OfferOut docstring.
  my_request_status: 'pending' | 'accepted' | null
}

/** One row in the Activity tab's unified Requests feed — see
 * backend/app/request/schemas.py's RequestActivityOut. */
export interface RequestActivity {
  id: number
  offer_id: number
  offer_title: string
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
  reason: string | null
  created_at: string
  responded_at: string | null
  direction: 'sent' | 'received'
  counterpart_user_id: number
  counterpart_display_name: string
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

/** The other participant in a session, from the current viewer's point
 * of view — see backend/app/chat_session/schemas.py's
 * ChatSessionParticipantOut. Never carries telegram_id. */
export interface ChatSessionParticipant {
  user_id: number
  display_name: string
  username: string | null
  avatar_url: string | null
}

export interface ChatSession {
  id: number
  request_id: number
  transaction_id: number
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  closed_by_user_id: number | null
  // --- enrichment added for the chat session UI (see
  // TECHNICAL_REQUIREMENTS.md section 12) — denormalized onto this
  // response so the chat screen never needs a second round trip just to
  // render its own header/session-details panel.
  my_role: 'buyer' | 'provider'
  other_participant: ChatSessionParticipant
  offer_title: string
  price_stars: number
  // Informational only — never an enforced timer (see section 3).
  display_duration_minutes: number
  disputed: boolean
  transaction_status: 'pending' | 'succeeded' | 'failed' | 'refunded'
  // Whether the CURRENT viewer archived this session — per-viewer, see
  // backend/app/models/chat_session.py's archived_by_buyer/archived_by_provider.
  archived: boolean
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
  // "پروفایل معتبر" — see backend/app/models/profile.py's Profile.is_trusted
  // docstring. Never settable by the profile's own owner; render nothing
  // at all when this is false, never an empty badge placeholder.
  is_trusted: boolean
  // Gregorian on the wire — see Profile.birthday_month's docstring.
  // month/day are both-or-neither; year is independently optional even
  // when month/day are set. Convert with lib/jalali.ts before
  // displaying (the app's default locale uses the Jalali calendar).
  birthday_month: number | null
  birthday_day: number | null
  birthday_year: number | null
  followers_count: number
  following_count: number
  follow_status: 'not_following' | 'pending' | 'accepted'
}

/** One row of GET /profiles/{user_id}/photos — see
 * backend/app/models/profile_photo.py. A user can have any number of
 * these; `avatar_url` above is always just the newest one. */
export interface ProfilePhoto {
  id: number
  url: string
  created_at: string
}

/** One photo or short video, owned directly by a user — see
 * backend/app/content/schemas.py's ContentOut. Never carries a raw file
 * path; the actual bytes are fetched separately from
 * GET /content/{id}/file, which is access-checked server-side. */
export interface Content {
  id: number
  user_id: number
  content_type: 'photo' | 'short_video'
  duration_seconds: number | null
  is_paid: boolean
  price_stars: number | null
  has_spoiler: boolean
  audience_type: 'public' | 'followers' | 'user' | 'group'
  is_pinned: boolean
  created_at: string
  // Whether *this* viewer can currently see the real file — decides
  // whether a grid tile shows the spoiler overlay or the image itself.
  can_see_original: boolean
  like_count: number
  liked_by_me: boolean
}

/** PUT /profile/me's response — see backend/app/profile/schemas.py's
 * ProfileOut. Distinct from PublicProfile: this is only ever your own,
 * so it has no follower counts or follow_status. */
export interface MyProfile {
  id: number
  avatar_url: string | null
  bio: string | null
  location: string | null
  interests: string[]
  is_trusted: boolean
  birthday_month: number | null
  birthday_day: number | null
  birthday_year: number | null
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

/** GET /topup/card-info — see backend/app/topup/schemas.py's
 * TopUpCardInfoOut. Empty strings mean the owner hasn't set
 * TOPUP_CARD_NUMBER/TOPUP_CARD_HOLDER_NAME in their .env yet. */
export interface TopUpCardInfo {
  card_number: string
  card_holder_name: string
}

/** One card-to-card top-up request, from the requester's own point of
 * view — see backend/app/topup/schemas.py's TopUpRequestOut. */
export interface TopUpRequest {
  id: number
  user_id: number
  requested_stars: number
  star_rate_at_request: number
  requested_toman_amount: number
  status: 'pending' | 'approved' | 'rejected'
  final_toman_amount: number | null
  transaction_reference: string | null
  rejection_reason: string | null
  reviewed_by_user_id: number | null
  reviewed_at: string | null
  created_at: string
}

/** The admin-side view of a top-up request — see
 * backend/app/admin/schemas.py's AdminTopUpRequestOut. Same fields as
 * TopUpRequest, plus who's asking. */
export interface AdminTopUpRequest extends Omit<TopUpRequest, 'user_id'> {
  requester: { user_id: number; display_name: string; username: string | null }
}

/** GET /admin/me — never 403s, see backend/app/admin/router.py's
 * docstring. is_owner implies every scope; scopes is only meaningful
 * when is_owner is false. */
export interface MyAdminAccess {
  is_owner: boolean
  scopes: string[]
}

/** One row of GET /admin/grants — see backend/app/admin/schemas.py's
 * AdminGrantOut. */
export interface AdminGrant {
  id: number
  user_id: number
  display_name: string
  username: string | null
  scopes: string[]
  granted_by_user_id: number
  created_at: string
}
