import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { financeError } from '../lib/withdrawalApi'
import { PageHeader, EmptyState, ErrorState, SkeletonRows, Segments } from '../components/ui'
import { IconChevron, IconWallet } from '../components/icons'
import type { WalletHistoryRow } from '../lib/types'

type Filter = 'all' | 'in' | 'out' | 'pending'

/**
 * Everything that happened to this wallet, newest first.
 *
 * Rows, not cards: they are a homogeneous list, and a page of boxes makes a
 * ledger harder to scan rather than easier. Direction is carried by the
 * amount's own sign and colour, so a credit and a debit are told apart without
 * reading either label.
 *
 * Deliberately absent: who was on the other side. A list that reads "25 Drops
 * from Sara" is a problem the moment someone glances at the screen. What it
 * was about is here; who it was with is one tap away, on the thing itself.
 *
 * Filtering happens here rather than on the server. The list is small enough
 * per person to arrive in one request, and a round trip per tap would cost a
 * visible pause for work the device can do instantly.
 */
export default function WalletHistory() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [rows, setRows] = useState<WalletHistoryRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState('')

  function load() {
    setError('')
    apiFetch<WalletHistoryRow[]>('/wallet/history')
      .then(setRows)
      .catch((e) => setError(financeError(e, t)))
  }

  useEffect(load, [t])

  const shown = useMemo(() => {
    if (!rows) return null
    if (filter === 'in') return rows.filter((row) => row.amount_drops > 0)
    if (filter === 'out') return rows.filter((row) => row.amount_drops < 0)
    if (filter === 'pending') return rows.filter((row) => row.status !== 'settled')
    return rows
  }, [rows, filter])

  /** Where a row leads, when it leads anywhere. The server decides: a seller
   *  who deleted their own content cannot open it, so that row carries no
   *  target rather than a dead end. */
  function open(row: WalletHistoryRow) {
    if (row.chat_session_id) navigate(`/chat-sessions/${row.chat_session_id}`)
    else if (row.content_id) navigate(`/content/${row.content_id}`)
  }

  return (
    <div className="ui-page">
      <PageHeader title={t('finance.history')} onBack={() => navigate('/wallet')} />

      <div className="ui-page-body">
        <Segments
          label={t('finance.history')}
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: t('history.filterAll') },
            { id: 'in', label: t('history.filterIn') },
            { id: 'out', label: t('history.filterOut') },
            { id: 'pending', label: t('history.filterPending') },
          ]}
        />

        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : shown === null ? (
          <SkeletonRows count={5} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<IconWallet size={24} />}
            title={t('finance.emptyHistory')}
            text={t('finance.emptyHistoryHint')}
          />
        ) : (
          <div className="ui-list">
            {shown.map((row, index) => {
              const credit = row.amount_drops > 0
              const target = row.chat_session_id ?? row.content_id
              const Row = target ? 'button' : 'div'
              return (
                <Row
                  className="ui-row"
                  key={`${row.kind}-${row.at}-${index}`}
                  {...(target ? { type: 'button' as const, onClick: () => open(row) } : {})}
                >
                  <span className="ui-row-main">
                    <span className="ui-row-title">{t(`history.kind.${row.kind}`)}</span>
                    <span className="ui-row-subtitle">
                      {/* What it was about, when there is anything to say —
                          never who it was with. */}
                      {row.subject ? `${row.subject} · ` : ''}
                      {new Date(row.at).toLocaleDateString(i18n.language)}
                    </span>
                  </span>

                  <span className="ui-row-trailing wh-trailing">
                    <span className={`wh-amount tabular${credit ? ' wh-amount-credit' : ''}`}>
                      <bdi>
                        {credit ? '+' : '−'}
                        {t('history.drops', { amount: Math.abs(row.amount_drops) })}
                      </bdi>
                    </span>
                    {/* Money that has not finished moving says so. Without it,
                        an amount that can still change looks final. */}
                    {row.status !== 'settled' && (
                      <span className="wh-status">{t(`history.status.${row.status}`)}</span>
                    )}
                    {target ? <IconChevron size={16} className="ui-row-chevron" /> : null}
                  </span>
                </Row>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
