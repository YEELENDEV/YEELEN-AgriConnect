import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Badge, Button, Card, Field, MiniChart, Select } from '../components/ui.jsx';
import { notifySuccess } from '../components/ui.jsx';
import { useLocale } from '../lib/locale.jsx';
import { useRestrictions } from '../lib/restrictions.jsx';
import {
  createFinance,
  deleteFinance,
  getBanquePrincipale,
  getBanques,
  getFinances,
  setBanquePrincipale,
  createBanque,
  deleteBanque,
} from '../lib/api';
import { COLORS, RADIUS, TEXT, SPACE } from '../lib/theme.js';

// Ce module portait sa propre copie de COLORS (une troisième palette, avec les mêmes noms
// de jetons et un fond beige légèrement différent). Elle est remplacée par la palette
// partagée : voir src/lib/theme.js.

export function FinancesModule() {
  const { t } = useTranslation();
  const { fmtMoney, fmtDate, devise } = useLocale();
  // Choix du compte bancaire principal : réservé à qui peut modifier les banques (restriction
  // posée par l'entreprise), et non plus au rôle texte « admin » que portent tous les comptes.
  const isAdmin = useRestrictions().peut('banques', 'modifier');
  const catLabel = (c) => t(`finances.categorieLabels.${c}`, { defaultValue: c });
  const [banquePrincipaleId, setBanquePrincipaleIdState] = useState('');
  const [savingBanquePrincipale, setSavingBanquePrincipale] = useState(false);
  const [showAddBanque, setShowAddBanque] = useState(false);
  const [entries, setEntries] = useState([]);
  const [banques, setBanques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');
  const [form, setForm] = useState({ categorie: 'Caisse', montant: '', description: '', date: new Date().toISOString().slice(0, 10), banqueId: '' });

  const CATEGORIES_REVENUS = ['Caisse', 'Banque'];
  const CATEGORIES_DEPENSES = ['Depenses diverses', 'Carburant', 'Salaire', 'Entretien'];
  const ALL_CATEGORIES = [...CATEGORIES_REVENUS, ...CATEGORIES_DEPENSES];

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [financesData, banquesData, banquePrincipaleData] = await Promise.all([
          getFinances(), getBanques(), getBanquePrincipale(),
        ]);
        setEntries(financesData.finances || []);
        setBanques(banquesData.banques || []);
        setBanquePrincipaleIdState(banquePrincipaleData.banquePrincipaleId || '');
      } catch (err) {
        setApiError(err.message || t('finances.loadError'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const changeBanquePrincipale = async (id) => {
    setSavingBanquePrincipale(true);
    try {
      await setBanquePrincipale(id || null);
      setBanquePrincipaleIdState(id);
      notifySuccess(t('finances.comptePrincipalUpdated'));
    } catch (err) {
      setApiError(err.message || t('finances.comptePrincipalError'));
    } finally {
      setSavingBanquePrincipale(false);
    }
  };

  const reloadBanques = async () => {
    try {
      const data = await getBanques();
      setBanques(data.banques || []);
    } catch (err) {
      setApiError(err.message);
    }
  };

  const addEntry = async (e) => {
    e.preventDefault();
    if (!form.categorie || form.montant === '' || !form.description) return;
    if (form.categorie === 'Banque' && !form.banqueId) {
      setApiError(t('finances.banqueRequise'));
      return;
    }

    setSaving(true);
    setApiError('');
    try {
      const { entry } = await createFinance({
        categorie: form.categorie,
        montant: Number(form.montant),
        description: form.description,
        date: form.date,
        banqueId: form.categorie === 'Banque' ? Number(form.banqueId) : undefined,
      });
      setEntries(prev => [entry, ...prev]);
      setForm({ categorie: 'Caisse', montant: '', description: '', date: new Date().toISOString().slice(0, 10), banqueId: '' });
    } catch (err) {
      setApiError(err.message || t('finances.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (id, description) => {
    const confirmMsg = description ? t('finances.confirmDeleteNamed', { description }) : t('finances.confirmDelete');
    if (!window.confirm(confirmMsg)) return;
    setApiError('');
    try {
      await deleteFinance(id);
      setEntries(prev => prev.filter(e => e.id !== id));
      notifySuccess(t('finances.deleted'));
    } catch (err) {
      setApiError(err.message || t('finances.deleteError'));
    }
  };

  // Une ligne est une "dépense" si sa catégorie l'indique (saisie manuelle, montant
  // toujours positif dans ce cas) OU si son montant est négatif (achats synchronisés
  // automatiquement depuis Cultures/Poulailler, qui gardent Caisse/Banque comme
  // catégorie — nécessaire pour que les soldes par compte restent exacts).
  const isDepenseEntry = (e) => CATEGORIES_DEPENSES.includes(e.categorie) || Number(e.montant) < 0;

  const totalCaisse = entries.filter(e => e.categorie === 'Caisse').reduce((s, e) => s + Number(e.montant), 0);
  const totalBanque = entries.filter(e => e.categorie === 'Banque').reduce((s, e) => s + Number(e.montant), 0);
  const totalDepenses = entries.filter(isDepenseEntry).reduce((s, e) => s + Math.abs(Number(e.montant)), 0);
  const totalRevenus = entries.filter(e => !isDepenseEntry(e)).reduce((s, e) => s + Math.abs(Number(e.montant)), 0);
  const beneficeNet = totalRevenus - totalDepenses;
  // Libellé court des barres. Le slice(5) précédent supposait une date au format
  // 'YYYY-MM-DD', alors que GET /finances renvoie f.created_at brut, donc un horodatage
  // ISO complet : la barre affichait le fragment « 09-08T21:30:45.904Z ». fmtDate accepte des
  // options Intl, on réutilise donc le formatage localisé déjà en place dans le tableau.
  const labelJour = (d) => (d ? fmtDate(d, { day: 'numeric', month: 'short' }) : '-');
  // `id` sert de clé React à MiniChart : deux opérations du même jour produisent le même
  // libellé, qui ne peut donc pas servir de clé (ce que le fragment horodaté masquait).
  const pointChart = (e) => ({ id: e.id, label: labelJour(e.date), value: Math.abs(Number(e.montant)) });
  const chartRevenus = entries.filter((e) => !isDepenseEntry(e)).slice(0, 6).map(pointChart).reverse();
  const chartDepenses = entries.filter(isDepenseEntry).slice(0, 6).map(pointChart).reverse();

  const soldesParBanque = useMemo(() => {
    return banques.map(b => {
      const mouvements = entries
        .filter(e => e.categorie === 'Banque' && Number(e.banqueId) === b.id)
        .reduce((s, e) => s + Number(e.montant), 0);
      return { ...b, soldeActuel: Number(b.solde) + mouvements };
    });
  }, [banques, entries]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, color: COLORS.inkSoft, padding: SPACE.huge }}>
      <Loader2 size={18} className="spin" /> {t('finances.loading')}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      {apiError && (
        <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '11px 16px', fontSize: TEXT.base, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <AlertTriangle size={15} /> {apiError}
          <button onClick={() => setApiError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: COLORS.red, cursor: 'pointer', fontWeight: 700 }}>x</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: SPACE.md }}>
        <Card style={{ background: COLORS.greenSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600, marginBottom: SPACE.xs }}>{t('finances.cardCaisse')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.green }}>{fmtMoney(totalCaisse)}</div>
        </Card>
        <Card style={{ background: COLORS.blueSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.blue, fontWeight: 600, marginBottom: SPACE.xs }}>{t('finances.cardBanque')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.blue }}>{fmtMoney(totalBanque)}</div>
        </Card>
        <Card style={{ background: COLORS.redSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.red, fontWeight: 600, marginBottom: SPACE.xs }}>{t('finances.cardDepenses')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.red }}>{fmtMoney(totalDepenses)}</div>
        </Card>
        <Card style={{ background: beneficeNet >= 0 ? COLORS.greenSoft : COLORS.redSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: beneficeNet >= 0 ? COLORS.green : COLORS.red, fontWeight: 600, marginBottom: SPACE.xs }}>{t('finances.cardBenefice')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: beneficeNet >= 0 ? COLORS.green : COLORS.red }}>{fmtMoney(beneficeNet)}</div>
        </Card>
      </div>

      {soldesParBanque.length > 0 && (
        <Card>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
            {t('finances.soldesParCompte')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: SPACE.sm }}>
            {soldesParBanque.map(b => (
              <div key={b.id} style={{ padding: '10px 12px', borderRadius: RADIUS.card, border: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 600 }}>{b.nomBanque}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.md, fontWeight: 700 }}>{fmtMoney(b.soldeActuel)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
            {t('finances.comptePrincipalTitle')}
          </div>
          <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.md }}>
            {t('finances.comptePrincipalHint')}
          </div>
          <Select
            label={t('finances.comptePrincipalLabel')}
            value={banquePrincipaleId || ''}
            onChange={e => changeBanquePrincipale(e.target.value)}
            disabled={savingBanquePrincipale}
          >
            <option value="">{t('finances.comptePrincipalNone')}</option>
            {banques.map(b => <option key={b.id} value={b.id}>{b.nomBanque}</option>)}
          </Select>

          <button
            type="button"
            onClick={() => setShowAddBanque(v => !v)}
            style={{ marginTop: SPACE.md, background: 'none', border: 'none', cursor: 'pointer', color: COLORS.green, fontWeight: 600, fontSize: TEXT.base, display: 'flex', alignItems: 'center', gap: SPACE.sm }}
          >
            <Plus size={14} /> {showAddBanque ? t('finances.addBanqueClose') : t('finances.addBanqueToggle')}
          </button>

          {showAddBanque && (
            <div style={{ marginTop: SPACE.md }}>
              <BanquesModule onCountChange={() => reloadBanques()} />
            </div>
          )}
        </Card>
      )}

      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('finances.newOperation')}</div>
        <form onSubmit={addEntry} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Select label={t('finances.categorie')} value={form.categorie} onChange={e => setForm({ ...form, categorie: e.target.value, banqueId: '' })}>
            {ALL_CATEGORIES.map(cat => <option key={cat} value={cat}>{catLabel(cat)}</option>)}
          </Select>
          {form.categorie === 'Banque' && (
            <Select label={t('finances.compteBancaire')} value={form.banqueId} onChange={e => setForm({ ...form, banqueId: e.target.value })} required>
              <option value="">{t('finances.selectPlaceholder')}</option>
              {banques.map(b => <option key={b.id} value={b.id}>{b.nomBanque}</option>)}
            </Select>
          )}
          <Field label={t('finances.montant', { devise })} type="number" placeholder="0" value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} />
          <Field label={t('finances.description')} placeholder={t('finances.descriptionPlaceholder')} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Field label={t('finances.date')} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Button variant="green" type="submit" disabled={saving}>
            {saving ? <Loader2 size={14} className="spin" /> : <Plus size={15} />} {t('common.add')}
          </Button>
        </form>
      </Card>
      <Card>
        <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.sm }}>{t('finances.chartsTitle')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.md }}>
          <div>
            <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.xs }}>{t('finances.chartRevenus')}</div>
            <MiniChart data={chartRevenus.length ? chartRevenus : [{ label: '-', value: 0 }]} color={COLORS.green} />
          </div>
          <div>
            <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.xs }}>{t('finances.chartDepenses')}</div>
            <MiniChart data={chartDepenses.length ? chartDepenses : [{ label: '-', value: 0 }]} color={COLORS.red} />
          </div>
        </div>
      </Card>
      <Card style={{ padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: TEXT.base }}>
          <thead>
            <tr style={{ textAlign: 'left', color: COLORS.inkSoft, fontSize: TEXT.sm }}>
              <th style={{ padding: '12px 16px' }}>{t('finances.date')}</th>
              <th>{t('finances.categorie')}</th>
              <th>{t('finances.colDescription')}</th>
              <th>{t('finances.colMontant')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={5} style={{ padding: SPACE.xl, color: COLORS.inkSoft, textAlign: 'center' }}>{t('finances.emptyTable')}</td></tr>
            )}
            {entries.map(entry => {
              const isDepense = isDepenseEntry(entry);
              const dateLabel = entry.date ? fmtDate(entry.date) : '-';
              return (
                <tr key={entry.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '12px 16px', fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.sm }}>{dateLabel}</td>
                  <td>
                    <Badge tone={isDepense ? 'red' : 'green'}>{catLabel(entry.categorie)}</Badge>
                    {entry.banqueNom && <span style={{ fontSize: TEXT.xs, color: COLORS.inkSoft, marginLeft: SPACE.sm }}>({entry.banqueNom})</span>}
                  </td>
                  <td style={{ color: COLORS.inkSoft }}>{entry.description}</td>
                  <td style={{ fontWeight: 600, color: isDepense ? COLORS.red : COLORS.green }}>
                    {isDepense ? '-' : '+'}{fmtMoney(Math.abs(Number(entry.montant)))}
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: SPACE.lg }}>
                    <button onClick={() => removeEntry(entry.id, entry.description)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft }}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function BanquesModule({ onCountChange }) {
  const { t } = useTranslation();
  const { fmtMoney } = useLocale();
  const [banques, setBanques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const emptyForm = { nomBanque: '', iban: '', typeCompte: '', solde: '' };
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const loadBanques = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getBanques();
      setBanques(data.banques || []);
      if (onCountChange) onCountChange((data.banques || []).length);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBanques(); }, []);

  const addBanque = async (e) => {
    e.preventDefault();
    if (!form.nomBanque) return;
    setSubmitting(true);
    setFormError('');
    try {
      await createBanque({
        nomBanque: form.nomBanque,
        iban: form.iban || null,
        typeCompte: form.typeCompte || null,
        solde: Number(form.solde) || 0,
      });
      setForm(emptyForm);
      await loadBanques();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const removeBanque = async (id) => {
    try {
      await deleteBanque(id);
      await loadBanques();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
          {t('finances.banques.addTitle')}
        </div>

        {formError && (
          <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, marginBottom: SPACE.md }}>
            {formError}
          </div>
        )}

        <form onSubmit={addBanque} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Field label={t('finances.banques.nom')} placeholder={t('finances.banques.nomPlaceholder')} value={form.nomBanque} onChange={e => setForm({ ...form, nomBanque: e.target.value })} required />
          <Field label={t('finances.banques.iban')} placeholder="IBAN" value={form.iban} onChange={e => setForm({ ...form, iban: e.target.value })} />
          <Field label={t('finances.banques.typeCompte')} placeholder={t('finances.banques.typeComptePlaceholder')} value={form.typeCompte} onChange={e => setForm({ ...form, typeCompte: e.target.value })} />
          <Field label={t('finances.banques.soldeInitial')} type="number" placeholder="0" value={form.solde} onChange={e => setForm({ ...form, solde: e.target.value })} />
          <Button type="submit" variant="green" disabled={submitting}>
            {submitting ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} {t('common.add')}
          </Button>
        </form>
      </Card>

      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
          {t('finances.banques.listTitle')}
        </div>

        {error && (
          <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, marginBottom: SPACE.md }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.base, color: COLORS.inkSoft }}>
            <Loader2 size={15} className="spin" /> {t('common.loading')}
          </div>
        ) : banques.length === 0 ? (
          <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('finances.banques.empty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            {banques.map(b => (
              <div key={b.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px', borderRadius: RADIUS.card, border: `1px solid ${COLORS.border}`,
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: TEXT.base }}>{b.nomBanque}</div>
                  <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>
                    {b.typeCompte || t('finances.banques.typeNonRenseigne')}
                    {b.iban && ` · ${b.iban}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                  <span style={{ fontSize: TEXT.base, fontWeight: 600 }}>{fmtMoney(b.solde)}</span>
                  <button onClick={() => removeBanque(b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.red, display: 'flex' }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
