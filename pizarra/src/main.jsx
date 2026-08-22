import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted fonts, only the weights the app actually renders.
// Each file carries unicode-range subsets, so the browser fetches just the
// ones the page needs.
import '@fontsource/fraunces/500.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/caveat/600.css'

import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
