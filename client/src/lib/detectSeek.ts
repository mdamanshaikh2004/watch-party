/**
 * How far the reported position may differ from the expected one before it counts as
 * a seek. Comfortably above buffering stalls and background-tab timer throttling,
 * comfortably below any jump a person would make on purpose.
 */
const SEEK_TOLERANCE_S = 1.0

interface Sample {
  previousTime: number
  currentTime: number
  elapsedMs: number
  isPlaying: boolean
}

/**
 * The YouTube API has no seek event, so a seek can only be inferred: between two
 * polls a playing video should advance by exactly the wall time that passed, and a
 * paused one should not move at all. Anything else is someone scrubbing.
 *
 * Backwards jumps count too — that is how a replay after the video ends is caught.
 */
export function describeSeek({ previousTime, currentTime, elapsedMs, isPlaying }: Sample): boolean {
  const expected = isPlaying ? previousTime + elapsedMs / 1000 : previousTime
  return Math.abs(currentTime - expected) > SEEK_TOLERANCE_S
}
