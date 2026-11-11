import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, ChevronDown, ChevronRight, Download, AlertTriangle } from 'lucide-react';
import { getOrdresTransformation, getHaccpControles, createHaccpControle, deleteHaccpControle } from '../lib/api.js';
import { Card, Button, Field, Select, DataTable, notifyError, notifySuccess } from './ui.jsx';
import { COLORS, TEXT, SPACE } from '../lib/theme.js';
import { celluleCsv } from '../lib/securite.js';

const TYPES_CONTROLE = ['temperature', 'hygiene', 'tracabilite', 'autre'];

// Transformation agroalimentaire, étape 3 : registre HACCP — points de contrôle sanitaires
// liés à un ordre de transformation (panneau juste au-dessus). Conçu sur mesure (aucun module
// Quality/HACCP réutilisable dans la source ERP de référence). Journal réglementaire, export
// CSV pour un contrôle sanitaire externe (même patron que ReportsModule).
export default function HaccpPanel({ module, ouvertParDefaut }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(Boolean(ouvertParDefaut));
  const [loaded, setLoaded] = useState(false);
  const [ordres, setOrdres] = useState([]);
  const [ordresCharges, setOrdresCharges] = useState(false);
  const [controles, setControles] = useState([]);

  const emptyForm = {
    ordreTransformationId: '', typeControle: 'temperature', valeurMesuree: '', unite: '',
    seuilMin: '', seuilMax: '', conforme: true, actionCorrective: '', dateControle: '', operateur: '', notes: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  // Les contrôles sont chargés dès le montage, pas à l ouverture du panneau : le badge
  // « N non conforme(s) » de l en-tête n a d intérêt que s il alerte SANS qu on ait à
  // déplier le panneau. Tant qu il attendait l ouverture, controles restait vide, donc le
  // compteur valait 0 et le badge ne s affichait jamais avant qu on aille voir — il ne
  // prévenait personne.
  const chargerControles = async () => {
    try {
      const { controles: fetched } = await getHaccpControles({ module });
      setControles(fetched || []);
    } catch (err) {
      console.error('[HaccpPanel chargerControles]', err);
    } finally {
      setLoaded(true);
    }
  };

  // Les ordres de transformation ne servent qu au formulaire d ajout : inutile de les
  // charger tant que le panneau est replié.
  const chargerOrdres = async () => {
    try {
      const { ordres: fetched } = await getOrdresTransformation(module);
      setOrdres(fetched || []);
    } catch (err) {
      console.error('[HaccpPanel chargerOrdres]', err);
    } finally {
      setOrdresCharges(true);
    }
  };

  useEffect(() => { chargerControles(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [module]);
  useEffect(() => {
    if (open && !ordresCharges) chargerOrdres();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ajouterControle = async (e) => {
    e.preventDefault();
    if (!form.ordreTransformationId) return;
    setBusy(true);
    try {
      await createHaccpControle({
        ordreTransformationId: Number(form.ordreTransformationId), typeControle: form.typeControle,
        valeurMesuree: form.valeurMesuree === '' ? null : Number(form.valeurMesuree), unite: form.unite.trim() || null,
        seuilMin: form.seuilMin === '' ? null : Number(form.seuilMin), seuilMax: form.seuilMax === '' ? null : Number(form.seuilMax),
        conforme: form.conforme, actionCorrective: form.actionCorrective.trim() || null,
        dateControle: form.dateControle || null, operateur: form.operateur.trim() || null, notes: form.notes.trim() || null,
      });
      notifySuccess(t('haccp.controleAdded'));
      setForm(emptyForm);
      await chargerControles();
    } catch (err) {
      notifyError(err, t('haccp.controleAddError'));
    } finally {
      setBusy(false);
    }
  };

  const supprimerControle = async (id) => {
    if (!window.confirm(t('haccp.confirmDeleteControle'))) return;
    try {
      await deleteHaccpControle(id);
      notifySuccess(t('haccp.controleDeleted'));
      await chargerControles();
    } catch (err) {
      notifyError(err, t('haccp.controleDeleteError'));
    }
  };

  const exporterCsv = () => {
    const rows = [
      [t('haccp.date'), t('haccp.ordre'), t('haccp.typeLabel'), t('haccp.valeur'), t('haccp.unite'), t('haccp.seuilMin'), t('haccp.seuilMax'), t('haccp.conforme'), t('haccp.actionCorrective'), t('haccp.operateur'), t('common.notes')],
      ...controles.map((c) => [
        c.dateControle, c.ordreTransformationNom || '', t(`haccp.type.${c.typeControle}`),
        c.valeurMesuree ?? '', c.unite || '', c.seuilMin ?? '', c.seuilMax ?? '',
        c.conforme ? t('haccp.oui') : t('haccp.non'), c.actionCorrective || '', c.operateur || '', c.notes || '',
      ]),
    ];
    const csv = rows.map((row) => row.map(celluleCsv).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `haccp-${module}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const nonConformes = controles.filter((c) => !c.conforme).length;

  return (
    <Card>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: SPACE.sm, fontWeight: 600, fontSize: TEXT.md, color: COLORS.ink, padding: 0 }}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {t('haccp.title')} {loaded ? `(${controles.length})` : ''}
        {nonConformes > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, color: COLORS.red, fontSize: TEXT.sm, fontWeight: 600, marginLeft: SPACE.sm }}>
            <AlertTriangle size={13} /> {t('haccp.nonConformes', { count: nonConformes })}
          </span>
        )}
      </button>

      {open && (
        <div style={{ marginTop: SPACE.md, display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
          {ordres.length === 0 ? (
            <div style={{ color: COLORS.inkSoft, fontSize: TEXT.base }}>{t('haccp.aucunOrdreDisponible')}</div>
          ) : (
            <form onSubmit={ajouterControle} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
              <Select label={t('haccp.ordre')} value={form.ordreTransformationId} onChange={(e) => setForm({ ...form, ordreTransformationId: e.target.value })}>
                <option value="">{t('common.none')}</option>
                {ordres.map((o) => <option key={o.id} value={o.id}>{o.recetteNom} — {o.dateTransformation}</option>)}
              </Select>
              <Select label={t('haccp.typeLabel')} value={form.typeControle} onChange={(e) => setForm({ ...form, typeControle: e.target.value })}>
                {TYPES_CONTROLE.map((tc) => <option key={tc} value={tc}>{t(`haccp.type.${tc}`)}</option>)}
              </Select>
              <Field label={t('haccp.valeur')} type="number" step="0.01" value={form.valeurMesuree} onChange={(e) => setForm({ ...form, valeurMesuree: e.target.value })} />
              <Field label={t('haccp.unite')} placeholder="°C" value={form.unite} onChange={(e) => setForm({ ...form, unite: e.target.value })} />
              <Field label={t('haccp.seuilMin')} type="number" step="0.01" value={form.seuilMin} onChange={(e) => setForm({ ...form, seuilMin: e.target.value })} />
              <Field label={t('haccp.seuilMax')} type="number" step="0.01" value={form.seuilMax} onChange={(e) => setForm({ ...form, seuilMax: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.base, color: COLORS.inkSoft }}>
                <input type="checkbox" checked={form.conforme} onChange={(e) => setForm({ ...form, conforme: e.target.checked })} />
                {t('haccp.conforme')}
              </label>
              {!form.conforme && (
                <Field label={t('haccp.actionCorrective')} value={form.actionCorrective} onChange={(e) => setForm({ ...form, actionCorrective: e.target.value })} />
              )}
              <Field label={t('haccp.operateur')} value={form.operateur} onChange={(e) => setForm({ ...form, operateur: e.target.value })} />
              <Button type="submit" variant="ochre" disabled={busy}><Plus size={14} /> {t('common.add')}</Button>
            </form>
          )}

          <DataTable>
            <thead><tr style={{ color: COLORS.inkSoft }}>
              <th>{t('haccp.date')}</th>
              <th>{t('haccp.ordre')}</th>
              <th>{t('haccp.typeLabel')}</th>
              <th>{t('haccp.valeur')}</th>
              <th>{t('haccp.conforme')}</th>
              <th />
            </tr></thead>
            <tbody>
              {controles.map((c) => (
                <tr key={c.id} style={!c.conforme ? { background: COLORS.redSoft } : undefined}>
                  <td>{c.dateControle}</td>
                  <td style={{ color: COLORS.inkSoft }}>{c.ordreTransformationNom || '—'}</td>
                  <td>{t(`haccp.type.${c.typeControle}`)}</td>
                  <td>{c.valeurMesuree != null ? `${c.valeurMesuree} ${c.unite || ''}` : '—'}</td>
                  <td style={{ color: c.conforme ? COLORS.green : COLORS.red, fontWeight: 600 }}>
                    {c.conforme ? t('haccp.oui') : t('haccp.non')}
                  </td>
                  <td>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button type="button" onClick={() => supprimerControle(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.red, display: 'flex' }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {controles.length === 0 ? (
            <div style={{ color: COLORS.inkSoft, fontSize: TEXT.base }}>{t('haccp.aucunControle')}</div>
          ) : (
            <Button variant="outline" onClick={exporterCsv} style={{ alignSelf: 'flex-start' }}><Download size={14} /> {t('haccp.exportCsv')}</Button>
          )}
        </div>
      )}
    </Card>
  );
}
