import { useEffect, useRef, useState } from 'react'

const STAGE_RATIO = 6 / 5
const MAP_WIDTH = 704

const PLACES: Record<string, { top: number; left: number; width: number }> = {
  romance: { top: 2, left: 2, width: 22 },
  wonder: { top: 0, left: 30, width: 22 },
  'fog-north': { top: 6, left: 56, width: 13 },
  isolation: { top: 8, left: 76, width: 18 },
  longing: { top: 42, left: 0, width: 20 },
  home: { top: 44, left: 24, width: 18 },
  mystery: { top: 48, left: 48, width: 20 },
  dread: { top: 38, left: 74, width: 20 },
  history: { top: 68, left: 4, width: 16 },
  summer: { top: 66, left: 78, width: 16 },
  'fog-south': { top: 74, left: 30, width: 13 },
}

const FOGS = ['fog-north', 'fog-south'] as const

export type AtlasLand = {
  id: string
  name: string
  count: number
}

export function Atlas({
  lands,
  selectedId,
  onSelect,
  link,
}: {
  lands: AtlasLand[]
  selectedId: string | null
  onSelect: (id: string) => void
  link: { fromId: string; avoidId: string } | null
}) {
  const fogId = link ? fogFor(link.fromId, link.avoidId) : null
  const line = link && fogId ? pathBetween(link.fromId, fogId) : null
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const update = () => setScale(Math.min(1, el.clientWidth / MAP_WIDTH))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={frame} className="w-full">
      <div style={{ height: MAP_WIDTH * (5 / 6) * scale }}>
        <div style={{ width: MAP_WIDTH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div className="relative aspect-[6/5] overflow-hidden rounded-3xl border border-line bg-[#0c1424]">
        <img src="/atlas/sea.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        {line ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path d={line} fill="none" stroke="#e2a85a" strokeWidth="0.55" strokeDasharray="1.5 1.2" strokeLinecap="round" />
          </svg>
        ) : null}
        <ul className="absolute inset-0 m-0 list-none p-0">
          {lands.map((land) => (
            <Island
              key={land.id}
              id={land.id}
              name={land.name}
              count={land.count}
              selected={selectedId === land.id}
              onSelect={onSelect}
            />
          ))}
          {FOGS.map((id) => (
            <FogLand key={id} id={id} active={fogId === id} />
          ))}
        </ul>
            <Rose />
          </div>
        </div>
      </div>
    </div>
  )
}

function Island({
  id,
  name,
  count,
  selected,
  onSelect,
}: {
  id: string
  name: string
  count: number
  selected: boolean
  onSelect: (id: string) => void
}) {
  const place = placeFor(id)
  const label = count === 1 ? '1 book' : `${count} books`
  return (
    <li className="absolute" style={{ top: `${place.top}%`, left: `${place.left}%`, width: `${place.width}%` }}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(id)}
        className={`group relative block w-full ${selected ? 'z-20' : 'z-10'}`}
      >
        <img
          src={`/atlas/${id}.png`}
          alt=""
          className={`aspect-square w-full object-contain drop-shadow-[0_16px_16px_rgba(0,0,0,0.55)] transition duration-200 ${
            selected ? 'scale-105' : 'group-hover:scale-[1.03]'
          }`}
        />
        <span
          className={`absolute bottom-[6%] left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs shadow-[0_8px_20px_rgba(0,0,0,0.35)] ${
            selected ? 'border-amber bg-amber text-ink' : 'border-white/15 bg-[#121b2e]/90 text-cream'
          }`}
        >
          <span className="font-serif text-sm leading-none">{name}</span>
          <span className={selected ? 'text-ink/70' : 'text-muted'}>{label}</span>
        </span>
      </button>
    </li>
  )
}

function FogLand({ id, active }: { id: string; active: boolean }) {
  const place = placeFor(id)
  return (
    <li className="pointer-events-none absolute z-10" style={{ top: `${place.top}%`, left: `${place.left}%`, width: `${place.width}%` }}>
      <img
        src="/atlas/fog.png"
        alt=""
        className={`aspect-square w-full object-contain drop-shadow-[0_16px_16px_rgba(0,0,0,0.55)] ${active ? '' : 'opacity-80'}`}
      />
      <span className="absolute bottom-[4%] left-1/2 inline-flex -translate-x-1/2 flex-col items-center whitespace-nowrap rounded-2xl border border-white/15 bg-[#121b2e]/90 px-2.5 py-1 text-center text-[11px] leading-tight text-cream">
        The Unknown
        <span className="text-muted">???</span>
      </span>
    </li>
  )
}

function fogFor(fromId: string, avoidId: string) {
  const from = center(fromId)
  const avoid = center(avoidId)
  const ranked = FOGS.map((id) => {
    const spot = center(id)
    return {
      id,
      near: (spot.x - from.x) ** 2 + (spot.y - from.y) ** 2,
      away: (spot.x - avoid.x) ** 2 + (spot.y - avoid.y) ** 2,
    }
  }).sort((a, b) => a.near - b.near)
  const [nearest, other] = ranked
  return nearest.away < 900 ? other.id : nearest.id
}

function placeFor(id: string) {
  return PLACES[id] ?? { top: 70, left: 40, width: 16 }
}

function pathBetween(fromId: string, toId: string | null): string | null {
  if (!toId) return null
  const start = edgeToward(fromId, toId)
  const end = edgeToward(toId, fromId)
  if (!start || !end) return null
  const midY = (start.y + end.y) / 2
  const bow = Math.min(14, Math.hypot(end.x - start.x, end.y - start.y) * 0.2)
  const bend = midY < 48 ? bow : -bow
  const cx = (start.x + end.x) / 2
  const cy = midY + bend
  return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`
}

function edgeToward(fromId: string, toId: string): { x: number; y: number } | null {
  const from = center(fromId)
  const to = center(toId)
  const place = placeFor(fromId)
  if (!from || !to || !place) return null
  const dx = to.x - from.x
  const dy = to.y - from.y
  const halfX = place.width / 2
  const halfY = (place.width * STAGE_RATIO) / 2
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfX / Math.abs(dx)
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfY / Math.abs(dy)
  const scale = Math.min(scaleX, scaleY) * 0.82
  return { x: from.x + dx * scale, y: from.y + dy * scale }
}

function center(id: string): { x: number; y: number } | null {
  const place = placeFor(id)
  return {
    x: place.left + place.width / 2,
    y: place.top + (place.width * STAGE_RATIO) / 2,
  }
}

function Rose() {
  return (
    <svg viewBox="0 0 80 80" aria-hidden="true" className="pointer-events-none absolute bottom-4 right-4 h-16 w-16 opacity-80">
      <circle cx="40" cy="40" r="30" fill="#121b2e" fillOpacity="0.72" stroke="#e2a85a" strokeWidth="1.2" />
      <circle cx="40" cy="40" r="4" fill="#e2a85a" />
      <path d="M40 14 L44 36 L40 32 L36 36 Z" fill="#f6efe2" />
      <path d="M40 66 L36 44 L40 48 L44 44 Z" fill="#8ea0b8" />
      <path d="M14 40 L36 36 L32 40 L36 44 Z" fill="#8ea0b8" />
      <path d="M66 40 L44 44 L48 40 L44 36 Z" fill="#8ea0b8" />
      <text x="40" y="12" textAnchor="middle" fill="#f6efe2" fontSize="7" fontFamily="serif">
        N
      </text>
    </svg>
  )
}
