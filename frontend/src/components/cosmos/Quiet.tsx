import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CosSheet } from './CosSheet'
import { QBack, QChevron } from './quietIcons'

/**
 * The pieces every quiet page is built from (styles/cosmos-quiet.css;
 * TECHNICAL_REQUIREMENTS.md section 42): settings and the pages under it,
 * editing your profile. One set of pieces, so that the seven pages read as
 * one place rather than seven screens that each found their own way to
 * draw a row — which is how the old look drifted.
 */

interface QuietPageProps {
  title: string
  onBack: () => void
  /** One thing at the end of the top bar, such as the save tick. */
  action?: ReactNode
  /** The page's one action, pinned above the world's bar. */
  foot?: ReactNode
  children: ReactNode
}

export function QuietPage({ title, onBack, action, foot, children }: QuietPageProps) {
  const { t } = useTranslation()
  return (
    <div className={`cos-q${foot ? ' has-foot' : ''}`}>
      <div className="cos-q-in">
        <header className="cos-q-top">
          <button type="button" className="cos-q-round cos-q-back" onClick={onBack} aria-label={t('common.back')}>
            <QBack />
          </button>
          <h1>{title}</h1>
          {action ?? <span className="cos-q-balance" aria-hidden="true" />}
        </header>
        {children}
      </div>
      {foot && <div className="cos-q-foot"><div>{foot}</div></div>}
    </div>
  )
}

export function QuietSection({ name, className, children }: { name?: string; className?: string; children?: ReactNode }) {
  return (
    <section className={`cos-q-sec${className ? ` ${className}` : ''}`}>
      {name && <h2 className="cos-q-sec-name">{name}</h2>}
      {children}
    </section>
  )
}

interface QuietRowProps {
  title: string
  hint?: string
  icon?: ReactNode
  /** What it is set to now, at the end of the row. */
  value?: ReactNode
  valueLatin?: boolean
  danger?: boolean
  center?: boolean
  /** A row that opens something gets the arrow; one that acts does not. */
  onClick?: () => void
  opens?: boolean
}

/** A row that opens a page or a sheet, or does one thing. */
export function QuietRow({ title, hint, icon, value, valueLatin, danger, center, onClick, opens = true }: QuietRowProps) {
  const cls = `cos-q-row${danger ? ' is-danger' : ''}${center ? ' is-center' : ''}`
  return (
    <button type="button" className={cls} onClick={onClick}>
      {icon !== undefined && <span className={`cos-q-ico${icon === null ? ' is-blank' : ''}`}>{icon}</span>}
      <span className="cos-q-txt">
        <span className="cos-q-t">{title}</span>
        {hint && <span className="cos-q-h">{hint}</span>}
      </span>
      {value !== undefined && <span className={`cos-q-v${valueLatin ? ' is-latin' : ''}`}>{value}</span>}
      {opens && !center && <QChevron />}
    </button>
  )
}

interface QuietSwitchRowProps {
  title: string
  hint?: string
  icon?: ReactNode
  on: boolean
  disabled?: boolean
  onToggle: () => void
}

/** A setting that is on or off. Takes effect the moment it is tapped. */
export function QuietSwitchRow({ title, hint, icon, on, disabled, onToggle }: QuietSwitchRowProps) {
  return (
    <div className="cos-q-row">
      {icon !== undefined && <span className={`cos-q-ico${icon === null ? ' is-blank' : ''}`}>{icon}</span>}
      <span className="cos-q-txt">
        <span className="cos-q-t">{title}</span>
        {hint && <span className="cos-q-h">{hint}</span>}
      </span>
      {/* The switch carries the row's name, so a screen reader says what
          it turns on, not only that something is on. */}
      <button type="button" role="switch" className="cos-q-sw" aria-checked={on} aria-label={title} disabled={disabled} onClick={onToggle} />
    </div>
  )
}

interface Choice<T extends string> {
  value: T
  label: string
  latin?: boolean
}

interface QuietChoiceRowProps<T extends string> {
  title: string
  hint?: string
  choices: Choice<T>[]
  value: T | null
  disabled?: boolean
  onChoose: (value: T) => void
  /** Under the choices: what goes with one of them (the "choose people" link). */
  after?: ReactNode
}

/** A setting with a few answers side by side, the chosen one lit. */
export function QuietChoiceRow<T extends string>({ title, hint, choices, value, disabled, onChoose, after }: QuietChoiceRowProps<T>) {
  return (
    <div className="cos-q-row is-stack">
      <span className="cos-q-txt">
        <span className="cos-q-t">{title}</span>
        {hint && <span className="cos-q-h">{hint}</span>}
      </span>
      <div className="cos-q-seg" role="group" aria-label={title}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={choice.latin ? 'is-latin' : undefined}
            aria-pressed={value === choice.value}
            disabled={disabled}
            onClick={() => onChoose(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {after}
    </div>
  )
}

interface QuietConfirmProps {
  title: string
  text: string
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A decision with consequences, as a sheet from the bottom — where the
 * thumb already is — rather than a box in the middle of the screen. The
 * act itself is the full-width button; going back is the quiet one under it.
 */
export function QuietConfirm({ title, text, confirmLabel, destructive, busy, onConfirm, onCancel }: QuietConfirmProps) {
  const { t } = useTranslation()
  return (
    <CosSheet title={title} onClose={onCancel}>
      <div className="cos-q-sheet-body">
        <p className="cos-q-sheet-text">{text}</p>
        <div className="cos-q-sheet-actions">
          <button type="button" className={`cos-q-primary${destructive ? ' is-danger' : ''}`} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="cos-q-text" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </CosSheet>
  )
}

/** Waiting for the page's first answer: the shape of rows, breathing. */
export function QuietWaiting({ rows = 3 }: { rows?: number }) {
  return (
    <div className="cos-q-wait" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => <span key={i} />)}
    </div>
  )
}

/** The page could not be read: what happened, and trying again. */
export function QuietError({ text, onRetry }: { text: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="cos-q-empty" role="alert">
      <p>{text}</p>
      <button type="button" className="cos-q-quiet" onClick={onRetry}>{t('common.retry')}</button>
    </div>
  )
}

/** Nobody there: a far, soft body, the way somebody absent looks in the world. */
export function QuietEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="cos-q-empty">
      <span className="cos-q-far" aria-hidden="true" />
      <b>{title}</b>
      <p>{text}</p>
    </div>
  )
}
