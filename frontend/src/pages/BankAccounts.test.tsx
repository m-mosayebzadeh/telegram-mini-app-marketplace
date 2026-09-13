import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import BankAccounts from './BankAccounts'
import { ToastProvider } from '../components/ui'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  bankAccounts: vi.fn(),
  t: (key: string, args?: Record<string, unknown>) =>
    args ? `${key} ${JSON.stringify(args)}` : key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'en' } }),
}))
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  apiFetch: mocks.api,
}))
vi.mock('../lib/withdrawalApi', async (original) => ({
  ...(await original<typeof import('../lib/withdrawalApi')>()),
  bankAccounts: mocks.bankAccounts,
}))
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

let root: Root
let container: HTMLDivElement

async function render() {
  await act(async () => {
    root.render(
      <ToastProvider>
        <MemoryRouter>
          <BankAccounts />
        </MemoryRouter>
      </ToastProvider>,
    )
  })
}

function type(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(selector)!
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

function valueOf(selector: string) {
  return container.querySelector<HTMLInputElement>(selector)!.value
}

async function openForm() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>('.ui-action-bar .ui-btn')!.click()
  })
}

/** Fills a complete, valid account. */
async function fillValid() {
  type('#bank-holder', 'Sara Mohammadi')
  type('#bank-card', '6037991234567890')
  type('#bank-iban', '123456789012345678901234')
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.api.mockReset().mockResolvedValue({})
  mocks.navigate.mockReset()
  mocks.bankAccounts.mockReset().mockResolvedValue([])
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('BankAccounts — the card number', () => {
  it('groups the digits in fours as they are typed', async () => {
    await render()
    await openForm()

    type('#bank-card', '6037991234567890')

    expect(valueOf('#bank-card')).toBe('6037 9912 3456 7890')
  })

  it('re-groups a pasted number that already has spaces', async () => {
    await render()
    await openForm()

    type('#bank-card', '6037 9912 3456 7890')

    expect(valueOf('#bank-card')).toBe('6037 9912 3456 7890')
  })

  it('accepts Persian digits and stores them as ASCII', async () => {
    await render()
    await openForm()

    type('#bank-card', '۶۰۳۷۹۹۱۲۳۴۵۶۷۸۹۰')

    expect(valueOf('#bank-card')).toBe('6037 9912 3456 7890')
  })

  it('refuses a seventeenth digit', async () => {
    await render()
    await openForm()

    type('#bank-card', '60379912345678901')

    expect(valueOf('#bank-card')).toBe('6037 9912 3456 7890')
  })

  it('names the bank once six digits are in', async () => {
    await render()
    await openForm()

    type('#bank-card', '603799')

    expect(container.querySelector('.bk-bank')?.textContent).toContain('ملی')
  })

  it('says nothing about a prefix it does not recognise', async () => {
    await render()
    await openForm()

    type('#bank-card', '0000001234567890')

    expect(container.querySelector('.bk-bank')).toBeNull()
  })
})

describe('BankAccounts — the IBAN', () => {
  it('keeps IR out of the input, so it cannot be deleted', async () => {
    await render()
    await openForm()

    // The prefix is rendered beside the field, never inside it.
    expect(valueOf('#bank-iban')).toBe('')
    expect(container.querySelector('.bk-iban-prefix')?.textContent).toBe('IR')
  })

  it('ignores an IR the user pastes in with the number', async () => {
    await render()
    await openForm()

    type('#bank-iban', 'IR123456789012345678901234')

    expect(valueOf('#bank-iban')).toBe('1234 5678 9012 3456 7890 1234')
  })

  it('puts the IR back on when saving', async () => {
    await render()
    await openForm()
    await act(async () => fillValid())

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ui-sheet-footer .ui-btn')!.click()
    })

    expect(mocks.api).toHaveBeenCalledWith(
      '/wallet/bank-accounts',
      expect.objectContaining({
        body: JSON.stringify({
          holder_name: 'Sara Mohammadi',
          card_number: '6037991234567890',
          iban: 'IR123456789012345678901234',
        }),
      }),
    )
  })
})

describe('BankAccounts — saving', () => {
  it('stays disabled until every field is complete', async () => {
    await render()
    await openForm()
    const save = () => container.querySelector<HTMLButtonElement>('.ui-sheet-footer .ui-btn')!

    expect(save().disabled).toBe(true)

    await act(async () => {
      type('#bank-holder', 'Sara Mohammadi')
      type('#bank-card', '6037991234567890')
    })
    // The IBAN is still missing.
    expect(save().disabled).toBe(true)

    await act(async () => type('#bank-iban', '123456789012345678901234'))
    expect(save().disabled).toBe(false)
  })

  it('flags a half-typed card, but not an untouched one', async () => {
    await render()
    await openForm()
    expect(container.querySelector('.ui-field-invalid')).toBeNull()

    await act(async () => type('#bank-card', '60379912'))

    expect(container.querySelector('#bank-card')?.getAttribute('aria-invalid')).toBe('true')
  })

  it('shows a saved card by its last four digits only', async () => {
    mocks.bankAccounts.mockResolvedValue([
      {
        id: 1,
        holder_name: 'Sara Mohammadi',
        card_number: '6037991234567890',
        iban: 'IR123456789012345678901234',
      },
    ])

    await render()

    expect(container.querySelector('.bk-card-number')?.textContent).toContain('7890')
    // The rest of the number is not on screen.
    expect(container.querySelector('.bk-card-number')?.textContent).not.toContain('6037')
    expect(container.querySelector('.bk-card-bank')?.textContent).toContain('ملی')
  })
})
