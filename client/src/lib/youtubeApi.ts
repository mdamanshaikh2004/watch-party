const SCRIPT_ID = 'youtube-iframe-api'
const SCRIPT_SRC = 'https://www.youtube.com/iframe_api'

/**
 * onError codes. Deliberately separate from the onStateChange codes: both use small
 * integers with different meanings, so error 2 and state 2 must never share a table.
 * 101 and 150 are the same condition — 150 is what 101 reports from some embeds.
 */
const PLAYER_ERROR_MEANINGS: Record<number, string> = {
  2: 'The video id was rejected as invalid.',
  5: 'The video cannot be played in an HTML5 player.',
  100: 'That video has been removed, or is private.',
  101: 'The owner of that video does not allow it to be embedded.',
  150: 'The owner of that video does not allow it to be embedded.',
}

export function describePlayerError(code: number): string {
  return PLAYER_ERROR_MEANINGS[code] ?? `The player reported an unknown error (${code}).`
}

/**
 * Module-level cache of the in-flight load. Every player asks for the API and React
 * StrictMode mounts each of them twice, but the script tag and the global ready
 * callback must be set up exactly once — a second script tag would overwrite
 * window.onYouTubeIframeAPIReady and the first waiter would never resolve.
 */
let apiPromise: Promise<typeof YT> | null = null

export function loadYouTubeApi(): Promise<typeof YT> {
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    // window.YT can exist while YT.Player is still undefined, so check the constructor.
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }

    // The API invokes this global once, after the script has finished evaluating.
    window.onYouTubeIframeAPIReady = () => resolve(window.YT as typeof YT)

    if (document.getElementById(SCRIPT_ID)) return

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = SCRIPT_SRC
    script.async = true
    script.onerror = () => {
      // Let a later attempt retry instead of leaving every caller hanging forever.
      apiPromise = null
      reject(new Error('Could not load the YouTube IFrame API.'))
    }
    document.head.appendChild(script)
  })

  return apiPromise
}
