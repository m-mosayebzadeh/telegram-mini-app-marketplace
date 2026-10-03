/**
 * Whether the paid layer — offers, Photon, paid sessions — is part of this
 * version of the app.
 *
 * It is not (TECHNICAL_REQUIREMENTS.md section 32: growth comes first, and
 * the paid layer stays off until arbitration exists to support it). Its
 * screens are already hidden; this switch also stops the app asking the
 * server about requests and sessions that nobody can see, which every
 * visit to the world and every message in a conversation used to do.
 *
 * One constant rather than a server setting on purpose: turning the paid
 * layer back on is a release of its own, with screens to bring back, not a
 * switch to flip in the panel.
 */
export const PAID_LAYER = false
