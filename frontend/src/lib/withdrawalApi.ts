import { apiFetch, ApiError, formatApiError } from './api'
import type { TFunction } from 'i18next'

export interface BankAccount {
  id: number
  holder_name: string
  card_number: string
  iban: string
}
export interface WithdrawalQuote {
  stars: number
  star_rate: number
  fee_percent: number
  minimum_toman: number
  gross_toman: number
  fee_toman: number
  net_toman: number
  quote_token: string
  /** How much this user may cash out right now — earnings only, never
   * topped-up money. Advisory: the server re-checks it when the withdrawal
   * is actually created. */
  withdrawable_toman: number
}
export type WithdrawalStatus =
  | 'pending'
  | 'processing'
  | 'bank_pending'
  | 'paid'
  | 'rejected'
  | 'failed'
  | 'cancelled'
export interface Withdrawal
  extends Omit<WithdrawalQuote, 'quote_token'>,
    Omit<BankAccount, 'id'> {
  id: number
  user_id: number
  status: WithdrawalStatus
  assigned_to_user_id: number | null
  reference: string | null
  reason: string | null
  created_at: string
  updated_at: string
}
export const bankAccounts = () =>
  apiFetch<BankAccount[]>('/wallet/bank-accounts')
export const withdrawals = () => apiFetch<Withdrawal[]>('/wallet/withdrawals')
export const quoteWithdrawal = (stars: number) =>
  apiFetch<WithdrawalQuote>('/wallet/withdrawals/quote', {
    method: 'POST',
    body: JSON.stringify({ stars }),
  })
export function financeError(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    const reason = (error.body as { detail?: { reason?: string } } | null)
      ?.detail?.reason
    if (reason && t(`finance.errors.${reason}`) !== `finance.errors.${reason}`)
      return t(`finance.errors.${reason}`)
    if (error.status === 422) return t('finance.invalidFields')
  }
  return formatApiError(error)
}
export function digits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
}
