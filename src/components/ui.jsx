import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Check, HelpCircle } from 'lucide-react';
import { COLORS, RADIUS, TEXT, SPACE } from '../lib/theme.js';

let toastListeners = [];
function notify(message, type = 'error') {
  const toast = { id: `${Date.now()}-${Math.random()}`, message, type };
  toastListeners.forEach(fn => fn(toast));
}

export function notifyError(err, fallback = 'Une erreur est survenue.') {
  notify((err && err.message) || fallback, 'error');
}

export function notifySuccess(message) {
  notify(message, 'success');
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (toast) => {
      setToasts(prev => [...prev, toast]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, 5000);
    };
    toastListeners.push(handler);
    return () => { toastListeners = toastListeners.filter(l => l !== handler); };
  }, []);

  const dismiss = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: SPACE.sm, maxWidth: 340
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'error' ? COLORS.redSoft : COLORS.greenSoft,
          color: t.type === 'error' ? COLORS.red : COLORS.green,
          borderRadius: RADIUS.card, padding: '11px 14px',
          fontSize: TEXT.base, fontWeight: 500, display: 'flex', alignItems: 'flex-start', gap: SPACE.sm,
          boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
        }}>
          {t.type === 'error' ? <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : <Check size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span style={{ flex: 1 }}>{t.message}</span>
          <button onClick={() => dismiss(t.id)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.8, padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

export function Card({ children, style, ...rest }) {
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${COLORS.border}`,
      borderRadius: RADIUS.card, padding: '18px 20px', ...style
    }} {...rest}>
      {children}
    </div>
  );
}

// Enveloppe systématiquement .data-table dans un conteneur overflow-x: auto —
// sans ça, un tableau plus large que son Card fait grandir toute la page au lieu
// de défiler dans son propre cadre (constaté sur plusieurs modules, pas un cas isolé).
// Passer ici plutôt que de rajouter le wrapper à chaque site d'appel garantit que
// tout futur tableau utilisant ce composant est protégé automatiquement.
export function DataTable({ children, style, wrapperStyle, ...rest }) {
  return (
    <div style={{ overflowX: 'auto', ...wrapperStyle }}>
      <table className="data-table" style={style} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Button({ children, onClick, variant = 'default', small, style, type = 'button', disabled, ...rest }) {
  const base = {
    // `small` ne joue plus sur la taille du texte (13 contre 14 px : un pixel, invisible), mais
    // sur la seule chose qui distinguait vraiment les deux tailles de bouton — le rembourrage.
    fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: TEXT.base,
    padding: small ? '6px 12px' : '8px 16px', borderRadius: RADIUS.control, cursor: disabled ? 'not-allowed' : 'pointer',
    border: '1px solid transparent', display: 'inline-flex', alignItems: 'center', gap: SPACE.sm,
    transition: 'transform 0.1s ease, opacity 0.15s ease', opacity: disabled ? 0.5 : 1,
  };
  const variants = {
    default: { background: COLORS.ink, color: '#fff' },
    outline: { background: 'transparent', color: COLORS.ink, borderColor: COLORS.border },
    green: { background: COLORS.green, color: '#fff' },
    ochre: { background: COLORS.ochre, color: '#fff' },
    danger: { background: 'transparent', color: COLORS.red, borderColor: COLORS.redSoft },
    ghost: { background: 'transparent', color: COLORS.inkSoft },
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick} style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {children}
    </button>
  );
}

// Icône « ? » cliquable à côté d'un libellé de champ, ouvrant une petite bulle
// d'explication. Ouverture au CLIC (pas au survol) pour rester utilisable au toucher —
// l'attribut title= natif ne s'affiche jamais sur mobile. Une seule bulle ouverte à la
// fois dans toute l'app (via un évènement window partagé). Fond + couleur fixés
// explicitement : un élément sans `color` hérite du blanc sous un thème sombre OS
// (règle color-scheme déjà documentée pour les <input>/<button> bruts du projet).
let aideChampSeq = 0;
export function AideChamp({ texte }) {
  const [open, setOpen] = useState(false);
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = ++aideChampSeq;
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onOther = (e) => { if (e.detail !== idRef.current) setOpen(false); };
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('aidechamp:open', onOther);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('aidechamp:open', onOther);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(v => {
      const next = !v;
      if (next) window.dispatchEvent(new CustomEvent('aidechamp:open', { detail: idRef.current }));
      return next;
    });
  };

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button" onClick={toggle} aria-label="Aide sur ce champ"
        style={{
          background: 'transparent', border: 'none', padding: 0, marginLeft: SPACE.xs,
          cursor: 'pointer', color: open ? COLORS.green : COLORS.inkFaint, display: 'inline-flex',
        }}
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: -4, zIndex: 60,
            width: 'min(250px, 72vw)', background: COLORS.surface, color: COLORS.ink,
            border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: '10px 12px',
            fontSize: TEXT.sm, fontWeight: 400, lineHeight: 1.45, textAlign: 'left',
            boxShadow: '0 8px 24px rgba(0,0,0,0.16)', whiteSpace: 'normal',
          }}
        >
          <span style={{
            position: 'absolute', top: -5, left: 10, width: 9, height: 9,
            background: COLORS.surface, borderLeft: `1px solid ${COLORS.border}`, borderTop: `1px solid ${COLORS.border}`,
            transform: 'rotate(45deg)',
          }} />
          {texte}
        </span>
      )}
    </span>
  );
}

// Champ façon ERP (project_erp_contact_architecture) : plus de rectangle visible au
// repos (bordure/fond transparents, `.flat-input` dans App.css reproduit
// --o-input-border-color: transparent mesuré dans le CSS d'un ERP de référence), une bordure
// discrète apparaît seulement au survol/focus. Étendu à Field/Select eux-mêmes (au lieu
// d'un traitement au cas par cas par écran) sur demande explicite de l'utilisateur, pour
// que ce style s'applique automatiquement partout où ces deux composants partagés sont
// déjà utilisés (une centaine d'endroits dans l'app).
export function Field({ label, aide, className, style, ...props }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs, fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 500 }}>
      {(label || aide) && (
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>{label}{aide ? <AideChamp texte={aide} /> : null}</span>
      )}
      <input
        {...props}
        className={className ? `flat-input ${className}` : 'flat-input'}
        style={style}
      />
    </label>
  );
}

export function Select({ label, aide, children, className, style, ...props }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs, fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 500 }}>
      {(label || aide) && (
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>{label}{aide ? <AideChamp texte={aide} /> : null}</span>
      )}
      <select
        {...props}
        className={className ? `flat-input ${className}` : 'flat-input'}
        style={style}
      >
        {children}
      </select>
    </label>
  );
}

// Mention visible sous toute valeur issue d'une SIMULATION (aucun capteur réel n'est branché) :
// jauges d'humidité et de température des parcelles, ambiance du poulailler, qualité de l'eau
// des bassins. Sans elle, ces chiffres aléatoires se lisaient comme de vraies mesures — et un
// agriculteur pouvait décider d'irriguer, ou de ne pas le faire, sur cette base (audit D1).
export function MentionSimulation({ texte }) {
  return (
    <div role="note" style={{
      display: 'flex', alignItems: 'flex-start', gap: SPACE.sm,
      background: COLORS.ochreSoft, color: COLORS.ochre, borderRadius: RADIUS.control,
      padding: '6px 10px', fontSize: TEXT.sm, fontWeight: 500, lineHeight: 1.4,
    }}>
      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
      <span>{texte}</span>
    </div>
  );
}

export function Badge({ children, tone = 'green' }) {
  const map = {
    green: { bg: COLORS.greenSoft, fg: COLORS.green },
    ochre: { bg: COLORS.ochreSoft, fg: COLORS.ochre },
    blue: { bg: COLORS.blueSoft, fg: COLORS.blue },
    red: { bg: COLORS.redSoft, fg: COLORS.red },
  };
  const t = map[tone] || map.green;
  return (
    <span style={{
      background: t.bg, color: t.fg, fontSize: TEXT.xs, fontWeight: 600,
      padding: '3px 9px', borderRadius: RADIUS.pill, whiteSpace: 'nowrap'
    }}>
      {children}
    </span>
  );
}

export function GaugeDial({ value, max = 100, label, unit, colorMain, colorTrack, icon }) {
  const size = 108;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const offset = circumference * (1 - pct);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.sm }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colorTrack} strokeWidth={stroke} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={colorMain} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center'
        }}>
          {icon}
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: TEXT.md, color: COLORS.ink, marginTop: 2 }}>
            {Math.round(value)}{unit}
          </span>
        </div>
      </div>
      <span style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 500 }}>{label}</span>
    </div>
  );
}

export function MiniChart({ data, color, height = 110 }) {
  if (!data || data.length === 0) {
    return <div style={{ color: COLORS.inkSoft, fontSize: TEXT.base }}>Aucune donnée</div>;
  }
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: SPACE.sm, height, marginTop: SPACE.sm }}>
      {data.map((item, i) => (
        <div key={item.id != null ? item.id : `${item.label}-${i}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.sm }}>
          <div style={{ width: '100%', maxWidth: 24, height: `${Math.max(8, (item.value / max) * 100)}%`, minHeight: 8, background: color, borderRadius: '6px 6px 0 0' }} />
          <span style={{ fontSize: TEXT.xs, color: COLORS.inkSoft, textAlign: 'center' }}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
