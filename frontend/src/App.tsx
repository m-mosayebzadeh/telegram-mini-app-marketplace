import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MeProvider } from './lib/MeContext'
import { needsDevLogin } from './lib/session'
import Discover from './pages/Discover'
import Login from './pages/Login'
import OfferDetail from './pages/OfferDetail'
import MyOffers from './pages/MyOffers'
import CreateOffer from './pages/CreateOffer'
import MyRequests from './pages/MyRequests'
import ChatSessionDetail from './pages/ChatSessionDetail'
import WalletPage from './pages/Wallet'
import ProfileTab from './pages/ProfileTab'
import ContentDetail from './pages/ContentDetail'
import FollowList from './pages/FollowList'
import FollowRequests from './pages/FollowRequests'
import ProviderSummary from './pages/ProviderSummary'
import BuyerSummary from './pages/BuyerSummary'

/**
 * The five bottom-tab sections and which URLs belong to each — kept as
 * plain matcher functions (not a simple startsWith, since "/offers" is
 * a literal prefix of both "/offers/mine" and "/offers/123" but those
 * belong to different tabs) so the currently-selected tab is always
 * unambiguous.
 */
const TABS = [
  {
    key: 'discover',
    path: '/offers',
    isActive: (pathname: string) =>
      pathname === '/' || (pathname.startsWith('/offers/') && !pathname.startsWith('/offers/mine') && pathname !== '/offers/new') || pathname === '/offers',
  },
  {
    key: 'myOffers',
    path: '/offers/mine',
    isActive: (pathname: string) => pathname.startsWith('/offers/mine') || pathname === '/offers/new',
  },
  {
    key: 'myRequests',
    path: '/requests/mine',
    isActive: (pathname: string) => pathname.startsWith('/requests/') || pathname.startsWith('/chat-sessions/'),
  },
  { key: 'wallet', path: '/wallet', isActive: (pathname: string) => pathname === '/wallet' },
  {
    key: 'profile',
    path: '/profile',
    isActive: (pathname: string) =>
      pathname === '/profile' || pathname === '/follow-requests' || pathname.startsWith('/content/'),
  },
] as const

function AppShell() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()

  return (
    // Bottom padding so the fixed bottom nav never covers the last row
    // of whatever page is currently showing.
    <div style={{ paddingBottom: 64 }}>
      <Routes>
        <Route path="/" element={<Discover />} />
        <Route path="/offers" element={<Discover />} />
        <Route path="/offers/mine" element={<MyOffers />} />
        <Route path="/offers/new" element={<CreateOffer />} />
        <Route path="/offers/:id" element={<OfferDetail />} />
        <Route path="/requests/mine" element={<MyRequests />} />
        <Route path="/chat-sessions/:id" element={<ChatSessionDetail />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/profile" element={<ProfileTab />} />
        <Route path="/follow-requests" element={<FollowRequests />} />
        <Route path="/content/:id" element={<ContentDetail />} />
        <Route path="/profiles/:id" element={<ProfileTab />} />
        <Route path="/profiles/:id/provider-summary" element={<ProviderSummary />} />
        <Route path="/profiles/:id/buyer-summary" element={<BuyerSummary />} />
        <Route path="/profiles/:id/:kind" element={<FollowList />} />
      </Routes>
      {/* A custom hp-* bottom nav instead of telegram-ui's own <Tabbar> —
          that one follows AppRoot's Telegram platform/light-dark theme,
          which would clash with the fixed dark "lounge" background every
          page now uses (see .hp-bottom-nav's comment in theme.css). Same
          TABS/isActive logic as before, only the rendering changed. */}
      <nav className="hp-bottom-nav">
        {TABS.map((tab) => {
          const active = tab.isActive(location.pathname)
          return (
            <button
              key={tab.path}
              className={`hp-bottom-nav-item ${active ? 'hp-bottom-nav-item-active' : ''}`}
              onClick={() => navigate(tab.path)}
            >
              <span className="hp-bottom-nav-dot" aria-hidden="true" />
              {t(`tabs.${tab.key}`)}
            </button>
          )
        })}
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
