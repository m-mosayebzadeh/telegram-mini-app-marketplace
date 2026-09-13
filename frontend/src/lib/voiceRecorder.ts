/**
 * Recording a voice message, for real.
 *
 * It used to be simulated: the mic button started a timer and what got
 * "sent" was that number of seconds. The recipient saw a bubble saying
 * "8 seconds" with no way to hear the eight seconds — a control that
 * looked like a feature and was not one.
 *
 * MediaRecorder is the browser's own API for this and is available in
 * Telegram's webview, Safari and Chrome. The one thing it is not
 * consistent about is the container it produces, so the type is picked
 * from what the browser actually says it supports rather than assumed.
 */

/** In preference order. webm/opus everywhere except Safari, which does
 *  mp4; the first one the browser admits to is the one used. */
const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
}

/** Whether recording is possible at all here. A desktop browser with no
 *  microphone, an insecure origin, or an old webview all answer no — and
 *  the composer hides the button rather than offering one that fails. */
export function canRecordVoice(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

export interface VoiceRecording {
  file: File
  /** An object URL for local playback of what was just recorded. The
   *  caller owns it and must revoke it when the message is gone. */
  url: string
  /** Whole seconds, at least 1 — a recording the user perceives as
   *  instant is still a real recording and must not round to zero. */
  durationSeconds: number
}

export interface VoiceSession {
  /** Resolves with the recording, or null if it was cancelled. Always
   *  releases the microphone either way. */
  stop: () => Promise<VoiceRecording | null>
  cancel: () => void
}

/**
 * Asks for the microphone and starts recording.
 *
 * Throws if permission is refused, which the caller surfaces — a silent
 * failure here would leave someone tapping a button that does nothing.
 */
export async function startVoiceRecording(): Promise<VoiceSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = pickMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []
  const startedAt = Date.now()
  let cancelled = false

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.start()

  /** The microphone stays on until every track is stopped — on a phone
   *  that is also what takes the recording indicator away. */
  function release() {
    for (const track of stream.getTracks()) track.stop()
  }

  return {
    cancel() {
      cancelled = true
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },

    stop() {
      return new Promise<VoiceRecording | null>((resolve) => {
        if (cancelled || recorder.state === 'inactive') {
          release()
          resolve(null)
          return
        }
        recorder.onstop = () => {
          release()
          if (cancelled) {
            resolve(null)
            return
          }
          const type = recorder.mimeType || mimeType || 'audio/webm'
          const blob = new Blob(chunks, { type })
          const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
          resolve({
            file: new File([blob], `voice-${startedAt}.${extension}`, { type }),
            url: URL.createObjectURL(blob),
            durationSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
          })
        }
        recorder.stop()
      })
    },
  }
}
