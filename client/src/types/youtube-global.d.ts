// @types/youtube declares the YT namespace but not how the API announces itself on
// window, which is the part we actually have to wait for.
declare global {
  interface Window {
    YT?: typeof YT
    onYouTubeIframeAPIReady?: () => void
  }
}

export {}
