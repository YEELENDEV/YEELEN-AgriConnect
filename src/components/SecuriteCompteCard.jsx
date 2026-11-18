// Lot 2a (S5) : carte « Mot de passe et sessions » de Mes préférences.
// Changer son mot de passe ferme toutes les autres sessions ; le bouton « Déconnecter mes autres
// appareils » fait la même chose sans changer le mot de passe (téléphone perdu, poste partagé).
// Dans les deux cas le serveur renvoie un nouveau jeton pour CET appareil, que l'API enregistre.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, KeyRound, LogOut } from 'lucide-react';
import { changerMotDePasse, deconnecterAutresAppareils } from '../lib/api.js';
import { Card, Button, Field } from './ui.jsx';
import { COLORS, RADIUS, TEXT, SPACE } from '../lib/theme.js';
import { regleMotDePasse } from './DefinirMotDePasse.jsx';

const VIDE = { actuel: '', nouveau: '', confirmation: '' };

export default function SecuriteCompteCard() {
  const { t } = useTranslation();
  const [form, setForm] = useState(VIDE);
  const [busy, setBusy] = useState(null); // 'mdp' | 'sessions' | null
  const [message, setMessage] = useState(null); // { type: 'ok' | 'erreur', texte }

  const changer = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!regleMotDePasse(form.nouveau)) return setMessage({ type: 'erreur', texte: t('compte.regleMdp') });
    if (form.nouveau !== form.confirmation) return setMessage({ type: 'erreur', texte: t('compte.confirmationDiffere') });
    setBusy('mdp');
    setMessage(null);
    try {
      await changerMotDePasse(form.actuel, form.nouveau);
      setForm(VIDE);
      setMessage({ type: 'ok', texte: t('compte.mdpChange') });
    } catch (err) {
      setMessage({ type: 'erreur', texte: err.message });
    } finally {
      setBusy(null);
    }
  };

  const deconnecter = async () => {
    if (busy || !window.confirm(t('compte.sessionsConfirmer'))) return;
    setBusy('sessions');
    setMessage(null);
    try {
      await deconnecterAutresAppareils();
      setMessage({ type: 'ok', texte: t('compte.sessionsFermees') });
    } catch (err) {
      setMessage({ type: 'erreur', texte: err.message });
    } finally {
      setBusy(null);
    }
  };

  const maj = (champ) => (e) => setForm({ ...form, [champ]: e.target.value });

  return (
    <Card>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
        {t('compte.carteTitre')}
      </div>
      <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.lg }}>{t('compte.carteAide')}</div>

      {message && (
        <div role={message.type === 'ok' ? 'status' : 'alert'} style={{
          background: message.type === 'ok' ? COLORS.greenSoft : COLORS.redSoft,
          color: message.type === 'ok' ? COLORS.green : COLORS.red,
          borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, marginBottom: SPACE.md,
        }}>
          {message.texte}
        </div>
      )}

      <form onSubmit={changer} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
        <Field label={t('compte.mdpActuel')} type="password" autoComplete="current-password" value={form.actuel} onChange={maj('actuel')} required />
        <Field label={t('compte.nouveauMdp')} type="password" autoComplete="new-password" value={form.nouveau} onChange={maj('nouveau')} required aide={t('compte.regleMdp')} />
        <Field label={t('compte.confirmerMdp')} type="password" autoComplete="new-password" value={form.confirmation} onChange={maj('confirmation')} required />
        <Button type="submit" variant="green" disabled={!!busy} style={{ alignSelf: 'flex-start' }}>
          {busy === 'mdp' ? <Loader2 size={15} className="spin" /> : <KeyRound size={14} />} {t('compte.changerMdp')}
        </Button>
      </form>

      <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: SPACE.lg, paddingTop: SPACE.md, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('compte.sessionsAide')}</div>
        <Button onClick={deconnecter} disabled={!!busy} style={{ alignSelf: 'flex-start' }}>
          {busy === 'sessions' ? <Loader2 size={15} className="spin" /> : <LogOut size={14} />} {t('compte.sessionsBouton')}
        </Button>
      </div>
    </Card>
  );
}
