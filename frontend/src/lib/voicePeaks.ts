/**
 * A voice note's loudness, reduced to the bars its player draws.
 *
 * Kept apart from VoiceNote.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/**
 * The loudness of the recording, reduced to a handful of bars.
 *
 * Decodes the audio once and takes the peak of each slice, then scales so
 * the loudest bar is full height. Scaling to this note's own loudest point
 * rather than to an absolute level is what makes a quiet speaker's note
 * still show its shape instead of a flat line.
 */
export async function readPeaks(src: string, bars: number): Promise<number[]> {
  const response = await fetch(src)
  const data = await response.arrayBuffer()
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const context = new Context()
  try {
    const audio = await context.decodeAudioData(data)
    return peaksOf(audio.getChannelData(0), bars)
  } finally {
    void context.close()
  }
}

/** Split into slices and keep each slice's loudest sample. Separate from
 *  the decoding so it can be tested without a browser's audio engine. */
export function peaksOf(samples: Float32Array, bars: number): number[] {
  const slice = Math.max(1, Math.floor(samples.length / bars))
  const peaks: number[] = []
  for (let bar = 0; bar < bars; bar += 1) {
    let loudest = 0
    const end = Math.min(samples.length, (bar + 1) * slice)
    for (let index = bar * slice; index < end; index += 1) {
      const value = Math.abs(samples[index])
      if (value > loudest) loudest = value
    }
    peaks.push(loudest)
  }
  const top = Math.max(...peaks, 0.0001)
  return peaks.map((value) => value / top)
}
