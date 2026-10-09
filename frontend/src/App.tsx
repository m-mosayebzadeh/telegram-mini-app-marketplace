import { useEffect, useState } from 'react'
import { useWide } from './lib/useWide'
import { TalkColumn, TalkNobodyYet } from './components/cosmos/TalkColumn'
import { PushOffer } from './components/cosmos/PushOffer'
import BankAccounts from './pages/BankAccounts'
import Withdraw from './pages/Withdraw'
import AdminWithdrawals from './pages/AdminWithdrawals'
import WalletHistory from './pages/WalletHistory'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconActivity, IconChat, IconDashboard, IconDiscover, IconPersonFallback } from './components/icons'
import { LiveSessionBar } from './components/LiveSessionBar'
import { MeProvider, useMe } from './lib/MeContext'
import { SIGNED_OUT_EVENT, checkSignedIn, forgetWhereYouWere } from './lib/auth'
import Discover from './pages/Discover'
import Sky from './pages/Sky'
import Conversation from './pages/Conversation'
import Echo from './pages/Echo'
import Events from './pages/Events'
import { WorldBar } from './components/cosmos/WorldBar'
import { doorOf } from './components/cosmos/worldBarDoors'
import { EchoOffer } from './components/cosmos/EchoOffer'
import SignIn from './pages/SignIn'
import LinkDevice from './pages/LinkDevice'
import Sessions from './pages/Sessions'
import SignInWays from './pages/SignInWays'
import OfferDetail from './pages/OfferDetail'
import CreateOffer from './pages/CreateOffer'
import ChatSessionDetail from './pages/ChatSessionDetail'
import WalletPage from './pages/Wallet'
import ProfileTab from './pages/ProfileTab'
import Settings from './pages/Settings'
import EditProfile from './pages/EditProfile'
import ContentDetail from './pages/ContentDetail'
import ProviderSummary from './pages/ProviderSummary'
import BuyerSummary from './pages/BuyerSummary'
import Activity from './pages/Activity'
import TopUp from './pages/TopUp'
import AdminHub from './pages/AdminHub'
import AdminEcho from './pages/AdminEcho'
import AdminFeedback from './pages/AdminFeedback'
import AdminAnalytics from './pages/AdminAnalytics'
import BlockedPeople from './pages/BlockedPeople'
import Friends from './pages/Friends'
import { AccountGone } from './components/cosmos/AccountDoors'
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
 * reached from the Photon chip in each tab root's header and from the
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
    // The list of conversations is the world's conversations region now
    // (TECHNICAL_REQUIREMENTS.md section 31), so the tab goes there.
    key: 'chats',
    path: '/sky/talk',
    isActive: (pathname: string) => pathname.startsWith('/chat-sessions/'),
  },
  {
    key: 'profile',
    path: '/profile',
    isActive: (pathname: string) =>
      pathname === '/profile' ||
      pathname === '/settings' ||
      pathname.startsWith('/content/') ||
      pathname.startsWith('/profiles/'),
  },
] as const

/** The conversation list's column, and on /sky/talk the quiet "choose one"
 *  where the open conversation will be. The open conversation itself is
 *  the ordinary route, laid out beside the column by the stylesheet. */
function TalkSplit({ pathname }: { pathname: string }) {
  const byId = pathname.match(/^\/conversations\/(\d+)/)
  const byPerson = pathname.match(/^\/conversations\/with\/(\d+)/)
  return (
    <>
      <TalkColumn current={{ conversationId: byId ? Number(byId[1]) : undefined, userId: byPerson ? Number(byPerson[1]) : undefined }} />
      {pathname === '/sky/talk' && <TalkNobodyYet />}
    </>
  )
}

function AppShell() {
  const { t } = useTranslation()
  const { me, adminAccess, deleted } = useMe()
  const location = useLocation()
  const navigate = useNavigate()
  // The nav bar's own small avatar thumbnail (see .hp-bottom-nav-avatar
  // in theme.css) comes straight from `me` now — it used to run its own
  // separate /profiles/{id} fetch, but that only re-ran when `me` itself
  // changed identity (effectively once per session), so uploading a new
  // avatar elsewhere in the app never updated this thumbnail until a
  // full reload. `me.avatar_url` updates the same way every other /me
  // value does, via useMe()'s refreshMe().
  const avatarUrl = me?.avatar_url ?? null
  // A 5th nav item, only for the tiny minority of accounts with any
  // admin access at all — adminAccess is fetched once per session (see
  // MeContext.tsx), never re-checked per page/navigation.
  const isAdmin = !!adminAccess && (adminAccess.is_owner || adminAccess.scopes.length > 0)

  // A chat session is an immersive screen, not a destination: it is
  // pushed onto a tab, it fills the viewport, and its composer needs the
  // bottom of the screen. Showing the tab bar over it would offer four
  // ways to leave a conversation the user is in the middle of, and cost
  // a row of messages to do it.
  //
  // The world's screens are immersive for a different reason: they carry
  // their own navigation. The core at the bottom IS the nav, and a second
  // bar underneath it would be two navigations arguing over the same
  // corner of the screen — plus it sits exactly where the core opens.
  const COSMOS = ['/sky', '/echo', '/conversations', '/events']
  // The world's five doors (section 32) own the bottom wherever one of them
  // is the page — your own profile included — so the older tab bar steps
  // aside there rather than stacking a second navigation under the first.
  const wide = useWide()
  // On a computer, conversations are two columns, like Telegram (the
  // owner's call, section 43): the list beside the open one, the doors in
  // their column — "conversations" lit, since that is where you are.
  const talkSplit = wide && (location.pathname === '/sky/talk' || location.pathname.startsWith('/conversations/'))
  const door = doorOf(location.pathname) ?? (talkSplit ? 'talk' : null)
  const immersive =
    door !== null ||
    location.pathname.startsWith('/chat-sessions/') ||
    COSMOS.some((path) => location.pathname === path || location.pathname.startsWith(path + '/'))

  // On a computer the world's doors stand in a column at the side
  // (section 43); the pages that have them make room for it. Only a class:
  // the width at which it applies is the stylesheet's to decide.
  useEffect(() => {
    document.documentElement.classList.toggle('cos-has-rail', door !== null)
    document.documentElement.classList.toggle('cos-talk-split', talkSplit)
    // The admin panel's pages are built from the older shared components;
    // in this one class they take the world's colours and type (section 43).
    document.documentElement.classList.toggle('cos-admin', location.pathname.startsWith('/admin'))
    return () => document.documentElement.classList.remove('cos-has-rail', 'cos-talk-split', 'cos-admin')
  }, [door, talkSplit, location.pathname])

  // After the account was deleted, only the way to start again (section
  // 32, step 4). "Eighteen or over" is asked in Echo, not here.
  if (deleted) return <AccountGone />

  return (
    // Each page reserves its own room for the nav bar through
    // .ui-page-body, which also accounts for the safe area — a single
    // fixed number here could not.
    <>
      {/* Above the page's own header on purpose: a conversation in progress
          outranks whatever screen you happen to be looking at. */}
      <LiveSessionBar />
      {/* "Want to know when they answer?" — shows itself only when a
          moment calls for it (section 38). */}
      <PushOffer />
      <Routes>
        {/* The app opens on the world: it is the product (section 31).
            The showcase stays at /offers until finding a service has a
            home of its own in the world. */}
        <Route path="/" element={<Navigate to="/sky" replace />} />
        {/* One screen for the world and its regions, so travelling between
            them is a movement in the world rather than a page change, and
            the phone's back button still leaves a region. */}
        <Route path="/sky/:region?" element={talkSplit ? null : <Sky />} />
        <Route path="/echo" element={<Echo />} />
        <Route path="/events" element={<Events />} />
        {/* Two ways in: by person, from the world, which opens the
            one thread those two have; and by thread, from the chat
            list and from Echo, which already know which one. */}
        <Route path="/conversations/with/:userId" element={<Conversation />} />
        <Route path="/conversations/:id" element={<Conversation />} />
        <Route path="/offers" element={<Discover />} />
        <Route path="/offers/new" element={<CreateOffer />} />
        <Route path="/offers/:id" element={<OfferDetail />} />
        <Route path="/activity" element={<Activity />} />
        {/* Old links to the conversation list land on the stair. */}
        <Route path="/chats" element={<Navigate to="/sky/talk" replace />} />
        <Route path="/chat-sessions/:id" element={<ChatSessionDetail />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/wallet/topup" element={<TopUp />} />
        <Route path="/wallet/banks" element={<BankAccounts />} />
        <Route path="/wallet/withdraw" element={<Withdraw />} />
        <Route path="/wallet/history" element={<WalletHistory />} />
        <Route path="/admin/withdrawals" element={<AdminWithdrawals />} />
        <Route path="/admin" element={<AdminHub />} />
        <Route path="/admin/echo" element={<AdminEcho />} />
        <Route path="/admin/feedback" element={<AdminFeedback />} />
        <Route path="/admin/analytics" element={<AdminAnalytics />} />
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
        <Route path="/friends" element={<Friends />} />
        <Route path="/settings/blocked" element={<BlockedPeople />} />
        <Route path="/settings/sessions" element={<Sessions />} />
        <Route path="/settings/ways" element={<SignInWays />} />
        <Route path="/link" element={<LinkDevice />} />
        <Route path="/content/:id" element={<ContentDetail />} />
        <Route path="/profiles/:id" element={<ProfileTab />} />
        <Route path="/profiles/:id/provider-summary" element={<ProviderSummary />} />
        <Route path="/profiles/:id/buyer-summary" element={<BuyerSummary />} />
      </Routes>
      {talkSplit && <TalkSplit pathname={location.pathname} />}
      {door !== null && <WorldBar current={door} />}
      {/* Wherever you are: somebody found in Echo reaches you on any
          screen, because searching does not keep you on Echo's. */}
      <EchoOffer />
      {!immersive && (
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
      )}
    </>
  )
}

/**
 * Who is here, before anything else (TECHNICAL_REQUIREMENTS.md section 32).
 *
 * The app asks the server once whether this device is signed in; signed
 * out, it shows the sign-in screen instead of the app. It also listens for
 * "signed out" from anywhere — a refused request, or the live connection
 * when another device closed this session — and goes to the sign-in screen
 * at once (the owner's instruction).
 */
function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    checkSignedIn()
      .then((yes) => { if (alive) setSignedIn(yes) })
      .catch(() => { if (alive) setSignedIn(false) })
    const out = () => {
      forgetWhereYouWere()
      setSignedIn(false)
    }
    window.addEventListener(SIGNED_OUT_EVENT, out)
    return () => {
      alive = false
      window.removeEventListener(SIGNED_OUT_EVENT, out)
    }
  }, [])

  if (signedIn === null) return null
  if (!signedIn) return <SignIn />

  return (
    <MeProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </MeProvider>
  )
}

export default App
