import { SpaceGround } from '../components/cosmos/SpaceGround'
import { ECHO_OPTIONS } from '../components/cosmos/echoIcons'

/**
 * Four candidate Echo marks, at the two sizes that decide the question.
 *
 * Not a product screen. It exists because an icon cannot be judged from a
 * description or at 200px: what matters is whether it still reads at 26px
 * inside a dark circle on a phone held at arm's length, which is the only
 * place it will ever actually be seen.
 *
 * Deletable the moment one of them is chosen.
 */
export default function EchoIcons() {
  return (
    <div className="cos-screen cos-icons">
      <SpaceGround />
      <div className="cos-icons-body">
        <p className="cos-icons-note">
          بالا همان اندازه‌ای است که در منو دیده می‌شود. پایین بزرگ، فقط برای دیدن جزئیات.
        </p>

        {ECHO_OPTIONS.map(({ id, Icon, idea }) => (
          <section key={id} className="cos-icons-row">
            <span className="cos-icons-id cos-en">{id}</span>

            {/* Exactly as it appears in Sol's system: the real size, in a
                real body, unlit and then lit. */}
            <span className="cos-icons-pair">
              <span className="cos-icons-body-dark">
                <Icon size={26} />
              </span>
              <span className="cos-icons-body-lit">
                <Icon size={26} />
              </span>
            </span>

            <span className="cos-icons-big">
              <Icon size={64} />
            </span>

            <span className="cos-icons-idea">{idea}</span>
          </section>
        ))}
      </div>
    </div>
  )
}
