import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconMic, IconPause, IconPlay } from '../icons'

interface VoicePlayerProps {
  /** The recording's own bytes. null for a voice message from before
   *  real audio existed — there is nothing to play, so nothing offers
   *  to. */
  src: string | null
  durationSeconds: number | null
}

/**
 * Playing a voice message.
 *
 * The bubble used to show a microphone, a drawn waveform and a length,
 * and none of it did anything: the recording was simulated and only its
 * duration was ever stored. Everything here is now attached to real
 * audio, and where there is no audio the play control is not drawn at
 * all rather than offered and refused.
 *
 * The progress line fills as it plays. It is the one place a moving
 * element belongs on this screen, because something is actually moving.
 */
export function VoicePlayer({ src, durationSeconds }: VoicePlayerProps) {
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)

  const total = durationSeconds ?? 0

  useEffect(() => {
    // Leaving the conversation must not leave audio playing behind it.
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      void audio.play()
    }
  }

  const elapsed = playing || position > 0 ? position : total
  const progress = total > 0 ? Math.min(100, (position / total) * 100) : 0

  return (
    <span className="cm-voice">
      {src ? (
        <>
          <button
            type="button"
            className="cm-voice-play"
            onClick={toggle}
            aria-label={t(playing ? 'chatSession.voicePause' : 'chatSession.voicePlay')}
          >
            {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
          </button>

          <span className="cm-voice-track" aria-hidden="true">
            <span className="cm-voice-fill" style={{ inlineSize: `${progress}%` }} />
          </span>

          {/* Counts up while playing and shows the full length at rest —
              the same behaviour every voice message in every messenger
              has, and the reason a bare duration felt inert. */}
          <span className="cm-voice-time tabular">
            {t('chatSession.seconds', { seconds: Math.round(elapsed) })}
          </span>

          <audio
            ref={audioRef}
            src={src}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onEnded={() => {
              setPlaying(false)
              setPosition(0)
            }}
          />
        </>
      ) : (
        <>
          <span className="cm-attachment-icon">
            <IconMic size={16} />
          </span>
          <span className="tabular">{t('chatSession.seconds', { seconds: total })}</span>
        </>
      )}
    </span>
  )
}
