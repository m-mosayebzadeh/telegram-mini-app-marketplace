import BankAccounts from './pages/BankAccounts'
import Withdraw from './pages/Withdraw'
import AdminWithdrawals from './pages/AdminWithdrawals'
import WalletHistory from './pages/WalletHistory'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconActivity, IconChat, IconDashboard, IconDiscover, IconPersonFallback } from './components/icons'
import { MeProvider, useMe } from './lib/MeContext'
import { needsDevLogin } from './lib/session'
import Discover from './pages/Discover'
import Login from './pages/Login'
import OfferDetail from './pages/OfferDetail'
import CreateOffer from './pages/CreateOffer'
import ChatSessionDetail from './pages/ChatSessionDetail'
import WalletPage from './pages/Wallet'
import ProfileTab from './pages/ProfileTab'
import Settings from './pages/Settings'
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
import AdminRates from './pages/AdminRates'
import AdminUsers from './pages/AdminUsers'
import AdminUserDetail from './pages/AdminUserDetail'
import AdminAssistantsHub from './pages/AdminAssistantsHub'
import AdminAssistantSearch from './pages/AdminAssistantSearch'
import AdminUserRoles from './pages/AdminUserRoles'
import AdminRoles from './pages/AdminRoles'
import AdminRoleDetail from './pages/AdminRoleDetail'
import AdminRoleMembers from './pages/AdminRoleMembers'

/**
 * The four bottom-tab sections and which URLs belong to each.
 *
 * DOM order is discover, activity, chats, profile — and that single
 * order is the whole implementation for both directions: a plain
 * `display: flex` row mirrors its children under `dir="rtl"` (set on
 * <html> by i18n/config.ts), so this renders
 * "ویترین · تعاملات · گفتگوها · پروفایل" right-to-left in Persian and
 * the same sequence left-to-right in English, with no per-language
 * branching.
 *
 * Discover comes first now. The first tab is what a user lands on and
 * what the app claims to be for, and this product is for finding people
 * — opening on your own profile answered a question nobody had (see
 * docs/design-system/03-patterns.md and docs/UI_REDESIGN_ANALYSIS.md).
 *
 * "My offers" / "My requests" / "Wallet" have no tab of their own: offer
 * and request management live in the Activity tab, and the wallet is
 * reached from the Drop chip in each tab root's header and from the
 * profile. Their routes stay below so existing deep links keep working.
 */
const TABS = [
  {
    key: 'discover',
    path: '/offers',
    isActive: (pathname: string) =>
      pathname === '/' || pathname === '/offers' || /^\/offers\/\d+$/.test(pathname),
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
    key: 'profile',
    path: '/profile',
    isActive: (pathname: string) =>
      pathname === '/profile' ||
      pathname === '/settings' ||
      pathname === '/follow-requests' ||
      pathname.startsWith('/content/') ||
      pathname.startsWith('/profiles/'),
  },
] as const

function AppShell() {
  const { t } = useTranslation()
  const { me, adminAccess } = useMe()
  const location = useLocation()
  const navigate = useNavigate()
  // The nav bar's own small avatar thumbnail (see .hp-bottom-nav-avatar
  // in theme.css) comes straight from `me` now — it used to run its own
  // separate /profiles/{id} fetch, but that only re-ran when `me` itself
  // changed identity (effectively once per session), so uploading a new
  // avatar elsewhere in the app never updated this thumbnail until a
  // full reload. `me.avatar_url` updates the same way every other /me
  // value does, via useMe()'s refreshMe() (see ProfileHeader.tsx).
  const avatarUrl = me?.avatar_url ?? null
  // A 5th nav item, only for the tiny minority of accounts with any
  // admin access at all — adminAccess is fetched once per session (see
  // MeContext.tsx), never re-checked per page/navigation.
  const isAdmin = !!adminAccess && (adminAccess.is_owner || adminAccess.scopes.length > 0)

  return (
    // Each page reserves its own room for the nav bar through
    // .ui-page-body, which also accounts for the safe area — a single
    // fixed number here could not.
    <>
      <Routes>
        {/* The app opens on the showcase, not on your own profile —
            see TABS above. */}
        <Route path="/" element={<Discover />} />
        <Route path="/offers" element={<Discover />} />
        <Route path="/offers/new" element={<CreateOffer />} />
        <Route path="/offers/:id" element={<OfferDetail />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/chats" element={<Chats />} />
        <Route path="/chat-sessions/:id" element={<ChatSessionDetail />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/wallet/topup" element={<TopUp />} />
        <Route path="/wallet/banks" element={<BankAccounts />} />
        <Route path="/wallet/withdraw" element={<Withdraw />} />
        <Route path="/wallet/history" element={<WalletHistory />} />
        <Route path="/admin/withdrawals" element={<AdminWithdrawals />} />
        <Route path="/admin" element={<AdminHub />} />
        <Route path="/admin/finance" element={<AdminFinance />} />
        <Route path="/admin/topups" element={<AdminTopUps />} />
        <Route path="/admin/rates" element={<AdminRates />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/users/:id" element={<AdminUserDetail />} />
        <Route path="/admin/assistants" element={<AdminAssistantsHub />} />
        <Route path="/admin/assistants/search" element={<AdminAssistantSearch />} />
        <Route path="/admin/assistants/users/:id/roles" element={<AdminUserRoles />} />
        <Route path="/admin/assistants/roles" element={<AdminRoles />} />
        <Route path="/admin/assistants/roles/new" element={<AdminRoleDetail />} />
        <Route path="/admin/assistants/roles/:id" element={<AdminRoleDetail />} />
        <Route path="/admin/assistants/roles/:id/members" element={<AdminRoleMembers />} />
        <Route path="/profile" element={<ProfileTab />} />
        <Route path="/profile/edit" element={<EditProfile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/follow-requests" element={<FollowRequests />} />
        <Route path="/content/:id" element={<ContentDetail />} />
        <Route path="/profiles/:id" element={<ProfileTab />} />
        <Route path="/profiles/:id/provider-summary" element={<ProviderSummary />} />
        <Route path="/profiles/:id/buyer-summary" element={<BuyerSummary />} />
        <Route path="/profiles/:id/:kind" element={<FollowList />} />
      </Routes>
      <nav className="ui-nav">
        {TABS.map((tab) => {
          const active = tab.isActive(location.pathname)
          return (
            <button
              key={tab.path}
              className={`ui-nav-item${active ? ' ui-nav-item-active' : ''}`}
              onClick={() => navigate(tab.path)}
              aria-current={active ? 'page' : undefined}
            >
              <span className="ui-nav-icon" aria-hidden="true">
                {tab.key === 'discover' && <IconDiscover size={22} />}
                {tab.key === 'activity' && <IconActivity size={22} />}
                {tab.key === 'chats' && <IconChat size={22} />}
                {tab.key === 'profile' &&
                  (avatarUrl ? (
                    <img className="ui-nav-avatar" src={avatarUrl} alt="" />
                  ) : (
                    <IconPersonFallback size={22} />
                  ))}
              </span>
              {t(`tabs.${tab.key}`)}
              {/* ONE dot for either kind of "something's new" — a new
                  incoming request on one of your own offers, or one of
                  YOUR OWN sent requests getting a response (see
                  lib/types.ts's Me.has_unseen_requests /
                  unseen_sent_request_updates_count). Which kind it is is
                  not answered here; the Activity page's own segment
                  badges already do that, and this only has to say "go
                  look". Neither is cleared by opening this tab. */}
              {tab.key === 'activity' &&
                (me?.has_unseen_requests || (me?.unseen_sent_request_updates_count ?? 0) > 0) && (
                  <span className="ui-nav-dot" aria-hidden="true" />
                )}
            </button>
          )
        })}
        {isAdmin && (
          <button
            className={`ui-nav-item${location.pathname.startsWith('/admin') ? ' ui-nav-item-active' : ''}`}
            onClick={() => navigate('/admin')}
          >
            <span className="ui-nav-icon" aria-hidden="true">
              <IconDashboard size={22} />
            </span>
            {t('tabs.admin')}
          </button>
        )}
      </nav>
    </>
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
