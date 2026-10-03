import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { readPeaks } from '../../lib/voicePeaks'

/**
 * A voice note you can actually listen to properly.
 *
 * The owner's bar for this was Telegram, and the three things that make a
 * voice note there feel finished rather than functional are all here:
 *
 * - **The shape of the voice itself.** The bars are the real loudness of
 *   this recording, worked out from the audio, not a decorative pattern.
 *   You can see where somebody paused, and where they laughed.
 * - **Moving through it.** Touch anywhere on the shape to jump there, or
 *   drag across it. A long voice note you can only play from the start is
 *   one you give up on halfway through.
 * - **Speed.** One, one and a half, two. The single feature people who
 *   listen to a lot of voice notes miss most when it is absent.
 *
 * The file is behind authentication, so it arrives as a local address the
 * parent owns; this component only reads it.
 */

/** How many bars the shape is drawn with. Enough to show pauses, few
 *  enough that each bar is still wider than a hairline on a small phone. */
const BARS = 36

/** The speeds, in the order a tap steps through them. */
const SPEEDS = [1, 1.5, 2] as const

interface VoiceNoteProps {
  src: string | null
  /** What the sender's device measured, used until the audio itself has
   *  loaded and can say for certain. */
  durationSeconds: number | null
  /** Your own notes sit on the warm side, and the shape takes that
   *  colour so the two are one thing rather than a grey widget inside a
   *  warm bubble. */
  mine?: boolean
}

export function VoiceNote({ src, durationSeconds, mine = false }: VoiceNoteProps) {
  const { t, i18n } = useTranslation()
  const audioRef = useRef<HTMLAudioElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(durationSeconds ?? 0)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const [peaks, setPeaks] = useState<number[] | null>(null)

  /** The real shape of the recording, worked out once from the file. */
  useEffect(() => {
    if (!src) return
    let cancelled = false
    readPeaks(src, BARS)
      .then((result) => {
        if (!cancelled) setPeaks(result)
      })
      // A shape that cannot be drawn is not a reason to refuse to play:
      // the note falls back to even bars and still works.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [src])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = speed
  }, [speed])

  function toggle() {
    const audio = audioRef.current
    if (!audio || !src) return
    if (audio.paused) {
      audio.playbackRate = speed
      void audio.play()
    } else {
      audio.pause()
    }
  }

  /** Jump to wherever this point on the shape is. Works the same for a
   *  tap and for every step of a drag, so both feel like one gesture. */
  function seekTo(clientX: number) {
    const audio = audioRef.current
    const track = trackRef.current
    if (!audio || !track || !duration) return
    const box = track.getBoundingClientRect()
    // Time runs left to right in every language. A voice note is a strip
    // of tape, not a line of text, and every messenger — Telegram and
    // WhatsApp included — keeps it left to right under Persian and Arabic.
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    audio.currentTime = share * duration
    setPosition(audio.currentTime)
  }

  const progress = duration ? position / duration : 0
  const shape = peaks ?? Array.from({ length: BARS }, () => 0.35)
  const shown = playing || position > 0 ? position : duration

  return (
    <div className={`cos-voice${mine ? ' is-mine' : ''}`}>
      <audio
        ref={audioRef}
        src={src ?? undefined}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const length = event.currentTarget.duration
          // Recordings from some browsers report Infinity until played;
          // the sender's own measurement is the better answer until then.
          if (Number.isFinite(length) && length > 0) setDuration(length)
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setPosition(0)
        }}
      />

      <button
        type="button"
        className="cos-voice-play"
        onClick={toggle}
        disabled={!src}
        aria-label={playing ? t('voice.pause') : t('voice.play')}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" />
            <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M8 5.2v13.6c0 .8.9 1.3 1.6.8l10.2-6.8a1 1 0 0 0 0-1.6L9.6 4.4C8.9 3.9 8 4.4 8 5.2Z" fill="currentColor" />
          </svg>
        )}
      </button>

      <div className="cos-voice-body">
        <div
          ref={trackRef}
          className="cos-voice-shape"
          role="slider"
          aria-label={t('voice.position')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            seekTo(event.clientX)
          }}
          onPointerMove={(event) => {
            if (event.buttons) seekTo(event.clientX)
          }}
          onKeyDown={(event) => {
            const audio = audioRef.current
            if (!audio) return
            if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
              const step = event.key === 'ArrowRight' ? 5 : -5
              audio.currentTime = Math.min(duration, Math.max(0, audio.currentTime + step))
            }
          }}
        >
          {shape.map((height, index) => (
            <i
              key={index}
              className={index / shape.length < progress ? 'is-played' : undefined}
              style={{ height: `${Math.max(12, Math.round(height * 100))}%` }}
            />
          ))}
        </div>

        <div className="cos-voice-meta">
          <span className="cos-voice-time">{clock(shown, i18n.language)}</span>
          <button
            type="button"
            className="cos-voice-speed"
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
            aria-label={t('voice.speed')}
          >
            {speed.toLocaleString(i18n.language)}×
          </button>
        </div>
      </div>
    </div>
  )
}

/** m:ss, in the reader's own digits. */
function clock(seconds: number, language: string): string {
  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  const digits = (value: number, pad = 1) =>
    value.toLocaleString(language, { minimumIntegerDigits: pad, useGrouping: false })
  return `${digits(minutes)}:${digits(rest, 2)}`
}
