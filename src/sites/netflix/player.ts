import { PLAYER_ROOT } from './dom'

// videoId 取自 /watch/<id>
export function getVideoId(): string | null {
  const m = location.pathname.match(/\/watch\/(\d+)/)
  return m ? m[1] : null
}

export function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video')
}

// 播放器根容器（用作 anchor）。
export function getPlayerRoot(): HTMLElement | null {
  return (document.querySelector(PLAYER_ROOT) as HTMLElement | null)
    ?? (getVideoElement()?.parentElement ?? null)
}
