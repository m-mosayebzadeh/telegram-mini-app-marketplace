import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useGoBack } from './goBack'

/** The bug the owner found: Settings → another device → back → back landed on another device again. */
describe('a back button that really goes back', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    window.history.replaceState(null, '')
  })

  let go: (to: string) => void = () => {}
  let back: () => void = () => {}
  let where = ''
  function Page() {
    const navigate = useNavigate()
    go = (to) => void navigate(to)
    back = useGoBack('/settings')
    where = useLocation().pathname
    return null
  }

  function open(path: string) {
    const router = createMemoryRouter([{ path: '*', element: <Page /> }], { initialEntries: [path] })
    act(() => root.render(<RouterProvider router={router} />))
    return router
  }

  it('steps back instead of stacking the parent page again', async () => {
    const router = open('/settings')
    await act(async () => go('/link'))
    // What the browser keeps for a page reached inside the app.
    window.history.replaceState({ idx: 1 }, '')
    await act(async () => back())
    expect(where).toBe('/settings')
    // The history holds Settings once, not Settings, link, Settings.
    expect(router.state.historyAction).toBe('POP')
  })

  it('goes to the parent page when opened directly, without leaving a loop behind', async () => {
    const router = open('/link')
    window.history.replaceState(null, '')
    await act(async () => back())
    expect(where).toBe('/settings')
    expect(router.state.historyAction).toBe('REPLACE')
  })
})
