// Lot 2a : affiché après la création d'un compte salarié (ou un « renvoyer un lien d'accès »).
// Plus aucun mot de passe ne circule : l'entreprise transmet un lien à usage unique (72 h) où le
// salarié choisit le sien. Le lien n'est montré qu'ici, une fois — le serveur ne garde que son
// empreinte et ne peut pas le réafficher ; en cas de perte, on en crée un nouveau.
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, MessageCircle, X } from 'lucide-react';
import { COLORS, RADIUS, SPACE, TEXT } from '../lib/theme.js';
import { normaliserNumeroWhatsapp, lienWhatsapp } from '../lib/whatsapp.js';

export default function LienAccesModal({ acces, salarie, onClose }) {
  const { t } = useTranslation();
  const [copie, setCopie] = useState(false);
  useEffect(() => {
    const surTouche = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onClose]);
  if (!acces) return null;

  const message = t('compte.lienMessage', { prenom: salarie?.prenom || '', lien: acces.lien });
  const numero = normaliserNumeroWhatsapp(salarie?.telephone);
  // Sans numéro international exploitable, wa.me sans destinataire laisse choisir le contact.
  const urlWhatsapp = numero.ok ? lienWhatsapp(numero.numero, message) : `https://wa.me/?text=${encodeURIComponent(message)}`;

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(acces.lien);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé) : le champ reste sélectionnable à la main.
    }
  };

  const bouton = { display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, padding: '8px 14px', borderRadius: RADIUS.control, border: `1px solid ${COLORS.border}`, background: '#fff', cursor: 'pointer', fontSize: TEXT.base, color: COLORS.ink, textDecoration: 'none' };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="lien-acces-titre" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: SPACE.lg }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: RADIUS.card, width: '100%', maxWidth: 520, padding: SPACE.xl }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.md }}>
          <div id="lien-acces-titre" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('compte.lienTitre')}</div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, display: 'flex' }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.md }}>
          {acces.emailEnvoye ? t('compte.lienEmailEnvoye', { email: acces.email }) : t('compte.lienEmailNonEnvoye', { email: acces.email })}
        </div>
        <input readOnly value={acces.lien} onFocus={e => e.target.select()} aria-label={t('compte.lienTitre')}
          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.control, fontSize: TEXT.sm, fontFamily: 'monospace', marginBottom: SPACE.md }} />
        <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap', marginBottom: SPACE.md }}>
          <button type="button" onClick={copier} style={bouton}>
            {copie ? <Check size={14} /> : <Copy size={14} />} {copie ? t('compte.lienCopie') : t('compte.lienCopier')}
          </button>
          <a href={urlWhatsapp} target="_blank" rel="noopener noreferrer" style={bouton}>
            <MessageCircle size={14} /> {t('compte.lienWhatsapp')}
          </a>
        </div>
        <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{t('compte.lienAvertissement')}</div>
      </div>
    </div>
  );
}
