import { YouTubeAdapter } from '../sites/youtube-adapter'
import { Overlay } from './overlay'

const site = new YouTubeAdapter()
const overlay = new Overlay(
  () => site.getPlayerTime(),
  () => document.querySelector('#movie_player') as HTMLElement | null,
)

site.onSubtitleTrack((cues) => {
  console.log('[dualsub] got cues', cues.length)
  overlay.setCues(cues)
  overlay.mount()
})

console.log('[dualsub] content ready')
