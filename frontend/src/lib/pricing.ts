import { apiFetch } from './api'
import type { PricingConfig } from './types'

// Resolved once and reused — the rate/commission constants don't change
// mid-session (see backend/app/main.py's read_pricing_config: they're
// phase-1 constants, not a live-editable database value yet).
let cached: PricingConfig | null = null

export async function getPricingConfig(): Promise<PricingConfig> {
  if (cached) return cached
  cached = await apiFetch<PricingConfig>('/pricing')
  return cached
}
