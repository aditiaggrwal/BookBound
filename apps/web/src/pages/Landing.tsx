import { Link } from 'react-router'
import { Card } from '../components/ui'

const steps = [
  'Open Goodreads and go to My Books.',
  'Choose Import and export.',
  'Choose Export Library and save the CSV.',
  'Drop that file here. BookBound reads it in the browser. The file itself is not stored.',
]

export function LandingPage() {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="pt-4">
        <p className="font-serif text-sm italic text-amber">A map of your reading, drawn from the books you loved</p>
        <h1 className="mt-4 max-w-xl font-serif text-5xl leading-tight text-cream">Every book leads somewhere.</h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
          BookBound reads a Goodreads library and writes down how each book feels, how it is written, and what it is about.
          Those notes are how a later map can point to a next book you would not have picked, and say why.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/import" className="inline-flex min-h-11 items-center rounded-full bg-amber px-5 py-2 text-sm font-medium text-ink no-underline">
            Upload your Goodreads export
          </Link>
          <Link to="/import/favorites?from=cold" className="inline-flex min-h-11 items-center rounded-full border border-line px-5 py-2 text-sm text-cream no-underline">
            Start from three books you love
          </Link>
        </div>
        <Card className="mt-10">
          <h2 className="font-serif text-2xl">Export your library</h2>
          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="font-serif text-amber">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Card>
        <p className="mt-8 font-serif text-lg italic text-muted">Good books lead to great places.</p>
      </div>
      <figure className="overflow-hidden rounded-2xl border border-line bg-raised shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <img
          src="/example-map.jpg"
          alt="Illustrated night map of islands labeled with reading themes, the BookBound example atlas."
          className="block w-full"
        />
        <figcaption className="px-4 py-3 font-serif text-sm italic text-muted">
          An example atlas. Yours is drawn from the books you have actually read. The map itself comes after the tags are trustworthy.
        </figcaption>
      </figure>
    </div>
  )
}
