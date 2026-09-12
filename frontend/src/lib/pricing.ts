import { apiFetch } from './api'
import type { PricingConfig } from './types'

// Rates are editable. Each screen requests a fresh snapshot.
export function getPricingConfig(): Promise<PricingConfig> {
  return apiFetch<PricingConfig>('/pricing')
}
