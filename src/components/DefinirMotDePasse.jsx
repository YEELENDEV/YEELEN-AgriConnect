// Lot 2a : page publique ouverte depuis un lien d'activation (compte salarié, 72 h) ou de
// réinitialisation (mot de passe oublié, 1 h). Rendue hors de <App/>, comme DevisPublicView
// (voir main.jsx) : le visiteur n'est pas connecté.
//
// Le jeton voyage dans le fragment (#jeton=…) et non dans le chemin ou la query : un fragment
// n'est jamais envoyé au serveur, donc il n'apparaît ni dans les journaux du reverse proxy ni
// dans l'en-tête Referer. On le lit une fois puis on l'efface de la barre d'adresse.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { definirMotDePasse } from '../lib/api.js';
import { Card, Button, Field } from './ui.jsx';
import { COLORS, RADIUS, TEXT, SPACE } from '../lib/theme.js';

// Lecture pure : l'effacement de la barre d'adresse se fait dans un effet. Effacer ici casserait
// la page sous StrictMode, qui appelle deux fois l'initialiseur de useState (le second appel ne
// trouverait plus de jeton).
function lireJeton() {
  const m = window.location.hash.match(/jeton=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Même règle que le serveur (utils/motDePasse.js) : vérifiée ici pour un retour immédiat,
// le serveur reste l'autorité.
export function regleMotDePasse(mdp) {
  return mdp.length >= 8 && /[A-Za-z]/.test(mdp) && /[0-9]/.test(mdp);
}

export default function DefinirMotDePasse({ objet }) {
  const { t } = useTranslation();
  const [jeton] = useState(lireJeton);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fait, setFait] = useState(null);
  const activation = objet === 'activation';
  useEffect(() => {
    if (jeton) window.history.replaceState(null, '', window.location.pathname);
  }, [jeton]);

  const envoyer = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!regleMotDePasse(password)) { setError(t('compte.regleMdp')); return; }
    if (password !== confirmation) { setError(t('compte.confirmationDiffere')); return; }
    setBusy(true);
    setError('');
    try {
      const res = await definirMotDePasse(jeton, password);
      setFait(res.email || true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const allerConnexion = () => window.location.assign('/');

  let contenu;
  if (!jeton) {
    contenu = (
      <div role="alert" style={{ display: 'flex', gap: SPACE.sm, alignItems: 'flex-start', fontSize: TEXT.base, color: COLORS.inkSoft }}>
        <AlertTriangle size={16} color={COLORS.red} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>{t('compte.lienAbsent')}</span>
      </div>
    );
  } else if (fait) {
    contenu = (
      <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
        <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'center', color: COLORS.green, fontWeight: 600 }}>
          <CheckCircle2 size={18} /> {activation ? t('compte.activeOk') : t('compte.reinitOk')}
        </div>
        {typeof fait === 'string' && <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('compte.connectezVous', { email: fait })}</div>}
        <Button variant="green" onClick={allerConnexion} style={{ justifyContent: 'center' }}>{t('compte.allerConnexion')}</Button>
      </div>
    );
  } else {
    contenu = (
      <form onSubmit={envoyer} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{activation ? t('compte.activationAide') : t('compte.reinitAide')}</div>
        <Field label={t('compte.nouveauMdp')} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required aide={t('compte.regleMdp')} />
        <Field label={t('compte.confirmerMdp')} type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required />
        {error && (
          <div role="alert" style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        <Button type="submit" variant="green" disabled={busy} style={{ justifyContent: 'center' }}>
          {busy ? <Loader2 size={15} className="spin" /> : <Lock size={14} />} {activation ? t('compte.activer') : t('compte.enregistrerMdp')}
        </Button>
      </form>
    );
  }

  return (
    <div style={{ minHeight: '100svh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px', background: COLORS.bg }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, color: COLORS.green, marginBottom: SPACE.md }}>YEELEN AgriConnect</div>
        <Card>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, margin: `0 0 ${SPACE.md}px` }}>
            {activation ? t('compte.activationTitre') : t('compte.reinitTitre')}
          </h1>
          {contenu}
        </Card>
      </div>
    </div>
  );
}
