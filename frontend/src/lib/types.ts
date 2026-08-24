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
