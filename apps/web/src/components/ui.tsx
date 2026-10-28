import { useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router'

export function Shell() {
  return (
    <div className="min-h-screen">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-full focus:bg-amber focus:px-4 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
        <Link to="/" className="flex items-center gap-3 text-cream no-underline">
          <Compass />
          <span>
            <span className="block font-serif text-xl leading-none">BookBound</span>
            <span className="mt-1 block font-serif text-sm italic text-muted">Every book leads somewhere.</span>
          </span>
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          <NavLink to="/library" className="text-muted no-underline hover:text-cream">
            Library
          </NavLink>
          <NavLink to="/review/tags" className="text-muted no-underline hover:text-cream">
            Tag review
          </NavLink>
        </nav>
      </header>
      <main id="content" className="mx-auto max-w-6xl px-5 pb-16">
        <Outlet />
      </main>
    </div>
  )
}

export function Compass() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" className="shrink-0">
      <circle cx="18" cy="18" r="16" fill="#121b2e" stroke="#e2a85a" strokeWidth="1.4" />
      <path d="M18 6 L21 18 L18 30 L15 18 Z" fill="#e2a85a" />
      <path d="M6 18 L18 15 L30 18 L18 21 Z" fill="#d5cbe2" opacity="0.85" />
      <circle cx="18" cy="18" r="2" fill="#0c1424" />
    </svg>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-5 ${className}`}>{children}</section>
}

export function Button({
  children,
  type = 'button',
  onClick,
  disabled,
  tone = 'primary',
}: {
  children: ReactNode
  type?: 'button' | 'submit'
  onClick?: () => void
  disabled?: boolean
  tone?: 'primary' | 'quiet'
}) {
  const styles =
    tone === 'primary'
      ? 'bg-amber text-ink hover:bg-amber-deep disabled:opacity-50'
      : 'border border-line bg-transparent text-cream hover:border-amber disabled:opacity-50'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center justify-center rounded-full px-5 py-2 text-sm font-medium ${styles}`}
    >
      {children}
    </button>
  )
}

export function Cover({ url, title }: { url: string | null; title: string }) {
  const [failed, setFailed] = useState(false)
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  if (!url || failed) return <Placeholder initials={initials} title={title} />
  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      className="h-20 w-14 rounded-md object-cover"
      onError={() => setFailed(true)}
    />
  )
}

function Placeholder({ initials, title }: { initials: string; title: string }) {
  return (
    <div className="flex h-20 w-14 items-center justify-center rounded-md bg-raised font-serif text-sm text-amber" aria-hidden="true" title={title}>
      {initials || 'Bk'}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  const styles = tone === 'error' ? 'border-amber text-cream' : 'border-line text-muted'
  return <p className={`rounded-2xl border px-4 py-3 text-sm ${styles}`}>{children}</p>
}

export function SkeletonRows() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="skeleton h-24" />
      ))}
    </div>
  )
}
