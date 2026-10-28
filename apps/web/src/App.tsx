import { BrowserRouter, Route, Routes } from 'react-router'
import { Shell } from './components/ui'
import { FavoritesPage } from './pages/Favorites'
import { ImportPage } from './pages/Import'
import { LandingPage } from './pages/Landing'
import { LibraryPage } from './pages/Library'
import { ReviewPage } from './pages/Review'
import { TagReviewPage } from './pages/TagReview'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/import/review" element={<ReviewPage />} />
          <Route path="/import/favorites" element={<FavoritesPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/review/tags" element={<TagReviewPage />} />
          <Route path="*" element={<LandingPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
