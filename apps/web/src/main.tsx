import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/400-italic.css'
import '@fontsource/fraunces/600.css'
import { App } from './App'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing root element')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
