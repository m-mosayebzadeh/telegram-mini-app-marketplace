/**
 * Iranian card numbers and IBANs: how to format them, and how to read
 * which bank a card belongs to.
 *
 * Both of these are printed in groups on the physical card, and that is
 * how people check them — four digits at a time, against the plastic in
 * their hand. A 16-digit run with no grouping cannot be verified by
 * eye at all, which is the point of the formatting here.
 */

/** Persian and Arabic-Indic digits typed on a Persian keyboard, folded
 *  to ASCII so the same number is stored however it was entered. */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632))
}

/** Everything except 0-9 removed, Persian digits folded first. */
export function onlyDigits(value: string): string {
  return toLatinDigits(value).replace(/\D/g, '')
}

export const CARD_LENGTH = 16
/** An Iranian IBAN is IR plus 24 digits. Only the digits are typed; the
 *  IR is a fixed prefix the field supplies. */
export const IBAN_DIGIT_LENGTH = 24

/** "1234123412341234" -> "1234 1234 1234 1234". */
export function formatCard(digitsValue: string): string {
  return digitsValue.replace(/(\d{4})(?=\d)/g, '$1 ')
}

/** The 24 digits of an IBAN in groups of four. */
export function formatIbanDigits(digitsValue: string): string {
  return digitsValue.replace(/(\d{4})(?=\d)/g, '$1 ')
}

/**
 * Which bank issued a card, from its first six digits (the BIN).
 *
 * Worth the table: it turns a wall of digits into something a person can
 * actually check. Seeing "بانک ملی" appear as you type the first six
 * digits confirms you are entering the card you meant to, before you
 * save it and before money is ever sent to it — which is a far more
 * useful thing for this screen to do than look like a bank card.
 *
 * An unknown BIN returns null and the UI says nothing. Guessing a bank
 * would be worse than staying quiet: a wrong name here would give
 * someone confidence in a number that is wrong.
 */
const BINS: Record<string, string> = {
  '636214': 'آینده',
  '627381': 'انصار',
  '505785': 'ایران زمین',
  '622106': 'پارسیان',
  '627884': 'پارسیان',
  '639194': 'پارسیان',
  '502229': 'پاسارگاد',
  '639347': 'پاسارگاد',
  '627760': 'پست بانک',
  '585983': 'تجارت',
  '627353': 'تجارت',
  '502908': 'توسعه تعاون',
  '207177': 'توسعه صادرات',
  '627648': 'توسعه صادرات',
  '502938': 'دی',
  '589463': 'رفاه کارگران',
  '504172': 'رسالت',
  '621986': 'سامان',
  '589210': 'سپه',
  '639607': 'سرمایه',
  '639346': 'سینا',
  '502806': 'شهر',
  '504706': 'شهر',
  '603769': 'صادرات',
  '627961': 'صنعت و معدن',
  '606373': 'قرض‌الحسنه مهر ایران',
  '603770': 'کشاورزی',
  '639217': 'کشاورزی',
  '505801': 'کوثر',
  '505416': 'گردشگری',
  '636949': 'حکمت ایرانیان',
  '628023': 'مسکن',
  '610433': 'ملت',
  '991975': 'ملت',
  '603799': 'ملی',
  '170019': 'ملی',
  '606256': 'ملل',
  '627412': 'اقتصاد نوین',
  '639370': 'مهر اقتصاد',
  '507677': 'نور',
  '628157': 'توسعه اعتباری',
  '636795': 'مرکزی',
}

export function bankFromCard(digitsValue: string): string | null {
  if (digitsValue.length < 6) return null
  return BINS[digitsValue.slice(0, 6)] ?? null
}
