import type { Cue, VideoContext } from '../types'

export interface SiteAdapter {
  detectVideo(): VideoContext | null
  onSubtitleTrack(cb: (cues: Cue[], ctx: VideoContext) => void): void
  getPlayerTime(): number
  getVideoElement(): HTMLVideoElement | null
}
