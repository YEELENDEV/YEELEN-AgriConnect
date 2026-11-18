import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './i18n'
import { LocaleProvider } from './lib/locale.jsx'
import App from './App.jsx'
import DevisPublicView from './components/DevisPublicView.jsx'
import DefinirMotDePasse from './components/DefinirMotDePasse.jsx'

// Lien public envoyé par email (voir server/src/routes/devis.js POST /:id/envoyer,
// lienConsultation = `${FRONTEND_URL}/devis/${token}`) — rendu à part de <App/>, jamais
// à l'intérieur : ce visiteur n'est pas authentifié et App() a des dizaines de hooks
// dépendant d'un utilisateur connecté (règle des hooks React : leur nombre/ordre doit
// rester identique à chaque rendu, donc un simple `if` dans App() qui les court-circuiterait
// casserait dès que ce même montage naviguerait ailleurs).
function Root() {
  const match = window.location.pathname.match(/^\/devis\/([^/]+)$/);
  if (match) return <DevisPublicView token={match[1]} />;
  // Liens d'activation / réinitialisation envoyés par email (lot 2a, voir utils/jetonsCompte.js).
  if (window.location.pathname === '/activer-compte') return <DefinirMotDePasse objet="activation" />;
  if (window.location.pathname === '/reinitialiser-mot-de-passe') return <DefinirMotDePasse objet="reinitialisation" />;
  return <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <LocaleProvider>
        <Root />
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>,
)
