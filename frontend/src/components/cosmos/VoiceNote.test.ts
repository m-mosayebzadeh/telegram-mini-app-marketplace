import { describe, it, expect } from 'vitest'
import { peaksOf } from './VoiceNote'

/**
 * The shape of a voice note is the real loudness of the recording. What is
 * worth protecting is that it actually SHOWS the voice: pauses as pauses,
 * and a quiet speaker as a shape rather than a flat line.
 */
describe('the shape of a voice note', () => {
  it('shows a pause as a pause', () => {
    // Half silence, then half speech.
    const samples = new Float32Array(1000)
    for (let index = 500; index < 1000; index += 1) samples[index] = 0.5
    const bars = peaksOf(samples, 10)
    expect(bars.slice(0, 5).every((bar) => bar === 0)).toBe(true)
    expect(bars.slice(5).every((bar) => bar === 1)).toBe(true)
  })

  it('scales to the note own loudest point, so a quiet voice still has a shape', () => {
    // Nothing louder than a whisper anywhere in it.
    const samples = new Float32Array(100)
    samples[10] = 0.02
    samples[90] = 0.01
    const bars = peaksOf(samples, 10)
    expect(Math.max(...bars)).toBe(1)
    expect(bars[9]).toBeCloseTo(0.5, 5)
  })

  it('always gives exactly the number of bars asked for', () => {
    expect(peaksOf(new Float32Array(37), 36)).toHaveLength(36)
  })

  it('reads a sample below zero as loud, not as silence', () => {
    // Sound is a wave; the trough is as loud as the crest.
    const samples = new Float32Array(10)
    samples[3] = -0.8
    expect(Math.max(...peaksOf(samples, 1))).toBe(1)
  })
})
