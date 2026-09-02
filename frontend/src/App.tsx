import { useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconActivity, IconChat, IconDashboard, IconDiscover, IconPersonFallback } from './components/icons'
import { apiFetch } from './lib/api'
import { MeProvider, useMe } from './lib/MeContext'
import { needsDevLogin } from './lib/session'
import type { PublicProfile } from './lib/types'
import Discover from './pages/Discover'
import Login from './pages/Login'
import OfferDetail from './pages/OfferDetail'
import CreateOffer from './pages/CreateOffer'
import ChatSessionDetail from './pages/ChatSessionDetail'
import WalletPage from './pages/Wallet'
import ProfileTab from './pages/ProfileTab'
import EditProfile from './pages/EditProfile'
import ContentDetail from './pages/ContentDetail'
import FollowList from './pages/FollowList'
import FollowRequests from './pages/FollowRequests'
import ProviderSummary from './pages/ProviderSummary'
import BuyerSummary from './pages/BuyerSummary'
import Activity from './pages/Activity'
import Chats from './pages/Chats'
import TopUp from './pages/TopUp'
import AdminHub from './pages/AdminHub'
import AdminFinance from './pages/AdminFinance'
import AdminTopUps from './pages/AdminTopUps'
import AdminAccess from './pages/AdminAccess'

/**
 * The four bottom-tab sections and which URLs belong to each. Listed in
 * ONE logical order — profile, activity, chats, discover — and left at
 * that; a plain `display:flex; flex-direction:row` nav mirrors its
 * child order automatically under `dir="rtl"` vs `dir="ltr"` (see
 * index.html's `dir` attribute, kept in sync with the active language
 * by i18n/config.ts), which is exactly why this one DOM order already
 * renders "Profile | Activity | Chats | Discover" left-to-right in
 * English and "پروفایل | تعاملات | گفتگوها | کشف" right-to-left in
 * Persian without any per-language branching here.
 *
 * "My offers"/"My requests"/"Wallet" no longer have their own bottom
 * tab — offer & request management moved into the Activity tab (see
 * pages/Activity.tsx), and Wallet moved into the settings list at the
 * bottom of the Profile tab. Their routes are kept below so existing
 * deep links/navigate() calls elsewhere don't break, just unlinked from
 * the nav bar itself.
 */
const TABS = [
  {
    key: 'profile',
    path: '/profile',
    isActive: (pathname: string) =>
      pathname === '/' ||
      pathname === '/profile' ||
      pathname === '/follow-requests' ||
      pathname.startsWith('/content/') ||
      pathname.startsWith('/profiles/'),
  },
  {
    key: 'activity',
    path: '/activity',
    isActive: (pathname: string) => pathname === '/activity' || pathname === '/offers/new',
  },
  {
    key: 'chats',
    path: '/chats',
    isActive: (pathname: string) => pathname === '/chats' || pathname.startsWith('/chat-sessions/'),
  },
  {
    key: 'discover',
    path: '/offers',
    isActive: (pathname: string) => pathname === '/offers' || /^\/offers\/\d+$/.test(pathname),
  },
] as const

function AppShell() {
  const { t } = useTranslation()
  const { me, adminAccess } = useMe()
  const location = useLocation()
  const navigate = useNavigate()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // A 5th nav item, only for the tiny minority of accounts with any
  // admin access at all — adminAccess is fetched once per session (see
  // MeContext.tsx), never re-checked per page/navigation.
  const isAdmin = !!adminAccess && (adminAccess.is_owner || adminAccess.scopes.length > 0)

  // One lightweight fetch for the nav bar's own small avatar thumbnail
  // (see .hp-bottom-nav-avatar in theme.css) — separate from whatever
  // the Profile tab itself loads, since this needs to be available on
  // every screen, not just while the Profile tab is mounted.
  useEffect(() => {
    if (!me) return
    apiFetch<PublicProfile>(`/profiles/${me.id}`)
      .then((profile) => setAvatarUrl(profile.avatar_url))
      .catch(() => setAvatarUrl(null))
  }, [me])

  return (
    // Bottom padding so the fixed bottom nav never covers the last row
    // of whatever page is currently showing.
    <div style={{ paddingBottom: 64 }}>
      <Routes>
        <Route path="/" element={<ProfileTab />} />
        <Route path="/offers" element={<Discover />} />
        <Route path="/offers/new" element={<CreateOffer />} />
        <Route path="/offers/:id" element={<OfferDetail />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/chats" element={<Chats />} />
        <Route path="/chat-sessions/:id" element={<ChatSessionDetail />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/wallet/topup" element={<TopUp />} />
        <Route path="/admin" element={<AdminHub />} />
        <Route path="/admin/finance" element={<AdminFinance />} />
        <Route path="/admin/topups" element={<AdminTopUps />} />
        <Route path="/admin/access" element={<AdminAccess />} />
        <Route path="/profile" element={<ProfileTab />} />
        <Route path="/profile/edit" element={<EditProfile />} />
        <Route path="/follow-requests" element={<FollowRequests />} />
        <Route path="/content/:id" element={<ContentDetail />} />
        <Route path="/profiles/:id" element={<ProfileTab />} />
        <Route path="/profiles/:id/provider-summary" element={<ProviderSummary />} />
        <Route path="/profiles/:id/buyer-summary" element={<BuyerSummary />} />
        <Route path="/profiles/:id/:kind" element={<FollowList />} />
      </Routes>
      <nav className="hp-bottom-nav">
        {TABS.map((tab) => {
          const active = tab.isActive(location.pathname)
          return (
            <button
              key={tab.path}
              className={`hp-bottom-nav-item ${active ? 'hp-bottom-nav-item-active' : ''}`}
              onClick={() => navigate(tab.path)}
            >
              <span className="hp-bottom-nav-icon" aria-hidden="true">
                {tab.key === 'profile' &&
                  (avatarUrl ? (
                    <img className="hp-bottom-nav-avatar" src={avatarUrl} alt="" />
                  ) : (
                    <IconPersonFallback size={22} />
                  ))}
                {tab.key === 'activity' && <IconActivity size={22} />}
                {tab.key === 'chats' && <IconChat size={22} />}
                {tab.key === 'discover' && <IconDiscover size={22} />}
                {/* A plain "something needs attention" dot, not a count
                    — see lib/types.ts's Me.has_unseen_requests. Cleared
                    per-offer by opening that offer's own request list
                    (pages/OfferDetail.tsx), never by merely opening this
                    tab itself. */}
                {tab.key === 'activity' && me?.has_unseen_requests && (
                  <span className="hp-nav-unseen-dot" aria-hidden="true" />
                )}
              </span>
              {t(`tabs.${tab.key}`)}
            </button>
          )
        })}
        {isAdmin && (
          <button
            className={`hp-bottom-nav-item ${location.pathname.startsWith('/admin') ? 'hp-bottom-nav-item-active' : ''}`}
            onClick={() => navigate('/admin')}
          >
            <span className="hp-bottom-nav-icon" aria-hidden="true">
              <IconDashboard size={22} />
            </span>
            {t('tabs.admin')}
          </button>
        )}
      </nav>
    </div>
  )
}

function App() {
  // Real Telegram launches never hit this — retrieveRawInitData()
  // succeeds there, so needsDevLogin() is always false. This only ever
  // shows up in a plain browser during local development, before a
  // test user has been chosen for this tab (see lib/session.ts and
  // pages/Login.tsx).
  if (needsDevLogin()) {
    return <Login />
  }

  return (
    <MeProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </MeProvider>
  )
}

export default App
