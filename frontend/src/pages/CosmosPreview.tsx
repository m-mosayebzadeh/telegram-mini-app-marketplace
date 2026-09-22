import { useState } from 'react'
import { Orb } from '../components/cosmos/Orb'
import { SpaceGround, seededRandom } from '../components/cosmos/SpaceGround'

/**
 * A page for looking at the foundation, not a product screen.
 *
 * It exists because the only honest way to judge this is on a real phone:
 * how big an orb reads at arm's length, whether the glow says "trusted"
 * without a caption, whether a field of them feels like a sky or like
 * wallpaper. None of that can be decided from a description.
 *
 * Deletable the day the real sky exists.
 */

const FONT_PAIRS = [
  { fa: "'Vazirmatn'", en: "'Sora'", label: 'وزیرمتن + Sora' },
  { fa: "'Noto Kufi Arabic'", en: "'Outfit'", label: 'کوفی + Outfit' },
  { fa: "'Vazirmatn'", en: "'Space Grotesk'", label: 'وزیرمتن + Space Grotesk' },
]

const NAMES = ['سارا', 'علی', 'نیما', 'مریم', 'رضا', 'لیلا', 'حسن', 'نگار', 'امیر', 'شیما']

export default function CosmosPreview() {
  const [pair, setPair] = useState(0)
  const [showNew, setShowNew] = useState(true)

  const font = FONT_PAIRS[pair]
  const people = buildPeople(showNew)

  return (
    <div
      className="cos-screen"
      style={
        {
          '--cos-font-fa': `${font.fa}, 'Segoe UI', Tahoma, system-ui, sans-serif`,
          '--cos-font-en': `${font.en}, ${font.fa}, system-ui, sans-serif`,
          overflowY: 'auto',
          touchAction: 'auto',
        } as React.CSSProperties
      }
    >
      <SpaceGround />

      <div style={{ position: 'relative', padding: '28px 18px 60px' }}>
        <h1 style={{ font: '300 22px/1.6 inherit', margin: '0 0 4px' }}>پایه‌ی دیداری جهان</h1>
        <p style={{ color: 'var(--cos-fg-soft)', margin: '0 0 22px', fontSize: 14 }}>
          اندازه یعنی حضور، درخشش یعنی اعتماد، حلقه یعنی همین الان آنلاین. پول هیچ نشانه‌ای
          ندارد.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 26 }}>
          {FONT_PAIRS.map((option, index) => (
            <button
              key={option.label}
              onClick={() => setPair(index)}
              style={chipStyle(index === pair)}
            >
              {option.label}
            </button>
          ))}
          <button onClick={() => setShowNew((value) => !value)} style={chipStyle(showNew)}>
            تازه‌واردها
          </button>
        </div>

        {/* A field, so they can be judged against each other rather than
            one at a time — which is the only way size and glow mean
            anything. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 4,
            marginBottom: 34,
          }}
        >
          {people.map((person) => (
            <div key={person.id} style={{ textAlign: 'center' }}>
              <Orb
                initial={person.initial}
                presence={person.presence}
                trust={person.trust}
                online={person.online}
                isNew={person.isNew}
                seed={person.id}
                driftSeconds={person.driftSeconds}
                driftDelaySeconds={person.driftDelay}
              />
              <div className="cos-orb-name" style={{ marginTop: -14, fontSize: 12 }}>
                {person.name}
              </div>
            </div>
          ))}
        </div>

        <Scale />
      </div>
    </div>
  )
}

/** The same orb at the extremes of each meaning, side by side, so the
 *  range can be judged rather than guessed. */
function Scale() {
  const rows: Array<[string, React.ReactNode]> = [
    [
      'حضور: کم تا زیاد',
      <>
        <Orb initial="ا" presence={0} trust={0.3} seed={1} />
        <Orb initial="ا" presence={0.5} trust={0.3} seed={1} />
        <Orb initial="ا" presence={1} trust={0.3} seed={1} />
      </>,
    ],
    [
      'اعتماد: تازه تا باسابقه',
      <>
        <Orb initial="ب" presence={0.6} trust={0} seed={2} />
        <Orb initial="ب" presence={0.6} trust={0.6} seed={2} />
        <Orb initial="ب" presence={0.6} trust={1} seed={2} />
      </>,
    ],
    [
      'آنلاین، و تازه‌وارد',
      <>
        <Orb initial="پ" presence={0.6} trust={0.5} seed={3} online />
        <Orb initial="" presence={0.5} trust={0} seed={4} isNew />
      </>,
    ],
  ]

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {rows.map(([label, content]) => (
        <div key={label}>
          <div style={{ color: 'var(--cos-fg-faint)', fontSize: 12, marginBottom: 2 }}>
            {label}
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>{content}</div>
        </div>
      ))}
    </div>
  )
}

function buildPeople(includeNew: boolean) {
  const random = seededRandom(11)
  return Array.from({ length: 14 }, (_, index) => {
    const name = NAMES[index % NAMES.length]
    const isNew = includeNew && index % 7 === 3
    return {
      id: index,
      name,
      initial: name[0],
      // Presence is skewed low on purpose: most people, most of the time,
      // are not especially active, and a sky where everyone is large says
      // nothing.
      presence: isNew ? 0.25 : Math.pow(random(), 1.5),
      trust: isNew ? 0 : random(),
      online: random() < 0.42,
      isNew,
      driftSeconds: 10 + random() * 9,
      driftDelay: random() * 16,
    }
  })
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '7px 13px',
    borderRadius: 999,
    border: `1px solid ${active ? 'rgb(242 176 106 / 70%)' : 'rgb(233 242 240 / 18%)'}`,
    background: active ? 'rgb(242 176 106 / 12%)' : 'transparent',
    color: active ? 'var(--cos-warm)' : 'var(--cos-fg-soft)',
    font: 'inherit',
    fontSize: 13,
  }
}
