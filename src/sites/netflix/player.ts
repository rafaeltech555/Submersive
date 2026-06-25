import { SUBTITLE_CONTAINER, PLAYER_ROOT } from './dom'

// videoId 取自 /watch/<id>
export function getVideoId(): string | null {
  const m = location.pathname.match(/\/watch\/(\d+)/)
  return m ? m[1] : null
}

export function getContainer(): Element | null {
  return document.querySelector(SUBTITLE_CONTAINER)
}

export function getVideoElement(): HTMLVideoElement | null {
  return document.querySelector('video')
}

// Notice 的 anchor：播放器根容器（需為 positioned 祖先）。
export function getPlayerRoot(): HTMLElement | null {
  return (document.querySelector(PLAYER_ROOT) as HTMLElement | null)
    ?? (getVideoElement()?.parentElement ?? null)
}
