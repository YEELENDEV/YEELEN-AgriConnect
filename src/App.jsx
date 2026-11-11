import './App.css';
﻿import React, { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { setLanguage, hasExplicitLanguage, SUPPORTED_LANGS } from './i18n';
import { useLocale, fmtDate, fmtMoneyWith as previewMoney, fmtDateWith as previewDate, DEVISES, LOCALES, PAYS, FUSEAUX, getLocaleConfig, jourEntreprise } from './lib/locale.jsx';
import { normaliserNumeroWhatsapp, lienWhatsapp, partagerFichier } from './lib/whatsapp.js';
import { escapeHtml, celluleCsv } from './lib/securite.js';
import { RestrictionsContext, useRestrictions, creerVerificateur, ongletVisible, exigencesSatisfaites } from './lib/restrictions.jsx';
import {
  Sprout, Droplet, Thermometer, Egg, ShoppingCart, Truck, Wallet, LogOut,
  Plus, Trash2, ToggleLeft, ToggleRight, Package, TrendingUp,
  ChevronRight, ChevronLeft, Check, Lock, Mail, Loader2, Leaf, Bird,
  ClipboardList, ArrowUpCircle, ArrowDownCircle, AlertTriangle, Home, GripVertical,
  Search, FileText, Download, Users, Briefcase, Landmark, Bell,
  CalendarDays, Settings, Settings2, MessageSquare, HelpCircle, Wrench, History,
  Camera, Building2, User as UserIcon, Phone as PhoneIcon, Fish, Cloud, Menu, X, BarChart3, MessageCircle, Video,
  MapPin
} from 'lucide-react';
import {
  clearToken,
  getFinances, getMe, getToken, login, register, confirmerInscription, renvoyerCodeInscription, setToken,
  getContacts, createContact, updateContact, deleteContact,
  getContactTags, createContactTag, deleteContactTag,
  getRoles,
  getParcelles, createParcelle, updateParcelle, deleteParcelle,
  getParcellesHistorique, createParcelleHistorique, generatePlanning,
  getCulturesMouvements,
  getProduits, createProduit, updateProduit, deleteProduit,
  getEvolutionStock, getProduitMouvements,
  getProduitLots, createProduitLot, updateProduitLot, deleteProduitLot, getLotsPerimes,
  getProduitCategories, createProduitCategorie, deleteProduitCategorie,
  getUnitesMesure,
  getPoulaillerMouvements,
  getPoulaillerLivraisons, createPoulaillerLivraison, updatePoulaillerLivraison, deletePoulaillerLivraison,
  getPoulaillerSuivi, createPoulaillerSuivi,
  setupMfa, verifyMfa, disableMfa, resendMfaEmail,
  getSalaries, createSalarie, updateSalarie, deleteSalarie,
  getPostes, getDepartements,
  getPoulaillerHistorique, getCulturesHistorique,
  getPiscicultureLivraisons, createPiscicultureLivraison, updatePiscicultureLivraison, deletePiscicultureLivraison,
  getPiscicultureSuivi, createPiscicultureSuivi,
  getAchatsDocuments, getAchatDocument, createAchatDocument, updateAchatDocument, deleteAchatDocument, getAchatsLedger, getAchatsParFournisseur,
  commanderAchatDocument, recevoirAchatDocument, annulerReceptionAchatDocument,
  envoyerAchatDocument, annulerAchatDocument, remettreBrouillonAchatDocument, receptionPartielleAchatDocument,
  getListesPrix, createListePrix, deleteListePrix, getListePrixLignes, createListePrixLigne, deleteListePrixLigne, getPrixEffectif,
  getProduitTemplates,
  getDevisListe, getDevisDetail, getDevisJournal, createDevis, updateDevis, deleteDevis, envoyerDevis, facturerDevis, getVentesLedger,
  preparerLienWhatsapp,
  getDevisPdfFile,
  getPaymentTerms, createPaymentTerm, deletePaymentTerm,
  getTaxes,
  getActivites, createActivite, updateActivite, deleteActivite,
  getMessages, createMessage,
  openDevisPdf, downloadDevisPdf, validerDevisManuel, payerEcheance, remettreDevisBrouillon, updateDevisLigneQuantites, annulerDevis,
  getCalendarEvents, createCalendarEvent, updateCalendarEvent, getRecoltes, createRecolte, updateRecolte, deleteRecolte,
  getOnboardingStatus, updateOnboardingStatus, updateEntreprise, getEntreprise,
  getModulesActifs, updateModulesActifs, getTarifsModules, getMesRestrictions,
  getBillingStatus,
  rechercherVilleMeteo, getMeteo, getParcellesLocalisees, getAnalyseSol, getNdvi,
} from './lib/api';
import { getRecaptchaToken } from './lib/recaptcha.js';
const BillingAdminPanel = lazy(() => import('./components/BillingAdminPanel'));
import AbonnementBloque from './components/AbonnementBloque';
const MeteoModule = lazy(() => import('./components/MeteoModule'));
const SurveillanceModule = lazy(() => import('./components/SurveillanceModule'));
import MeteoWidget from './components/MeteoWidget';
import { Badge, Button, Card, DataTable, Field, GaugeDial, MentionSimulation, MiniChart, Select, ToastContainer, notifyError, notifySuccess } from './components/ui.jsx';
const ObservationListView = lazy(() => import('./components/ObservationListView').then((m) => ({ default: m.ObservationListView })));
const RegistreIntrantsView = lazy(() => import('./components/RegistreIntrantsView').then((m) => ({ default: m.RegistreIntrantsView })));
const FeedbackModule = lazy(() => import('./components/FeedbackModule').then((m) => ({ default: m.FeedbackModule })));
const HelpModule = lazy(() => import('./components/HelpModule').then((m) => ({ default: m.HelpModule })));
const CarteParcelles = lazy(() => import('./components/CarteParcelles'));
const RolesPanel = lazy(() => import('./components/RolesPanel'));
const AideFlottante = lazy(() => import('./components/AideFlottante'));
const EquipementsModule = lazy(() => import('./components/EquipementsModule').then((m) => ({ default: m.EquipementsModule })));
import { GlobalSearch } from './components/GlobalSearch';
import { EmployeeRhModal } from './components/EmployeeRhModal';
import RhReferentiels from './components/RhReferentiels';
import PaymentTermsPanel from './components/PaymentTermsPanel';
import TaxesPanel from './components/TaxesPanel';
import TaxSelect from './components/TaxSelect';
import { useListeOutils, BarreOutilsListe, EnteteTriable, LigneGroupe, PiedListe, TableauListe, MenuColonnes, SousNavOnglets, useAffichageEtroit } from './components/ListeOutils.jsx';
import { useParametreUrl } from './lib/urlParams.js';
import ComptaConfigPanel from './components/ComptaConfigPanel';
const FacturesModule = lazy(() => import('./components/FacturesModule'));
import ProduitTemplatesPanel from './components/ProduitTemplatesPanel';
import ProduitRecettesPanel from './components/ProduitRecettesPanel';
import OrdresTransformationPanel from './components/OrdresTransformationPanel';
import HaccpPanel from './components/HaccpPanel';
import StockEmplacementsPanel from './components/StockEmplacementsPanel.jsx';
import InventaireRebutPanel from './components/InventaireRebutPanel.jsx';
import TransfertsStockPanel from './components/TransfertsStockPanel.jsx';
import { taxesLigneCalc as taxesLigneCalcPure } from './lib/taxes.js';
const MonEspaceRh = lazy(() => import('./components/MonEspaceRh'));
import { storageGet, storageSet, syncPendingChanges } from './utils/storage.js';
import { FinancesModule, BanquesModule } from './modules/finances.jsx';

// Palette et formes : voir src/lib/theme.js. Le nom COLORS est conservé pour que les usages
// de ce fichier restent inchangés — seules les valeurs ont été unifiées (2026-09-09).
import { COLORS, NAVBAR_BORDER, RADIUS, TEXT, SPACE } from './lib/theme.js';


// Regroupement des menus de la navbar — même taxonomie que le champ `category` d'availableTabs.
// labelKey résolu via i18n au rendu (TopNavbar), le module-level ne peut pas utiliser le hook.
const NAV_CATEGORIES = [
  { id: 'operations', labelKey: 'navGroup.operations', color: COLORS.green },
  { id: 'analyse', labelKey: 'navGroup.analyse', color: COLORS.blue },
  { id: 'commercial', labelKey: 'navGroup.commercial', color: COLORS.ochre },
  { id: 'finance', labelKey: 'navGroup.finance', color: COLORS.red },
  { id: 'rh', labelKey: 'navGroup.rh', color: COLORS.violet },
];


// L'onglet Carte. Il affichait des pastilles positionnées par pos_x/pos_y — deux nombres tirés
// au hasard à la création de la parcelle (Math.random), donc une carte qui ne représentait rien.
// Elle montre désormais les contours réels, tracés sur imagerie satellite ; pos_x/pos_y ne sont
// plus lus nulle part (les colonnes restent en base, rien ne les alimente plus).
function ParcelMapTab({ parcelles, onParcelleMaj }) {
  const etroitCarte = useAffichageEtroit();
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState(parcelles[0]?.id ?? null);
  const [contourEdition, setContourEdition] = useState(null);
  const selected = parcelles.find(p => p.id === selectedId) || parcelles[0] || null;

  const statusOf = (p) => {
    if (p.temperature > 33) return { label: t('cultures.map.statusHighTemp'), tone: 'red' };
    if (p.humidite < p.seuil) return { label: t('cultures.map.statusToWater'), tone: 'blue' };
    return { label: t('cultures.map.statusNormal'), tone: 'green' };
  };

  const enregistrerContour = async (contour) => {
    const id = contourEdition;
    try {
      const reponse = await updateParcelle(id, { contour });
      // safeRequest renvoie null quand l'écriture est mise en file hors-ligne : la surface est
      // calculée par le serveur, on ne peut donc que garder le tracé et le dire.
      if (!reponse) {
        onParcelleMaj({ id, contour });
        notifySuccess(t('cultures.contour.horsLigne'));
      } else {
        onParcelleMaj(reponse.parcelle);
        notifySuccess(t('cultures.contour.enregistre', { ha: reponse.parcelle.superficie }));
      }
      setContourEdition(null);
    } catch (err) {
      console.error('[enregistrerContour]', err);
      notifyError(err);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: etroitCarte ? '1fr' : '1.4fr 1fr', gap: SPACE.lg, alignItems: 'start' }}>
      <Card style={{ padding: SPACE.md }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('cultures.map.title')}</div>
        {parcelles.length === 0 ? (
          <div style={{ padding: SPACE.xl, textAlign: 'center', color: COLORS.inkSoft, fontSize: TEXT.base }}>
            {t('cultures.aucuneParcelleCarte')}
          </div>
        ) : (
          <Suspense fallback={<div style={{ padding: SPACE.xl, textAlign: 'center', color: COLORS.inkSoft }}><Loader2 size={18} className="spin" /></div>}>
            <CarteParcelles
              parcelles={parcelles}
              selectedId={selectedId}
              onSelect={setSelectedId}
              parcelleEnEdition={contourEdition}
              onEnregistrer={enregistrerContour}
              onAnnuler={() => setContourEdition(null)}
              hauteur={etroitCarte ? 300 : 440}
            />
          </Suspense>
        )}
      </Card>

      {selected && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACE.md }}>
            <div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{selected.nom}</div>
              <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{selected.culture}</div>
            </div>
            <Badge tone={statusOf(selected).tone}>{statusOf(selected).label}</Badge>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.sm, marginBottom: SPACE.md }}>
            <span style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>
              {selected.contour
                ? t('cultures.contour.surfaceMesuree', { ha: selected.superficie })
                : t('cultures.contour.aucunContour')}
            </span>
            <Button small variant={selected.contour ? 'ghost' : 'default'}
              onClick={() => setContourEdition(contourEdition === selected.id ? null : selected.id)}>
              <MapPin size={14} /> {selected.contour ? t('cultures.contour.modifier') : t('cultures.contour.dessiner')}
            </Button>
          </div>

          <div style={{ display: 'flex', gap: SPACE.xl, justifyContent: 'center', padding: '6px 0' }}>
            <GaugeDial value={selected.humidite} label={t('cultures.soilHumidity')} unit="%" colorMain={COLORS.blue} colorTrack={COLORS.blueSoft} icon={<Droplet size={15} color={COLORS.blue} />} />
            <GaugeDial value={selected.temperature} max={45} label={t('cultures.temperature')} unit="°" colorMain={COLORS.ochre} colorTrack={COLORS.ochreSoft} icon={<Thermometer size={15} color={COLORS.ochre} />} />
          </div>
          <MentionSimulation texte={t('simulation.capteurs')} />

          <div style={{ display: 'flex', gap: SPACE.md, marginTop: SPACE.sm, fontSize: TEXT.sm, color: COLORS.inkSoft, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: COLORS.green, display: 'inline-block' }} /> {t('cultures.map.statusNormal')}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: COLORS.blue, display: 'inline-block' }} /> {t('cultures.map.statusToWater')}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: COLORS.red, display: 'inline-block' }} /> {t('cultures.map.statusHighTemp')}</span>
          </div>
        </Card>
      )}
    </div>
  );
}

function EnvironnementTab({ farmId }) {
  const { t } = useTranslation();
  const [env, setEnv] = useState({ temperature: 28, humidite: 61 });
  useEffect(() => {
    const timer = setInterval(() => {
      setEnv(prev => ({
        temperature: Math.max(18, Math.min(38, prev.temperature + (Math.random() - 0.5) * 1.2)),
        humidite: Math.max(30, Math.min(90, prev.humidite + (Math.random() - 0.5) * 4)),
      }));
    }, 6000);
    return () => clearInterval(timer);
  }, []);
  const alerte = env.temperature > 33 || env.humidite > 80;
  const days = t('common.days', { returnObjects: true });
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACE.md }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('poulailler.ambianceTitle')}</div>
        <Badge tone={alerte ? 'red' : 'green'}>{alerte ? t('poulailler.conditionsWatch') : t('poulailler.conditionsNormal')}</Badge>
      </div>
      <div style={{ display: 'flex', gap: SPACE.xl, justifyContent: 'center', padding: '10px 0' }}>
        <GaugeDial value={env.temperature} max={45} label={t('poulailler.temperature')} unit="°" colorMain={COLORS.ochre} colorTrack={COLORS.ochreSoft} icon={<Thermometer size={15} color={COLORS.ochre} />} />
        <GaugeDial value={env.humidite} label={t('poulailler.humidite')} unit="%" colorMain={COLORS.blue} colorTrack={COLORS.blueSoft} icon={<Droplet size={15} color={COLORS.blue} />} />
      </div>
      <MentionSimulation texte={t('simulation.capteurs')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.md, marginTop: SPACE.sm }}>
        <div>
          <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.xs }}>{t('poulailler.tempEvolution')}</div>
          <MiniChart data={[
            { label: days[0], value: 27 },
            { label: days[1], value: 29 },
            { label: days[2], value: 31 },
            { label: days[3], value: 28 },
          ]} color={COLORS.ochre} />
        </div>
        <div>
          <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.xs }}>{t('poulailler.humidityEvolution')}</div>
          <MiniChart data={[
            { label: days[0], value: 62 },
            { label: days[1], value: 58 },
            { label: days[2], value: 54 },
            { label: days[3], value: 60 },
          ]} color={COLORS.blue} />
        </div>
      </div>
    </Card>
  );
}

// Mirroir d'EnvironnementTab — aucun backend/persistance (simulation client identique),
// vocabulaire qualité de l'eau (pH/oxygène dissous/température) inspiré du schéma FIWARE
// Smart Data Models Aquaculture (FishContainment/Sump) : voir le plan de ce chantier.
function BassinsEnvironnementTab({ farmId }) {
  const { t } = useTranslation();
  const [env, setEnv] = useState({ ph: 7.2, oxygene: 6.5, temperature: 24 });
  useEffect(() => {
    const timer = setInterval(() => {
      setEnv(prev => ({
        ph: Math.max(5, Math.min(10, prev.ph + (Math.random() - 0.5) * 0.2)),
        oxygene: Math.max(2, Math.min(10, prev.oxygene + (Math.random() - 0.5) * 0.5)),
        temperature: Math.max(15, Math.min(35, prev.temperature + (Math.random() - 0.5) * 1)),
      }));
    }, 6000);
    return () => clearInterval(timer);
  }, []);
  const alerte = env.ph < 6 || env.ph > 9 || env.oxygene < 4 || env.temperature > 30;
  const days = t('common.days', { returnObjects: true });
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACE.md }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('pisciculture.bassinsTitle')}</div>
        <Badge tone={alerte ? 'red' : 'green'}>{alerte ? t('pisciculture.conditionsWatch') : t('pisciculture.conditionsNormal')}</Badge>
      </div>
      <div style={{ display: 'flex', gap: SPACE.xl, justifyContent: 'center', padding: '10px 0', flexWrap: 'wrap' }}>
        <GaugeDial value={env.ph} max={14} label={t('pisciculture.ph')} unit="" colorMain={COLORS.blue} colorTrack={COLORS.blueSoft} icon={<Droplet size={15} color={COLORS.blue} />} />
        <GaugeDial value={env.oxygene} max={10} label={t('pisciculture.oxygene')} unit=" mg/L" colorMain={COLORS.green} colorTrack={COLORS.greenSoft} icon={<Droplet size={15} color={COLORS.green} />} />
        <GaugeDial value={env.temperature} max={40} label={t('pisciculture.temperatureEau')} unit="°" colorMain={COLORS.ochre} colorTrack={COLORS.ochreSoft} icon={<Thermometer size={15} color={COLORS.ochre} />} />
      </div>
      <MentionSimulation texte={t('simulation.capteurs')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.md, marginTop: SPACE.sm }}>
        <div>
          <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.xs }}>{t('pisciculture.phEvolution')}</div>
          <MiniChart data={[
            { label: days[0], value: 7.1 },
            { label: days[1], value: 7.3 },
            { label: days[2], value: 7.0 },
            { label: days[3], value: 7.2 },
          ]} color={COLORS.blue} />
        </div>
        <div>
          <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.xs }}>{t('pisciculture.oxygeneEvolution')}</div>
          <MiniChart data={[
            { label: days[0], value: 6.8 },
            { label: days[1], value: 6.2 },
            { label: days[2], value: 5.9 },
            { label: days[3], value: 6.5 },
          ]} color={COLORS.green} />
        </div>
      </div>
    </Card>
  );
}

// Module de gestion des devis/factures multi-lignes, avec envoi au client et signature électronique.
// clientsListe : liste des clients existants (pour le sélecteur), transmise par le parent (Ventes)
// Vue Kanban des devis — inspirée des vues pipeline de référence d'un ERP (colonnes =
// regroupement par statut, glisser une carte = changer le statut), mais
// adaptée à notre vraie machine à états : contrairement au stage_id générique
// d'un ERP de référence (n'importe quel champ, n'importe quelle transition), nos statuts ont
// des transitions précises portées par des routes dédiées (envoyer/valider-
// manuel/facturer/remettre-brouillon), certaines n'existant même pas côté
// admin (Envoyé → Signé ne se fait que via le lien public signé par le
// client). Seules les colonnes de destination valides acceptent le dépôt —
// isValidDevisTransition encode exactement les routes réellement disponibles,
// voir server/src/routes/devis.js.
function isValidDevisTransition(fromStatut, toColumn) {
  if (toColumn === 'Brouillon') return fromStatut !== 'Brouillon';
  if (toColumn === 'Envoyé') return ['Brouillon', 'Devis'].includes(fromStatut);
  if (toColumn === 'Signé') return ['Brouillon', 'Devis'].includes(fromStatut);
  if (toColumn === 'Facturé') return fromStatut === 'Signé';
  return false;
}

const DEVIS_KANBAN_COLUMNS = [
  { key: 'Brouillon', statuts: ['Brouillon', 'Devis'] },
  { key: 'Envoyé', statuts: ['Envoyé'] },
  { key: 'Signé', statuts: ['Signé'] },
  { key: 'Facturé', statuts: ['Facturé', 'Non payé', 'Payé partiellement', 'Payé'] },
];

function DevisKanban({ devisListe, statutTone, onEnvoyer, onValiderManuel, onFacturer, onRemettreBrouillon, onOpenDetail }) {
  const etroitKanban = useAffichageEtroit();
  const { t } = useTranslation();
  const { fmtMoney, locale, devise: deviseEntreprise } = useLocale();
  const [draggedId, setDraggedId] = useState(null);
  const draggedDevis = devisListe.find(d => d.id === draggedId) || null;

  const handleDrop = (columnKey) => {
    if (!draggedDevis || !isValidDevisTransition(draggedDevis.statut, columnKey)) return;
    if (columnKey === 'Envoyé') onEnvoyer(draggedDevis.id);
    else if (columnKey === 'Signé') onValiderManuel(draggedDevis.id);
    else if (columnKey === 'Facturé') onFacturer(draggedDevis.id, draggedDevis.total);
    else if (columnKey === 'Brouillon') onRemettreBrouillon(draggedDevis.id);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: etroitKanban ? 'repeat(4, 78vw)' : 'repeat(4, 1fr)', gap: SPACE.md, alignItems: 'start', overflowX: etroitKanban ? 'auto' : 'visible', maxWidth: '100%' }}>
      {DEVIS_KANBAN_COLUMNS.map(col => {
        const items = devisListe.filter(d => col.statuts.includes(d.statut));
        const isValidTarget = draggedDevis && isValidDevisTransition(draggedDevis.statut, col.key);
        return (
          <div
            key={col.key}
            onDragOver={(e) => { if (isValidTarget) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); handleDrop(col.key); setDraggedId(null); }}
            style={{
              background: isValidTarget ? COLORS.greenSoft : COLORS.surfaceAlt, borderRadius: RADIUS.card, padding: SPACE.sm,
              minHeight: 120, border: `1.5px dashed ${isValidTarget ? COLORS.green : 'transparent'}`,
              transition: 'background 0.15s ease, border-color 0.15s ease',
            }}
          >
            <div style={{ fontSize: TEXT.sm, fontWeight: 700, color: COLORS.inkSoft, marginBottom: SPACE.sm, display: 'flex', justifyContent: 'space-between' }}>
              <span>{t(`devis.statut.${col.key}`)}</span><span>{items.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              {items.map(d => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={() => setDraggedId(d.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onClick={() => onOpenDetail(d.id)}
                  style={{
                    background: '#fff', borderRadius: RADIUS.card, padding: SPACE.sm, cursor: 'grab',
                    border: `1px solid ${COLORS.border}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    opacity: draggedId === d.id ? 0.4 : 1,
                  }}
                >
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xs, color: COLORS.inkSoft }}>{d.numero}</div>
                  <div style={{ fontSize: TEXT.base, fontWeight: 600, margin: '4px 0' }}>{d.clientPrenom} {d.clientNom}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Badge tone={statutTone[d.statut] || 'blue'}>{t(`devis.statut.${d.statut}`, { defaultValue: d.statut })}</Badge>
                    <span style={{ fontSize: TEXT.sm, fontWeight: 700 }}>{d.devise && d.devise !== deviseEntreprise ? previewMoney(locale, d.devise, d.total) : fmtMoney(d.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Activités planifiées — équivalent simplifié d'un modèle d'activité standard (voir
// server/src/db/migrate.js et project_erp_round2_kanban_chatter_activites). Composant
// partagé, rattachable à n'importe quelle ressource via ressourceType/ressourceId — utilisé
// ici par la popup de détail d'un devis et le panneau de détail d'un contact.
// Marge d'un devis — total moins le coût de revient des lignes dont l'article est identifié
// (stockId résolu vers un produit du catalogue ayant un coût renseigné). Les lignes sans
// stockId (produit en texte libre) ou dont l'article n'a pas de coût renseigné ne contribuent
// simplement pas au coût total, comme dans un ERP de référence (une ligne de service sans coût n'entre pas
// dans le calcul non plus) — retourne null si aucune ligne n'a de coût connu, pour ne rien
// afficher plutôt qu'une marge trompeuse basée sur un total partiel.
// Montant d une ligne du ledger des ventes (GET /devis/ledger), TOUJOURS en devise
// entreprise : les lignes de devis sont stockees dans la devise de LEUR devis, donc
// quantite x prix ne peut pas etre somme entre plusieurs devis. Le serveur fournit
// montantDeviseEntreprise pour cela ; le repli couvre les lignes d achats (jamais en
// devise etrangere, achats_documents n a pas de colonne devise) et toute reponse
// anterieure a ce champ.
function montantLigneEntreprise(l) {
  if (l && l.montantDeviseEntreprise != null) return Number(l.montantDeviseEntreprise);
  return (Number(l && l.quantite) || 0) * (Number(l && l.prixUnitaire) || 0);
}

function computeMarge(devis, catalogItems) {
  if (!devis || !Array.isArray(devis.lignes)) return null;
  let coutTotal = 0;
  let uneLigneAvecCout = false;
  for (const l of devis.lignes) {
    if (l.type === 'section' || !l.stockId) continue;
    const produit = catalogItems.find(item => item.id === l.stockId);
    if (!produit || produit.cout == null) continue;
    uneLigneAvecCout = true;
    coutTotal += Number(l.quantite) * Number(produit.cout);
  }
  if (!uneLigneAvecCout) return null;
  // `produit.cout` est en devise entreprise, alors que `devis.total` est dans la devise du
  // devis : on ramène donc la vente en devise entreprise avant de soustraire, sinon un devis
  // en euros se voyait retrancher un coût en francs CFA (marge absurde). La marge affichée
  // est par construction en devise entreprise — c'est un indicateur interne.
  const totalCompany = devis.totalDeviseEntreprise != null ? devis.totalDeviseEntreprise : devis.total;
  const marge = totalCompany - coutTotal;
  const pourcentage = totalCompany > 0 ? (marge / totalCompany) * 100 : 0;
  return { marge, pourcentage };
}

// Barre de statut en chevrons, inspirée d'un widget statusbar de référence (voir
// addons/web/static/src/views/fields/statusbar/statusbar_field.scss dans le clone local) —
// version simplifiée en clip-path plutôt que la géométrie exacte avec compensation de
// bordure qu'utilise un ERP de référence, pour un effet visuel proche sans la complexité. Les statuts
// post-facturation (Non payé/Payé partiellement/Payé) sont regroupés sous "Facturé" —
// même principe de regroupement que les colonnes de DevisKanban plus haut.
const DEVIS_STATUT_STEPS = [
  { key: 'Brouillon', matches: ['Brouillon', 'Devis'] },
  { key: 'Envoyé', matches: ['Envoyé'] },
  { key: 'Signé', matches: ['Signé'] },
  { key: 'Facturé', matches: ['Facturé', 'Non payé', 'Payé partiellement', 'Payé'] },
];
const CHEVRON_NOTCH = 12;

// Rendu générique des chevrons : la géométrie ne dépend d'aucun métier, seules la liste des
// étapes et la clé de traduction changent. Partagé entre devis et achats plutôt que recopié —
// c'était déjà la troisième copie de cette forme dans le projet (voir aussi MoveStatusBar dans
// FacturesModule, qui garde la sienne parce qu'elle est en CSS et calée au pixel sur l'ERP
// de référence).
function StatusBarChevrons({ steps, statut, cleTraduction }) {
  const { t } = useTranslation();
  const activeIndex = steps.findIndex(s => s.matches.includes(statut));
  return (
    <div style={{ display: 'flex' }}>
      {steps.map((step, i) => {
        const isActive = i === activeIndex;
        const isFirst = i === 0;
        const isLast = i === steps.length - 1;
        let clipPath;
        if (isFirst && isLast) clipPath = 'none';
        else if (isFirst) clipPath = `polygon(0 0, calc(100% - ${CHEVRON_NOTCH}px) 0, 100% 50%, calc(100% - ${CHEVRON_NOTCH}px) 100%, 0 100%)`;
        else if (isLast) clipPath = `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${CHEVRON_NOTCH}px 50%)`;
        else clipPath = `polygon(0 0, calc(100% - ${CHEVRON_NOTCH}px) 0, 100% 50%, calc(100% - ${CHEVRON_NOTCH}px) 100%, 0 100%, ${CHEVRON_NOTCH}px 50%)`;
        return (
          <div key={step.key} style={{
            clipPath, marginLeft: isFirst ? 0 : -CHEVRON_NOTCH,
            padding: `6px ${CHEVRON_NOTCH + 6}px`, fontSize: TEXT.sm, fontWeight: 600, whiteSpace: 'nowrap',
            background: isActive ? COLORS.green : COLORS.surfaceAlt,
            color: isActive ? '#fff' : COLORS.inkSoft,
            position: 'relative', zIndex: isActive ? 2 : 1,
          }}>
            {t(`${cleTraduction}.${step.key}`)}
          </div>
        );
      })}
    </div>
  );
}

function DevisStatusBar({ statut }) {
  const { t } = useTranslation();
  // "Annulé" est un statut terminal hors chaîne (voir routes/devis.js:POST /:id/annuler) —
  // aucune étape des chevrons ne doit s'y allumer, un badge rouge à part le montre clairement
  // plutôt qu'une barre à chevrons sans étape active (ambigu, pourrait passer pour une erreur).
  if (statut === 'Annulé') {
    return <Badge tone="red">{t('devis.statut.Annulé')}</Badge>;
  }
  return <StatusBarChevrons steps={DEVIS_STATUT_STEPS} statut={statut} cleTraduction="devis.statut" />;
}

// Axe COMMANDE seul — l'état de réception vit sur son propre axe depuis le 2026-09-10, comme
// `receipt_status` dans l'ERP de référence. Mélanger les deux dans une seule barre de chevrons
// était précisément le défaut corrigé : « Reçu » y était à la fois une étape de commande et un
// constat de livraison.
const ACHAT_STATUT_STEPS = [
  { key: 'Brouillon', matches: ['Brouillon'] },
  { key: 'Envoyée', matches: ['Envoyée'] },
  { key: 'Commandé', matches: ['Commandé'] },
];

// Annulée est terminal, hors chaîne : aucun chevron ne doit s'allumer, un badge rouge le dit
// plus clairement (même traitement que DevisStatusBar).
function AchatStatusBar({ statut }) {
  const { t } = useTranslation();
  if (statut === 'Annulée') return <Badge tone="red">{t('achats.statut.Annulée')}</Badge>;
  return <StatusBarChevrons steps={ACHAT_STATUT_STEPS} statut={statut} cleTraduction="achats.statut" />;
}

// L'axe réception, rendu séparément — c'est lui qui commande stock et finances.
const TON_RECEPTION = { en_attente: 'ochre', partiel: 'blue', recu: 'green' };
function BadgeReception({ etat }) {
  const { t } = useTranslation();
  const valeur = etat || 'en_attente';
  return <Badge tone={TON_RECEPTION[valeur] || 'blue'}>{t(`achats.reception.${valeur}`)}</Badge>;
}

function ActivitesSection({ ressourceType, ressourceId }) {
  const { t } = useTranslation();
  const { fmtDate } = useLocale();
  const [activites, setActivites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [titre, setTitre] = useState('');
  const [dateEcheance, setDateEcheance] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { activites: loaded } = await getActivites(ressourceType, ressourceId);
        if (!cancelled) setActivites(loaded || []);
      } catch (err) {
        console.error('[ActivitesSection]', err);
        if (!cancelled) setActivites([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ressourceType, ressourceId]);

  const submit = async (e) => {
    e.preventDefault();
    if (!titre.trim()) return;
    setSaving(true);
    try {
      const { activite } = await createActivite({ ressourceType, ressourceId, titre: titre.trim(), dateEcheance: dateEcheance || null });
      setActivites(a => [activite, ...a]);
      setTitre('');
      setDateEcheance('');
    } catch (err) {
      notifyError(err, t('activites.addError'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (activite) => {
    try {
      const { activite: updated } = await updateActivite(activite.id, !activite.termine);
      setActivites(a => a.map(x => x.id === updated.id ? updated : x));
    } catch (err) {
      notifyError(err, t('activites.updateError'));
    }
  };

  const remove = async (id) => {
    try {
      await deleteActivite(id);
      setActivites(a => a.filter(x => x.id !== id));
    } catch (err) {
      notifyError(err, t('activites.deleteError'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, textAlign: 'left' }}>
      <div style={{ fontSize: TEXT.sm, fontWeight: 700, color: COLORS.inkSoft }}>{t('activites.title')}</div>
      <form onSubmit={submit} style={{ display: 'flex', gap: SPACE.sm }}>
        <input
          className="flat-input"
          placeholder={t('activites.placeholder')}
          value={titre}
          onChange={e => setTitre(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          className="flat-input"
          type="date"
          value={dateEcheance}
          onChange={e => setDateEcheance(e.target.value)}
          style={{ width: 'auto' }}
        />
        <Button small type="submit" variant="green" disabled={saving}>
          {saving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
        </Button>
      </form>
      {loading ? (
        <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{t('common.loading')}</div>
      ) : activites.length === 0 ? (
        <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{t('activites.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
          {activites.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.sm, opacity: a.termine ? 0.5 : 1 }}>
              <input type="checkbox" checked={a.termine} onChange={() => toggle(a)} style={{ cursor: 'pointer' }} />
              <span style={{ flex: 1, textDecoration: a.termine ? 'line-through' : 'none' }}>{a.titre}</span>
              {a.dateEcheance && <span style={{ color: COLORS.inkSoft, fontSize: TEXT.xs }}>{fmtDate(a.dateEcheance)}</span>}
              <button onClick={() => remove(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, display: 'flex' }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DevisModule({ clientsListe, filtreStatut }) {
  // Les grilles de la fiche et des formulaires sont figées à deux colonnes : sur un téléphone,
  // cela donne deux colonnes de 160 px où un champ de date ou un montant ne tient pas.
  const etroitDevis = useAffichageEtroit();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { fmtMoney, fmtDate, locale, devise: deviseEntreprise } = useLocale();
  // Un devis peut être libellé dans la devise de son client : ses lignes, ses sous-totaux et
  // ses échéances sont alors dans CETTE devise, pas celle de l'entreprise. Seuls l'équivalent
  // « devise entreprise » et la marge (calculée sur un coût catalogue) restent en fmtMoney.
  const enDevise = (montant, devise) => (devise && devise !== deviseEntreprise ? previewMoney(locale, devise, montant) : fmtMoney(montant));
  const [devisListe, setDevisListe] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState('');

  const emptyLigne = { produit: '', type: 'produit', quantite: '', prixUnitaire: '', remisePourcentage: '', taxIds: [], unite: '', recolteId: '', stockId: null, stockModule: null, uomId: null };
  const emptySectionLigne = { produit: '', type: 'section', quantite: '', prixUnitaire: '', remisePourcentage: '', taxIds: [], unite: '', recolteId: '', stockId: null, stockModule: null, uomId: null };
  const [form, setForm] = useState({ clientId: '', notes: '', validityDate: '', lignes: [{ ...emptyLigne }] });
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const taxById = useMemo(() => new Map((taxes || []).map(tx => [tx.id, tx])), [taxes]);
  const [draggedLigneIndex, setDraggedLigneIndex] = useState(null);
  const [draggedEditLigneIndex, setDraggedEditLigneIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [recoltes, setRecoltes] = useState([]);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ clientId: '', notes: '', lignes: [{ ...emptyLigne }] });
  const [editSaving, setEditSaving] = useState(false);

  // Sélection du client au clavier (champ texte + <datalist>, même mécanique que le
  // champ Produit) — `clientId` reste la source de vérité envoyée au backend, le texte
  // saisi n'est qu'un moyen de le résoudre. `clientSearch`/`editClientSearch` = texte
  // affiché dans le champ, tenu synchro avec le client sélectionné.
  const [clientSearch, setClientSearch] = useState('');
  const [editClientSearch, setEditClientSearch] = useState('');
  const clientLabel = (c) => (c && c.prenom ? `${c.prenom} ${c.nom}` : (c ? c.nom : ''));
  const findClientById = (id) => (clientsListe || []).find(c => String(c.id) === String(id)) || null;
  const findClientByLabel = (label) => {
    const q = (label || '').trim().toLowerCase();
    if (!q) return null;
    return (clientsListe || []).find(c => clientLabel(c).toLowerCase() === q) || null;
  };

  const [detailId, setDetailId] = useState(null); // devis actuellement affiché en détail
  const [detailData, setDetailData] = useState(null);
  const [journal, setJournal] = useState([]);
  const [actionBusy, setActionBusy] = useState(false);
  // Édition locale des quantités livrée/facturée par ligne (popup de détail) — clé
  // ligne.id, initialisée depuis les valeurs serveur à chaque (ré)ouverture du détail.
  const [quantitesEdit, setQuantitesEdit] = useState({});
  const [quantitesSaving, setQuantitesSaving] = useState(false);
  // Onglets façon ERP au-dessus du tableau de lignes, dans la popup de détail
  const [detailTab, setDetailTab] = useState('lignes');
  // Remise globale / taxe / conditions de paiement / livraison promise, éditables
  // seulement tant que le devis est en Brouillon — voir handleSaveDetailMeta.
  const emptyDetailMeta = { remiseGlobale: '0', conditionsPaiement: '', livraisonPromise: '', validityDate: '' };
  const [detailMeta, setDetailMeta] = useState(emptyDetailMeta);
  const [detailMetaSaving, setDetailMetaSaving] = useState(false);
  // Fil de messages (chatter minimal) attaché au devis affiché en détail
  const [messages, setMessages] = useState([]);
  const [nouveauMessage, setNouveauMessage] = useState('');
  const [messageSaving, setMessageSaving] = useState(false);
  // Popup demandant le mode et la modalité de paiement avant de valider la facturation
  const [paiementPopupOpen, setPaiementPopupOpen] = useState(false);
  const [paiementDevisId, setPaiementDevisId] = useState(null);
  const emptyEcheance = { montant: '', dateEcheance: '' };
  const [paiementForm, setPaiementForm] = useState({ modePaiement: 'Espèces', modalitePaiement: 'complet', echeances: [{ ...emptyEcheance }] });
  const [vueDevis, setVueDevis] = useState('liste');
  // Modèle liste-puis-formulaire de l'ERP de référence : l'écran est la liste, et créer passe
  // par un bouton qui l'échange contre le formulaire.
  //
  // Le document ouvert vit dans l'URL (?devis=12, ?devis=nouveau), pas dans un état local :
  // un rechargement rouvre la même fiche, le bouton retour du navigateur referme, et un lien
  // se partage. C'est le principe déjà appliqué à l'écran et à l'onglet dans le shell.
  const [devisUrl, setDevisUrl] = useParametreUrl('devis');
  const creationOuverte = devisUrl === 'nouveau';
  const enFiche = Boolean(detailId);
  const enFormulaire = creationOuverte || enFiche || Boolean(editingId);
  const retourListe = () => { cancelEditDevis(); setDevisUrl(null); };

  // L'URL commande, la fiche suit. Un seul sens de dépendance : sans cela, ouvrir une fiche
  // écrirait dans deux endroits qui pourraient diverger.
  useEffect(() => {
    if (!devisUrl || devisUrl === 'nouveau') {
      if (detailId) { setDetailId(null); setDetailData(null); setJournal([]); setMessages([]); }
      return;
    }
    const id = Number(devisUrl);
    if (id && id !== detailId) openDetail(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devisUrl]);

  const loadDevis = async () => {
    setLoading(true);
    try {
      const data = await getDevisListe();
      setDevisListe(data.devis || []);
    } catch (err) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDevis(); }, []);
  useEffect(() => { getPaymentTerms().then(d => setPaymentTerms(d.paymentTerms || [])).catch(() => {}); }, []);
  const rechargerTaxes = () => getTaxes().then(d => setTaxes(d.taxes || [])).catch(() => {});
  useEffect(() => { rechargerTaxes(); }, []);

  // Base HT réelle + montant de taxe d'une ligne — voir src/lib/taxes.js (partagé avec
  // FacturesModule). Fermeture sur le référentiel `taxById` de ce module.
  const taxesLigneCalc = (baseHT, quantite, taxIds) => taxesLigneCalcPure(baseHT, quantite, taxIds, taxById);

  // Résumé lisible des lignes d'une condition de paiement (ex: "30 % à J+0 · solde à J+30").
  const resumeTerme = (term) => (term.lignes || []).map(l => {
    const part = l.value === 'percent' ? `${l.valueAmount} %` : l.value === 'fixed' ? fmtMoney(l.valueAmount) : t('paymentTerms.solde');
    const when = l.delayType === 'days_after_end_of_month'
      ? t('paymentTerms.finDeMois', { n: l.nbDays })
      : (l.nbDays === 0 ? t('paymentTerms.immediat') : `J+${l.nbDays}`);
    return `${part} ${when}`;
  }).join(' · ');

  useEffect(() => {
    (async () => {
      try {
        const { recoltes } = await getRecoltes();
        setRecoltes(recoltes || []);
      } catch (err) {
        console.error('[DevisModule recoltes]', err);
      }
    })();
  }, []);

  // Catalogue produit : un devis n'est pas rattaché à un module (contrairement à un
  // achat), donc les suggestions combinent les produits Cultures ET Poulailler — un seul
  // appel depuis la fusion produits (2026-08-18), chaque item porte déjà son propre
  // `module` (plus besoin de le retagger manuellement en _stockModule).
  const [catalogItems, setCatalogItems] = useState([]);
  const catalogDatalistId = 'devis-catalog';
  useEffect(() => {
    (async () => {
      try {
        const { stocks } = await getProduits();
        setCatalogItems(stocks || []);
      } catch (err) {
        console.error('[DevisModule catalog]', err);
      }
    })();
  }, []);

  // Ajoute une ligne de produit vide au formulaire
  // Réordonnancement par glisser-déposer — la colonne `ordre` de devis_lignes existe déjà
  // (attribuée depuis l'index du tableau au moment de la soumission), donc réordonner ici
  // avant d'envoyer suffit, pas besoin d'API dédiée.
  const moveLigne = (from, to) => setForm(f => {
    const lignes = [...f.lignes];
    const [moved] = lignes.splice(from, 1);
    lignes.splice(to, 0, moved);
    return { ...f, lignes };
  });
  const moveEditLigne = (from, to) => setEditForm(f => {
    const lignes = [...f.lignes];
    const [moved] = lignes.splice(from, 1);
    lignes.splice(to, 0, moved);
    return { ...f, lignes };
  });
  const addLigne = () => setForm(f => ({ ...f, lignes: [...f.lignes, { ...emptyLigne }] }));
  // Ajoute une ligne de section (titre seul, sans quantité/prix — pur repère visuel dans le document)
  const addSectionLigne = () => setForm(f => ({ ...f, lignes: [...f.lignes, { ...emptySectionLigne }] }));

  // Supprime une ligne précise du formulaire (garde toujours au moins une ligne)
  const removeLigne = (index) => setForm(f => ({ ...f, lignes: f.lignes.filter((_, i) => i !== index) }));

  const updateLigne = (index, field, value) => {
    setForm(f => ({
      ...f,
      lignes: f.lignes.map((l, i) => i === index ? { ...l, [field]: value } : l),
    }));
  };

  // Une section n'entre jamais dans le total (quantité/prix toujours à 0 pour ce type).
  const ligneTotal = (l) => {
    if (l.type === 'section') return 0;
    const sousTotal = (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0);
    return sousTotal * (1 - (Number(l.remisePourcentage) || 0) / 100);
  };
  // Montant HT + taxe de la ligne (pas de remise globale ici : elle ne se règle qu'après
  // création, dans la popup de détail — voir handleSaveDetailMeta).
  const ligneTotalAvecTaxe = (l) => {
    const { base, taxe } = taxesLigneCalc(ligneTotal(l), l.quantite, l.taxIds);
    return base + taxe;
  };
  const totalForm = form.lignes.reduce((s, l) => s + ligneTotalAvecTaxe(l), 0);
  const totalEditForm = editForm.lignes.reduce((s, l) => s + ligneTotalAvecTaxe(l), 0);
  // Style commun des cellules éditables du tableau de lignes (add-form + edit-modal) —
  // volontairement sans bordure/boîte individuelle par champ (contrairement à l'ancien
  // rendu en grille de <Field>), pour une seule ligne de tableau continue façon ERP.
  const ligneCellInputStyle = { width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: TEXT.base, color: COLORS.ink, padding: 0 };

  // Carte de coordonnées affichée dès qu'un client est sélectionné (formulaire de
  // création + modale de modification) — bâtie sur les données déjà chargées par
  // getContacts('client'), sans appel supplémentaire.
  const renderClientCard = (client) => {
    if (!client) return null;
    const lignesAdresse = [
      client.adresseRue,
      [client.adresseCodePostal, client.adresseVille].filter(Boolean).join(' '),
      client.adressePays,
    ].filter(Boolean);
    const adresseLibre = lignesAdresse.length === 0 && client.adresse ? client.adresse : null;
    return (
      <div style={{ marginTop: SPACE.sm, padding: '8px 10px', borderRadius: RADIUS.card, background: COLORS.surfaceAlt, fontSize: TEXT.sm, color: COLORS.inkSoft, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div style={{ fontWeight: 600, color: COLORS.ink, display: 'flex', alignItems: 'center', gap: SPACE.xs }}>
          {client.isCompany ? <Building2 size={13} /> : <UserIcon size={13} />}
          {clientLabel(client)}
        </div>
        {client.email && <div>{client.email}</div>}
        {client.telephone && <div>{client.telephone}</div>}
        {lignesAdresse.map((l, i) => <div key={i}>{l}</div>)}
        {adresseLibre && <div>{adresseLibre}</div>}
      </div>
    );
  };

  const resetForm = () => {
    setForm({ clientId: '', notes: '', validityDate: '', lignes: [{ ...emptyLigne }] });
    setClientSearch('');
  };

  const submitForm = async (e) => {
    e.preventDefault();
    if (!form.clientId || form.lignes.some(l => !l.produit || (l.type !== 'section' && (l.quantite === '' || l.prixUnitaire === '')))) {
      setApiError(t('devis.errRequired'));
      return;
    }
    setSaving(true);
    setApiError('');
    try {
      const payload = {
        clientId: Number(form.clientId),
        notes: form.notes,
        validityDate: form.validityDate || undefined,
        lignes: form.lignes.map(l => ({
          produit: l.produit,
          type: l.type === 'section' ? 'section' : 'produit',
          quantite: Number(l.quantite) || 0,
          prixUnitaire: Number(l.prixUnitaire) || 0,
          remisePourcentage: Number(l.remisePourcentage) || 0,
          taxIds: Array.isArray(l.taxIds) ? l.taxIds.map(Number).filter(Boolean) : [],
          unite: l.unite || null,
          recolteId: l.recolteId ? Number(l.recolteId) : null,
          stockId: l.stockId || null,
          stockModule: l.stockModule || null,
          uomId: l.uomId || null,
        })),
      };
      await createDevis(payload);
      notifySuccess(t('devis.created'));
      resetForm();
      // Retour à la liste : le devis créé y apparaît, ce que le formulaire remis à zéro ne
      // montrait pas. L'ERP de référence reste sur la fiche du document enregistré ; ici le
      // formulaire de création ne devient pas une fiche, la liste est le repère le plus proche.
      setDevisUrl(null);
      await loadDevis();
    } catch (err) {
      setApiError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Ligne de produits — version formulaire de modification (fenêtre séparée)
  const addEditLigne = () => setEditForm(f => ({ ...f, lignes: [...f.lignes, { ...emptyLigne }] }));
  const addSectionEditLigne = () => setEditForm(f => ({ ...f, lignes: [...f.lignes, { ...emptySectionLigne }] }));
  const removeEditLigne = (index) => setEditForm(f => ({ ...f, lignes: f.lignes.filter((_, i) => i !== index) }));
  const updateEditLigne = (index, field, value) => {
    setEditForm(f => ({
      ...f,
      lignes: f.lignes.map((l, i) => i === index ? { ...l, [field]: value } : l),
    }));
  };

  const cancelEditDevis = () => {
    setEditingId(null);
    setEditForm({ clientId: '', statut: '', notes: '', lignes: [{ ...emptyLigne }] });
    setEditClientSearch('');
  };

  const startEditDevis = async (d) => {
    // Aligné sur Odoo : un devis signé mais pas encore facturé reste éditable (ajout
    // d'articles). Le backend réajuste le stock réservé ; dès "Facturé", verrouillé.
    if (!['Brouillon', 'Devis', 'Signé'].includes(d.statut)) return;
    try {
      const data = await getDevisDetail(d.id);
      const devisComplet = data.devis;
      setEditingId(devisComplet.id);
      setEditForm({
        clientId: String(devisComplet.clientId),
        statut: devisComplet.statut,
        notes: devisComplet.notes || '',
        lignes: devisComplet.lignes.map(l => ({ produit: l.produit, type: l.type === 'section' ? 'section' : 'produit', quantite: l.quantite, prixUnitaire: l.prixUnitaire, remisePourcentage: l.remisePourcentage || '', taxIds: Array.isArray(l.taxIds) ? l.taxIds : [], unite: l.unite || '', recolteId: l.recolteId || '', stockId: l.stockId || null, stockModule: l.stockModule || null, uomId: l.uomId || null })),
      });
      const c = findClientById(devisComplet.clientId);
      setEditClientSearch(c ? clientLabel(c) : (devisComplet.clientPrenom ? `${devisComplet.clientPrenom} ${devisComplet.clientNom}` : (devisComplet.clientNom || '')));
    } catch (err) {
      setApiError(err.message);
    }
  };

  const submitEditForm = async (e) => {
    e.preventDefault();
    if (!editForm.clientId || editForm.lignes.some(l => !l.produit || (l.type !== 'section' && (l.quantite === '' || l.prixUnitaire === '')))) {
      setApiError(t('devis.errRequired'));
      return;
    }
    setEditSaving(true);
    setApiError('');
    try {
      const payload = {
        clientId: Number(editForm.clientId),
        notes: editForm.notes,
        lignes: editForm.lignes.map(l => ({
          produit: l.produit,
          type: l.type === 'section' ? 'section' : 'produit',
          quantite: Number(l.quantite) || 0,
          prixUnitaire: Number(l.prixUnitaire) || 0,
          remisePourcentage: Number(l.remisePourcentage) || 0,
          taxIds: Array.isArray(l.taxIds) ? l.taxIds.map(Number).filter(Boolean) : [],
          unite: l.unite || null,
          recolteId: l.recolteId ? Number(l.recolteId) : null,
          stockId: l.stockId || null,
          stockModule: l.stockModule || null,
          uomId: l.uomId || null,
        })),
      };
      await updateDevis(editingId, payload);
      notifySuccess(t('devis.updated'));
      cancelEditDevis();
      await loadDevis();
    } catch (err) {
      setApiError(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const openDetail = async (id) => {
    setDetailId(id);
    setDetailTab('lignes');
    try {
      const data = await getDevisDetail(id);
      setDetailData(data.devis);
      const map = {};
      (data.devis.lignes || []).forEach(l => {
        if (l.type !== 'section') map[l.id] = { quantiteLivree: l.quantiteLivree || 0, quantiteFacturee: l.quantiteFacturee || 0 };
      });
      setQuantitesEdit(map);
      setDetailMeta({
        remiseGlobale: String(data.devis.remiseGlobale ?? 0),
        conditionsPaiement: data.devis.conditionsPaiement || '',
        livraisonPromise: data.devis.livraisonPromise ? data.devis.livraisonPromise.slice(0, 10) : '',
        validityDate: data.devis.validityDate ? data.devis.validityDate.slice(0, 10) : '',
      });
    } catch (err) {
      setApiError(err.message);
    }
    getDevisJournal(id).then(d => setJournal(d.changements || [])).catch(() => setJournal([]));
    getMessages('devis', id).then(d => setMessages(d.messages || [])).catch(() => setMessages([]));
  };

  const handleSaveDetailMeta = async () => {
    setDetailMetaSaving(true);
    try {
      await updateDevis(detailData.id, {
        remiseGlobale: Number(detailMeta.remiseGlobale) || 0,
        conditionsPaiement: detailMeta.conditionsPaiement,
        livraisonPromise: detailMeta.livraisonPromise || null,
        validityDate: detailMeta.validityDate || null,
      });
      notifySuccess(t('devis.updated'));
      await loadDevis();
      await openDetail(detailData.id);
    } catch (err) {
      notifyError(err, t('devis.updateMetaError'));
    } finally {
      setDetailMetaSaving(false);
    }
  };

  const handleEnvoyerMessage = async () => {
    if (!nouveauMessage.trim()) return;
    setMessageSaving(true);
    try {
      await createMessage({ ressourceType: 'devis', ressourceId: detailData.id, contenu: nouveauMessage.trim() });
      setNouveauMessage('');
      const d = await getMessages('devis', detailData.id);
      setMessages(d.messages || []);
    } catch (err) {
      notifyError(err, t('devis.sendMessageError'));
    } finally {
      setMessageSaving(false);
    }
  };

  const handleAnnuler = async (id) => {
    if (!window.confirm(t('devis.confirmAnnuler'))) return;
    setActionBusy(true);
    try {
      await annulerDevis(id);
      notifySuccess(t('devis.annule'));
      await loadDevis();
      if (detailId === id) await openDetail(id);
    } catch (err) {
      notifyError(err, t('devis.annulerError'));
    } finally {
      setActionBusy(false);
    }
  };

  const updateQuantiteEdit = (ligneId, field, value) => {
    setQuantitesEdit(m => ({ ...m, [ligneId]: { ...m[ligneId], [field]: value } }));
  };

  const handleSaveQuantites = async () => {
    setQuantitesSaving(true);
    try {
      const lignes = Object.entries(quantitesEdit).map(([id, q]) => ({
        id: Number(id),
        quantiteLivree: Number(q.quantiteLivree) || 0,
        quantiteFacturee: Number(q.quantiteFacturee) || 0,
      }));
      await updateDevisLigneQuantites(detailData.id, lignes);
      notifySuccess(t('devis.quantitesUpdated'));
      await openDetail(detailData.id);
    } catch (err) {
      notifyError(err, t('devis.quantitesError'));
    } finally {
      setQuantitesSaving(false);
    }
  };

  const handleEnvoyer = async (id) => {
    setActionBusy(true);
    try {
      await envoyerDevis(id);
      notifySuccess(t('devis.sent'));
      await loadDevis();
      if (detailId === id) await openDetail(id);
    } catch (err) {
      notifyError(err, t('devis.sendError'));
    } finally {
      setActionBusy(false);
    }
  };

  // Envoi par WhatsApp. Deux chemins, et un seul permet de joindre le PDF :
  //
  //   1. Le partage natif du système (Web Share API) joint le fichier pour de vrai, mais laisse
  //      l'utilisateur choisir le contact dans WhatsApp. Disponible sur mobile, c'est-à-dire là
  //      où on envoie une facture par WhatsApp.
  //   2. Le lien click-to-chat cible le numéro du client mais ne transporte QUE du texte.
  //
  // Aucun des deux ne fait les deux — c'est une limite de WhatsApp, pas du code. On tente donc le
  // partage d'abord (la pièce jointe est ce qui est demandé) et on retombe sur le lien s'il n'est
  // pas disponible. Le serveur, lui, ne fait que préparer le lien public et le message.
  const handleEnvoyerWhatsapp = async (id) => {
    setActionBusy(true);
    try {
      const { telephone, message } = await preparerLienWhatsapp(id);

      // Le PDF est préparé avant de départager : un échec de génération doit se voir, pas passer
      // silencieusement au repli comme si de rien n'était.
      let fichier = null;
      try {
        fichier = await getDevisPdfFile(id);
      } catch (err) {
        console.error('[DevisModule whatsapp pdf]', err);
      }

      if (fichier) {
        const resultat = await partagerFichier(fichier, message);
        // Annulé = l'utilisateur a fermé la feuille de partage : enchaîner sur le lien serait
        // exactement le contraire de ce qu'il vient de demander.
        if (resultat === 'annule') return;
        if (resultat === 'partage') {
          notifySuccess(t('devis.whatsappPartage'));
          await load();
          if (detailId === id) await openDetail(id);
          return;
        }
      }

      // Repli : le numéro doit être au format international — on ne devine pas l'indicatif, un
      // mauvais numéro ouvrirait une conversation avec un inconnu.
      const num = normaliserNumeroWhatsapp(telephone);
      if (!num.ok) {
        notifyError(new Error(t(`devis.whatsappNumero.${num.raison}`)), t('devis.whatsappErreur'));
        return;
      }
      window.open(lienWhatsapp(num.numero, message), '_blank', 'noopener');
      notifySuccess(t('devis.whatsappOuvert'));
      await load();
      if (detailId === id) await openDetail(id);
    } catch (err) {
      notifyError(err, t('devis.whatsappErreur'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleValiderManuel = async (id) => {
    const confirmePar = window.prompt(t('devis.promptSignataire'));
    if (!confirmePar || !confirmePar.trim()) return;
    setActionBusy(true);
    try {
      await validerDevisManuel(id, confirmePar);
      notifySuccess(t('devis.validatedManual'));
      await loadDevis();
      if (detailId === id) await openDetail(id);
    } catch (err) {
      notifyError(err, t('devis.validateError'));
    } finally {
      setActionBusy(false);
    }
  };

  // Ouvre la popup de paiement avant conversion en facture
  const openPaiementPopup = (id, total) => {
    setPaiementDevisId(id);
    setPaiementForm({ modePaiement: 'Espèces', modalitePaiement: 'complet', echeances: [{ montant: total, dateEcheance: '' }], paymentTermId: '', acompteMethod: '', acompteValue: '' });
    setPaiementPopupOpen(true);
  };

  const addEcheance = () => setPaiementForm(f => ({ ...f, echeances: [...f.echeances, { ...emptyEcheance }] }));
  const removeEcheance = (i) => setPaiementForm(f => ({ ...f, echeances: f.echeances.filter((_, idx) => idx !== i) }));
  const updateEcheance = (i, field, value) => {
    setPaiementForm(f => ({ ...f, echeances: f.echeances.map((e, idx) => idx === i ? { ...e, [field]: value } : e) }));
  };

  const submitFacturer = async () => {
    const parTerme = !!paiementForm.paymentTermId;
    if (!parTerme && paiementForm.modalitePaiement === 'echelonne' && paiementForm.echeances.some(e => !e.montant || !e.dateEcheance)) {
      notifyError(new Error(t('devis.echeancesIncompletes')));
      return;
    }
    setActionBusy(true);
    try {
      const payload = parTerme
        ? {
            modePaiement: paiementForm.modePaiement,
            paymentTermId: Number(paiementForm.paymentTermId),
            acompte: paiementForm.acompteMethod && Number(paiementForm.acompteValue) > 0
              ? { method: paiementForm.acompteMethod, value: Number(paiementForm.acompteValue) }
              : undefined,
          }
        : {
            modePaiement: paiementForm.modePaiement,
            modalitePaiement: paiementForm.modalitePaiement,
            echeances: paiementForm.modalitePaiement === 'echelonne' ? paiementForm.echeances : undefined,
          };
      await facturerDevis(paiementDevisId, payload);
      notifySuccess(t('devis.facture'));
      setPaiementPopupOpen(false);
      await loadDevis();
      if (detailId === paiementDevisId) await openDetail(paiementDevisId);
    } catch (err) {
      notifyError(err, t('devis.factureError'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemettreBrouillon = async (id) => {
    if (!window.confirm(t('devis.confirmRemettreBrouillon'))) return;
    setActionBusy(true);
    try {
      await remettreDevisBrouillon(id);
      notifySuccess(t('devis.remisBrouillon'));
      await loadDevis();
      if (detailId === id) await openDetail(id);
    } catch (err) {
      notifyError(err, t('devis.remettreBrouillonError'));
    } finally {
      setActionBusy(false);
    }
  };

  const handlePayerEcheance = async (devisId, echeanceId) => {
    if (!window.confirm(t('devis.confirmPayerEcheance'))) return;
    setActionBusy(true);
    try {
      await payerEcheance(devisId, echeanceId);
      notifySuccess(t('devis.echeancePayee'));
      await loadDevis();
      await openDetail(devisId);
    } catch (err) {
      notifyError(err, t('devis.echeancePayeeError'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async (id, numero) => {
    if (!window.confirm(t('devis.confirmDelete', { numero }))) return;
    try {
      await deleteDevis(id);
      notifySuccess(t('devis.deleted'));
      await loadDevis();
    } catch (err) {
      notifyError(err, t('devis.deleteError'));
    }
  };

  const statutTone = {
    Brouillon: 'ochre',
    Devis: 'blue',
    'Signé': 'blue',
    'Non payé': 'red',
    'Payé partiellement': 'ochre',
    'Facturé': 'green',
    'Annulé': 'red',
  };

  // "À facturer" (menu d'un ERP de référence) n'est qu'un filtre sur la même liste, pas une ressource
  // séparée — mêmes devis, juste restreints au statut concerné.
  const devisAffiches = filtreStatut ? devisListe.filter(d => d.statut === filtreStatut) : devisListe;

  // Filtres nommés repris de la vue de recherche de l'ERP de référence, adaptés à nos statuts :
  // ce sont les questions qu'on pose vraiment à une liste de devis (« lesquels attendent une
  // signature ? », « lesquels sont à facturer ? »), pas une case par valeur possible.
  const outilsDevis = useListeOutils(devisAffiches, useMemo(() => ({
    rechercheChamps: (d) => [d.numero, d.clientNom, d.clientPrenom, d.total],
    filtres: [
      { id: 'brouillon', labelKey: 'devis.statut.Brouillon', test: (d) => ['Brouillon', 'Devis'].includes(d.statut) },
      { id: 'envoye', labelKey: 'devis.statut.Envoyé', test: (d) => d.statut === 'Envoyé' },
      { id: 'signe', labelKey: 'devis.statut.Signé', test: (d) => d.statut === 'Signé' },
      { id: 'facture', labelKey: 'devis.filtreFacture', test: (d) => ['Facturé', 'Non payé', 'Payé partiellement', 'Payé'].includes(d.statut) },
      { id: 'expire', labelKey: 'devis.expired', test: (d) => Boolean(d.expired) },
    ],
    groupes: [
      { id: 'statut', labelKey: 'common.status', valeur: (d) => d.statut || '—' },
      { id: 'client', labelKey: 'devis.client', valeur: (d) => `${d.clientPrenom || ''} ${d.clientNom || ''}`.trim() || '—' },
      { id: 'mois', labelKey: 'listes.groupeMois', valeur: (d) => (d.date || '').slice(0, 7) || '—' },
    ],
    colonnes: {
      numero: (d) => d.numero,
      date: (d) => d.date,
      client: (d) => `${d.clientPrenom || ''} ${d.clientNom || ''}`.trim(),
      total: (d) => Number(d.total) || 0,
      statut: (d) => d.statut,
    },
    triParDefaut: { colonne: 'date', sens: 'desc' },
  }), []));

  // Colonnes déclarées plutôt qu'un tableau écrit à la main : c'est ce qui permet les sommes en
  // pied, le masquage de colonnes et la sélection multiple. `optionnelle` reprend l'attribut
  // `optional` de la liste de référence ; `masqueeParDefaut` en est le mode "hide".
  const colonnesDevis = useMemo(() => [
    { id: 'numero', labelKey: 'devis.colNumero', triable: true,
      rendu: (d) => <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{d.numero}</span> },
    { id: 'date', labelKey: 'common.date', triable: true,
      rendu: (d) => <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatDateFr(d.date)}</span> },
    { id: 'client', labelKey: 'devis.client', triable: true,
      rendu: (d) => `${d.clientPrenom || ''} ${d.clientNom || ''}`.trim() || '—' },
    { id: 'vendeur', labelKey: 'devis.colVendeur', triable: true, optionnelle: true,
      rendu: (d) => d.vendeurNom || '—' },
    { id: 'validite', labelKey: 'devis.colValidite', triable: true, optionnelle: true, masqueeParDefaut: true,
      rendu: (d) => (d.validityDate ? formatDateFr(d.validityDate) : '—') },
    // Montant aligné à droite et totalisé — dans la référence, une colonne monétaire est
    // toujours à droite, ce qui met les chiffres et leur somme sur le même axe.
    { id: 'total', labelKey: 'common.total', triable: true, alignement: 'right',
      style: { fontWeight: 600 },
      somme: (d) => Number(d.totalDeviseEntreprise ?? d.total) || 0,
      formatSomme: (n) => fmtMoney(n),
      rendu: (d) => enDevise(d.total, d.devise) },
    { id: 'facturation', labelKey: 'devis.colEtatFacturation', optionnelle: true, masqueeParDefaut: true,
      rendu: (d) => (d.etatFacturation
        ? <Badge tone={d.etatFacturation === 'paid' ? 'green' : d.etatFacturation === 'partial' ? 'ochre' : 'blue'}>
            {t(`factures.paymentState.${d.etatFacturation}`, { defaultValue: d.etatFacturation })}
          </Badge>
        : '—') },
    { id: 'statut', labelKey: 'common.status', triable: true,
      rendu: (d) => (
        <>
          <Badge tone={statutTone[d.statut] || 'blue'}>{t(`devis.statut.${d.statut}`, { defaultValue: d.statut })}</Badge>
          {d.expired && <span style={{ marginLeft: SPACE.sm }}><Badge tone="red">{t('devis.expired')}</Badge></span>}
        </>
      ) },
    { id: 'actions', labelKey: 'common.actions', alignement: 'right',
      rendu: (d) => (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: SPACE.sm }} onClick={e => e.stopPropagation()}>
          {['Brouillon', 'Devis', 'Signé'].includes(d.statut) && (
            <button onClick={() => { setDevisUrl(d.id, { remplacer: false }); startEditDevis(d); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue }}><Settings2 size={15} /></button>
          )}
          {d.statut === 'Brouillon' && (
            <button onClick={() => handleDelete(d.id, d.numero)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft }}><Trash2 size={15} /></button>
          )}
        </div>
      ) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, statutTone, enDevise, fmtMoney]);

  // Suppression groupée : une confirmation unique, puis les suppressions une à une sur la route
  // existante. Pas de route « supprimer en lot » côté serveur — un lot qui échoue à mi-chemin
  // laisserait un état partiel plus difficile à expliquer que N appels indépendants.
  const handleDeleteLot = async (documents) => {
    if (!window.confirm(t('devis.confirmSupprimerLot', { count: documents.length }))) return;
    let echecs = 0;
    for (const d of documents) {
      try {
        await deleteDevis(d.id);
      } catch (err) {
        echecs += 1;
        console.error('[handleDeleteLot]', err);
      }
    }
    outilsDevis.viderSelection();
    await loadDevis();
    if (echecs > 0) notifyError(new Error(t('devis.supprimerLotEchec', { count: echecs })));
    else notifySuccess(t('devis.supprimerLotOk', { count: documents.length }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <datalist id={catalogDatalistId}>
        {catalogItems.map(item => <option key={`${item.module}-${item.id}`} value={item.nom} />)}
      </datalist>
      <datalist id="devis-clients-datalist">
        {(clientsListe || []).map(c => <option key={c.id} value={clientLabel(c)} />)}
      </datalist>

      {/* Fil d'ariane local. L'ERP de référence remonte le nom du document dans le fil
          d'ariane de l'application ; celui-ci s'arrête à l'onglet (voir TopNavbar), donc la
          fiche porte le sien plutôt que de laisser l'utilisateur sans repère ni retour. */}
      {enFormulaire && (
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
          <Button variant="ghost" small onClick={retourListe}><ChevronLeft size={14} /> {t("devis.retourListe")}</Button>
          <span style={{ fontSize: TEXT.sm, color: COLORS.inkFaint }}>
            {t("devis.filAriane")} / <strong style={{ color: COLORS.inkSoft }}>
              {editingId ? (editForm.numero || detailData?.numero || t('devis.editTitle')) : (enFiche ? (detailData?.numero || '…') : t('devis.nouveau'))}
            </strong>
            {editingId && <span style={{ marginLeft: SPACE.sm, color: COLORS.ochre }}>· {t('devis.modeEdition')}</span>}
          </span>
        </div>
      )}
      {apiError && (
        <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '11px 16px', fontSize: TEXT.base, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <AlertTriangle size={15} /> {apiError}
          <button onClick={() => setApiError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: COLORS.red, cursor: 'pointer', fontWeight: 700 }}>x</button>
        </div>
      )}

      {/* Les référentiels (conditions de paiement, taxes, plan comptable) vivaient ici, empilés
          au-dessus du formulaire de création. Ils sont passés dans le sous-onglet
          « Configuration » de VentesWithDevis : dans l'ERP de référence, la configuration n'est
          jamais posée sur l'écran d'un document, et ce sous-onglet existait déjà — il ne
          contenait que les listes de prix, alors que trois référentiels sur quatre étaient
          restés ici. DevisModule continue de charger `taxes` et `paymentTerms`, dont son
          formulaire a besoin ; il est démonté/remonté au changement de sous-onglet, donc il
          relit ces données après une modification faite depuis Configuration. */}

      {/* Formulaire de création d'un devis — masqué en vue "À facturer" (menu d'un ERP de référence
          équivalent : une liste filtrée, pas un point de création) */}
      {!filtreStatut && creationOuverte && (
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
          {t("devis.newTitle")}
        </div>
        <form onSubmit={submitForm} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <div>
            <Field
              label={t("devis.client")}
              list="devis-clients-datalist"
              placeholder={t("devis.selectClient")}
              value={clientSearch}
              onChange={e => {
                const v = e.target.value;
                setClientSearch(v);
                const match = findClientByLabel(v);
                setForm(f => ({ ...f, clientId: match ? String(match.id) : '' }));
              }}
              required
            />
            {renderClientCard(findClientById(form.clientId))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>{t("devis.lignesProduits")}</div>
            {/* Tableau continu façon ERP (une seule ligne par article, sans boîte séparée par
                champ) plutôt que la grille de <Field> encadrés d'avant — voir la demande
                explicite de l'utilisateur à ce sujet. "Livré"/"Facturé" apparaissent en lecture
                seule ("—") ici : ils n'ont de sens qu'une fois le devis créé et signé, voir la
                popup de détail pour leur édition réelle. */}
            <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
                  <th style={{ width: '3.5%' }}></th>
                  <th style={{ width: '24%' }}>{t("devis.colDesignation")}</th>
                  <th style={{ width: '9%' }}>{t("devis.colQte")}</th>
                  <th style={{ width: '9%' }}>{t("devis.colLivre")}</th>
                  <th style={{ width: '9%' }}>{t("devis.colFacture")}</th>
                  <th style={{ width: '6%' }}>{t("devis.colUnite")}</th>
                  <th style={{ width: '9%' }}>{t("devis.colPrixUnit")}</th>
                  <th style={{ width: '6%' }}>{t("devis.colRemise")}</th>
                  <th style={{ width: '13%' }}>{t("devis.colTaxe")}</th>
                  <th style={{ width: '10%', textAlign: 'right' }}>{t("devis.colMontant")}</th>
                  <th style={{ width: '3%' }}></th>
                </tr>
              </thead>
              <tbody>
                {form.lignes.map((ligne, i) => (
                  <React.Fragment key={i}>
                  <tr
                    draggable
                    onDragStart={() => setDraggedLigneIndex(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (draggedLigneIndex !== null && draggedLigneIndex !== i) moveLigne(draggedLigneIndex, i); setDraggedLigneIndex(null); }}
                    onDragEnd={() => setDraggedLigneIndex(null)}
                    style={{ opacity: draggedLigneIndex === i ? 0.4 : 1 }}
                  >
                    <td style={{ cursor: 'grab', color: COLORS.inkSoft, textAlign: 'center' }}><GripVertical size={14} /></td>
                    {ligne.type === 'section' ? (
                      <td colSpan={9}>
                        <input placeholder={t("devis.sectionPlaceholder")} value={ligne.produit} onChange={e => updateLigne(i, 'produit', e.target.value)} style={{ ...ligneCellInputStyle, fontWeight: 700 }} />
                      </td>
                    ) : (
                      <>
                        <td>
                          <input placeholder={t("devis.produitPlaceholder")} list={catalogDatalistId} value={ligne.produit} onChange={async e => {
                            const value = e.target.value;
                            updateLigne(i, 'produit', value);
                            const match = catalogItems.find(item => item.nom.toLowerCase() === value.toLowerCase());
                            updateLigne(i, 'stockId', match ? match.id : null);
                            updateLigne(i, 'stockModule', match ? match.module : null);
                            updateLigne(i, 'uomId', match ? match.uniteId || null : null);
                            if (match && match.unite && !ligne.unite) {
                              updateLigne(i, 'unite', match.unite);
                            }
                            if (match && !ligne.prixUnitaire) {
                              try {
                                const { prix } = await getPrixEffectif({ stockId: match.id, contactId: form.clientId || undefined, quantite: ligne.quantite || undefined });
                                if (prix != null) updateLigne(i, 'prixUnitaire', String(prix));
                              } catch (err) {
                                console.error('[DevisModule prix effectif]', err);
                                if (match.prixDefaut != null) updateLigne(i, 'prixUnitaire', String(match.prixDefaut));
                              }
                            }
                          }} style={ligneCellInputStyle} />
                        </td>
                        <td><input type="number" placeholder="0" value={ligne.quantite} onChange={e => updateLigne(i, 'quantite', e.target.value)} style={ligneCellInputStyle} /></td>
                        <td style={{ textAlign: 'center', color: COLORS.border }}>—</td>
                        <td style={{ textAlign: 'center', color: COLORS.border }}>—</td>
                        <td><input placeholder={t("devis.unitePlaceholder")} value={ligne.unite} onChange={e => updateLigne(i, 'unite', e.target.value)} style={ligneCellInputStyle} /></td>
                        <td><input type="number" placeholder="0" value={ligne.prixUnitaire} onChange={e => updateLigne(i, 'prixUnitaire', e.target.value)} style={ligneCellInputStyle} /></td>
                        <td><input type="number" placeholder="0" value={ligne.remisePourcentage} onChange={e => updateLigne(i, 'remisePourcentage', e.target.value)} style={ligneCellInputStyle} /></td>
                        <td><TaxSelect value={ligne.taxIds} options={taxes} onChange={ids => updateLigne(i, 'taxIds', ids)} /></td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(ligneTotalAvecTaxe(ligne))}</td>
                      </>
                    )}
                    <td style={{ textAlign: 'center' }}>
                      <button type="button" onClick={() => removeLigne(i)} disabled={form.lignes.length === 1} style={{ background: 'none', border: 'none', cursor: form.lignes.length === 1 ? 'default' : 'pointer', color: form.lignes.length === 1 ? COLORS.border : COLORS.red, padding: 0 }}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                  {ligne.type !== 'section' && (
                    <tr>
                      <td></td>
                      <td colSpan={9} style={{ paddingBottom: SPACE.sm }}>
                        <Select label={t("devis.recolteLiee")} value={ligne.recolteId} onChange={e => updateLigne(i, 'recolteId', e.target.value)}>
                          <option value="">{t("common.none")}</option>
                          {recoltes.map(r => (
                            <option key={r.id} value={r.id}>{r.parcelle} — {formatDateFr(r.date)}</option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            </div>
            <div style={{ display: 'flex', gap: SPACE.sm }}>
              <Button type="button" variant="ghost" onClick={addLigne} style={{ alignSelf: 'flex-start' }}>
                <Plus size={14} /> {t("devis.addLigne")}
              </Button>
              <Button type="button" variant="ghost" onClick={addSectionLigne} style={{ alignSelf: 'flex-start' }}>
                <Plus size={14} /> {t("devis.addSection")}
              </Button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: SPACE.sm }}>
            <Field label={t("devis.notes")} placeholder={t("devis.notesPlaceholder")} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            <Field label={t("devis.validityDate")} aide={t("devis.validityDateAide")} type="date" value={form.validityDate} onChange={e => setForm({ ...form, validityDate: e.target.value })} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: SPACE.sm, borderTop: `1px solid ${COLORS.border}` }}>
            <div style={{ fontSize: TEXT.md, fontWeight: 700 }}>{t("devis.totalLabel", { total: fmtMoney(totalForm) })}</div>
            <div style={{ display: 'flex', gap: SPACE.sm }}>
              <Button type="submit" variant="green" disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Plus size={15} />} {t("devis.create")}
              </Button>
            </div>
          </div>
        </form>
      </Card>
      )}

      {/* Bandeau de contrôle de la liste : création à gauche, bascule de vue à droite — la
          bascule vivait sous le formulaire, tout en bas de la page. */}
      {!enFormulaire && (
        <div style={{ display: 'flex', gap: SPACE.sm, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          {!filtreStatut ? (
            <Button variant="green" onClick={() => setDevisUrl('nouveau', { remplacer: false })}><Plus size={14} /> {t("devis.nouveau")}</Button>
          ) : <span />}
          <div style={{ display: 'flex', gap: SPACE.sm }}>
            <Button variant={vueDevis === 'liste' ? 'default' : 'ghost'} small onClick={() => setVueDevis('liste')}>{t('devis.vueListe')}</Button>
            <Button variant={vueDevis === 'kanban' ? 'default' : 'ghost'} small onClick={() => setVueDevis('kanban')}>{t('devis.vueKanban')}</Button>
          </div>
        </div>
      )}

      {/* Recherche, filtres et regroupement s'appliquent aux deux vues ; en Kanban, seuls la
          recherche et les filtres ont un effet (ses colonnes regroupent déjà par statut, et
          il n'y a rien à paginer). */}
      {!enFormulaire && (
        <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <BarreOutilsListe etat={outilsDevis} placeholderRecherche={t("devis.rechercher")} />
          </div>
          <MenuColonnes etat={outilsDevis} colonnes={colonnesDevis} />
        </div>
      )}

      {!enFormulaire && (

      vueDevis === 'kanban' ? (
        loading ? (
          <div style={{ padding: SPACE.xl, display: 'flex', alignItems: 'center', gap: SPACE.sm, color: COLORS.inkSoft }}>
            <Loader2 size={16} className="spin" /> {t("common.loading")}
          </div>
        ) : (
          <DevisKanban
            devisListe={outilsDevis.filtrees}
            statutTone={statutTone}
            onEnvoyer={handleEnvoyer}
            onValiderManuel={handleValiderManuel}
            onFacturer={openPaiementPopup}
            onRemettreBrouillon={handleRemettreBrouillon}
            onOpenDetail={openDetail}
          />
        )
      ) : (
      <Card style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: SPACE.xl, display: 'flex', alignItems: 'center', gap: SPACE.sm, color: COLORS.inkSoft }}>
            <Loader2 size={16} className="spin" /> {t("common.loading")}
          </div>
        ) : (
          <>
          <TableauListe
            etat={outilsDevis}
            colonnes={colonnesDevis}
            cle={(d) => d.id}
            onLigneClic={(d) => setDevisUrl(d.id, { remplacer: false })}
            ligneAttenuee={(d) => d.statut === 'Annulé'}
            selectionActive
            actionsGroupees={(selection) => {
              // Actions groupées calquées sur l'en-tête de liste de la référence, mais bornées
              // à ce qui existe déjà en action unitaire : rien de neuf côté serveur, donc rien
              // qui puisse se comporter autrement en lot qu'à l'unité.
              const supprimables = devisListe.filter(d => selection.includes(d.id) && d.statut === 'Brouillon');
              if (supprimables.length === 0) return null;
              return (
                <Button variant="danger" small onClick={() => handleDeleteLot(supprimables)}>
                  <Trash2 size={13} /> {t('devis.supprimerLot', { count: supprimables.length })}
                </Button>
              );
            }}
            vide={(
              <div style={{ padding: SPACE.xl, color: COLORS.inkSoft, fontSize: TEXT.base }}>
                {outilsDevis.actif
                  ? t('listes.aucunResultat')
                  : (filtreStatut ? t('devis.emptyAFacturer') : t('devis.emptyList'))}
              </div>
            )}
          />
          <PiedListe etat={outilsDevis} />
          </>
        )}
      </Card>
      )
      )}

      {/* Popup de détail d'un devis, avec actions (envoyer, facturer) et aperçu de la signature */}
      {detailId && detailData && !editingId && (() => {
        const margeInfo = computeMarge(detailData, catalogItems);
        const closeDetailPopup = () => setDevisUrl(null);
        const modifiable = ['Brouillon', 'Devis', 'Signé'].includes(detailData.statut);
        const nbLignesProduit = detailData.lignes.filter(l => l.type !== 'section').length;
        const nbEcheances = (detailData.echeances || []).length;
        const montantHT = detailData.lignes.reduce((s, l) => {
          if (l.type === 'section') return s;
          const pct = Number(l.remisePourcentage) || 0;
          const brut = (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0) * (1 - pct / 100);
          return s + taxesLigneCalc(brut, l.quantite, l.taxIds).base;
        }, 0);
        const montantTaxe = detailData.lignes.reduce((s, l) => {
          if (l.type === 'section') return s;
          const pct = Number(l.remisePourcentage) || 0;
          const brut = (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0) * (1 - pct / 100);
          return s + taxesLigneCalc(brut, l.quantite, l.taxIds).taxe;
        }, 0);
        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          {/* Disposition à deux colonnes façon fiche d'un ERP de référence (Order Lines + chatter à droite) — voir
              project_erp_devis_visual_alignment : même structure (barre d'action + chevrons en
              haut, en-tête à deux colonnes, tableau, totaux, panneau latéral d'activités/historique),
              couleurs YEELEN conservées. */}
          <div style={{ position: 'relative', background: '#fff', borderRadius: RADIUS.card, width: '100%', display: 'flex', flexWrap: 'wrap', overflow: 'hidden' }}>
            <div style={{ flex: '1 1 900px', minWidth: 0, padding: SPACE.xl, boxSizing: 'border-box' }}>
              {/* Deux rangées volontairement séparées plutôt qu'un seul groupe qui retombe à
                  la ligne au hasard selon la largeur : actions principales (transition de
                  statut) en haut, outils du document (aperçu/téléchargement/annulation) en
                  dessous — même logique de regroupement qu'un ERP de référence (actions primaires vs. menu
                  secondaire), sans reproduire son menu déroulant. */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.md, paddingRight: SPACE.xxl }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                  <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
                    {detailData.statut === 'Brouillon' && detailData.clientEmail && (
                      <Button variant="green" onClick={() => handleEnvoyer(detailData.id)} disabled={actionBusy}>
                        {actionBusy ? <Loader2 size={14} className="spin" /> : null} {t("devis.envoyerClient")}
                      </Button>
                    )}
                    {/* Le bouton vaut aussi une fois la pièce facturée : c'est là qu'on envoie
                        une facture, et le PDF derrière le lien public s'intitule alors
                        « FACTURE ». Il s'arrêtait à « Envoyé », donc il disparaissait
                        exactement au moment où la facture existait. */}
                    {!["Annulé"].includes(detailData.statut) && detailData.clientTelephone && (
                      <Button variant="outline" onClick={() => handleEnvoyerWhatsapp(detailData.id)} disabled={actionBusy}>
                        {actionBusy ? <Loader2 size={14} className="spin" /> : <MessageCircle size={14} />}{' '}
                        {detailData.move ? t("devis.envoyerFactureWhatsapp") : t("devis.envoyerWhatsapp")}
                      </Button>
                    )}
                    {(detailData.statut === 'Brouillon' || detailData.statut === 'Devis') && (
                      <Button variant="outline" onClick={() => handleValiderManuel(detailData.id)} disabled={actionBusy}>
                        {actionBusy ? <Loader2 size={14} className="spin" /> : null} {t("devis.validerManuel")}
                      </Button>
                    )}
                    {detailData.statut === 'Signé' && (
                      <Button variant="green" onClick={() => openPaiementPopup(detailData.id, detailData.total)} disabled={actionBusy}>
                        {t("devis.validerFacturer")}
                      </Button>
                    )}
                    {modifiable && (
                      <Button variant="outline" onClick={() => startEditDevis(detailData)}>
                        <Settings2 size={14} /> {t("devis.modifierLignes")}
                      </Button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Button small variant="outline" onClick={() => openDevisPdf(detailData.id)}>
                      <FileText size={14} /> {t("devis.apercu")}
                    </Button>
                    <Button small variant="outline" onClick={() => downloadDevisPdf(detailData.id, detailData.numero)}>
                      <Download size={14} /> {t("devis.pdf")}
                    </Button>
                    {['Brouillon', 'Devis', 'Envoyé'].includes(detailData.statut) && (
                      <>
                        <div style={{ width: 1, height: 16, background: COLORS.border }} />
                        <Button small variant="ghost" onClick={() => handleAnnuler(detailData.id)} disabled={actionBusy} style={{ color: COLORS.red }}>
                          {t("devis.annuler")}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <DevisStatusBar statut={detailData.statut} />
              </div>

              <div style={{ fontWeight: 700, fontSize: TEXT.title, marginBottom: SPACE.sm }}>{detailData.numero}</div>

              {/* "Boutons intelligents" façon ERP — dérivés de données déjà chargées, sans
                  nouvel appel réseau, plus un lien direct vers la fiche du client (seul
                  vrai renvoi vers un autre enregistrement possible ici, voir highlightFromUrl
                  dans App pour le mécanisme de navigation). */}
              <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap', marginBottom: SPACE.lg }}>
                <div style={{ padding: '5px 10px', borderRadius: RADIUS.card, background: COLORS.surfaceAlt, fontSize: TEXT.sm, color: COLORS.inkSoft }}>
                  {t("devis.smartLignes", { count: nbLignesProduit })}
                </div>
                {nbEcheances > 0 && (
                  <div style={{ padding: '5px 10px', borderRadius: RADIUS.card, background: COLORS.surfaceAlt, fontSize: TEXT.sm, color: COLORS.inkSoft }}>
                    {t("devis.smartEcheances", { count: nbEcheances })}
                  </div>
                )}
                {detailData.clientId && (
                  <button
                    onClick={() => { navigate(`/app/clients?highlight=${detailData.clientId}`); closeDetailPopup(); }}
                    style={{ padding: '5px 10px', borderRadius: RADIUS.control, background: COLORS.greenSoft, border: 'none', cursor: 'pointer', fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600 }}
                  >
                    {t("devis.voirContact")}
                  </button>
                )}
                {detailData.move && (
                  <button
                    onClick={() => { navigate('/app/factures'); closeDetailPopup(); }}
                    style={{ padding: '5px 10px', borderRadius: RADIUS.control, background: COLORS.greenSoft, border: 'none', cursor: 'pointer', fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600 }}
                  >
                    {t("devis.voirFacture", { name: detailData.move.name })} · {t(`factures.pay.${detailData.move.paymentState}`)}
                  </button>
                )}
              </div>

              {/* Onglets façon ERP au-dessus du tableau — Générateur de devis/Autres
                  informations n'ont pas d'équivalent réel ici (voir project_erp_devis_visual_alignment),
                  seuls Lignes de commande/Notes sont repris. */}
              <div style={{ display: 'flex', gap: SPACE.xs, borderBottom: `1px solid ${COLORS.border}`, marginBottom: SPACE.lg }}>
                {[{ id: 'lignes', label: t('devis.tabLignes') }, { id: 'notes', label: t('devis.tabNotes') }].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setDetailTab(tab.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: '8px 12px', fontSize: TEXT.base, fontWeight: 600,
                      color: detailTab === tab.id ? COLORS.green : COLORS.inkSoft,
                      borderBottom: detailTab === tab.id ? `2px solid ${COLORS.green}` : '2px solid transparent', marginBottom: -1,
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: etroitDevis ? '1fr' : '1fr 1fr', gap: SPACE.xxl, marginBottom: SPACE.xl, fontSize: TEXT.base }}>
                <div>
                  <div style={{ fontSize: TEXT.xs, textTransform: 'uppercase', letterSpacing: 0.4, color: COLORS.inkSoft, marginBottom: SPACE.xs }}>{t("devis.client")}</div>
                  <div style={{ fontWeight: 600 }}>{detailData.clientPrenom} {detailData.clientNom}</div>
                  {detailData.clientEmail ? (
                    <div style={{ color: COLORS.inkSoft }}>{detailData.clientEmail}</div>
                  ) : (
                    <div style={{ color: COLORS.inkSoft, fontStyle: 'italic' }}>{t("devis.noEmail")}</div>
                  )}
                  {detailData.clientTelephone && <div style={{ color: COLORS.inkSoft }}>{detailData.clientTelephone}</div>}
                  {/* Adresse décomposée si disponible (rue/ville/CP/pays), sinon repli sur
                      l'ancien champ adresse en texte libre — voir migrate.js. Pas de distinction
                      facturation/livraison, un contact n'a qu'une seule adresse dans ce modèle. */}
                  {(detailData.clientAdresseRue || detailData.clientAdresseVille || detailData.clientCodePostal || detailData.clientPays) ? (
                    <>
                      {detailData.clientAdresseRue && <div style={{ color: COLORS.inkSoft }}>{detailData.clientAdresseRue}</div>}
                      <div style={{ color: COLORS.inkSoft }}>{[detailData.clientCodePostal, detailData.clientAdresseVille].filter(Boolean).join(' ')}</div>
                      {detailData.clientPays && <div style={{ color: COLORS.inkSoft }}>{detailData.clientPays}</div>}
                    </>
                  ) : detailData.clientAdresse && <div style={{ color: COLORS.inkSoft }}>{detailData.clientAdresse}</div>}
                </div>
                <div>
                  <div style={{ fontSize: TEXT.xs, textTransform: 'uppercase', letterSpacing: 0.4, color: COLORS.inkSoft, marginBottom: SPACE.xs }}>{t("devis.details")}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <span style={{ color: COLORS.inkSoft }}>{t("common.date")}</span>
                    <span>{fmtDate(detailData.date || detailData.createdAt)}</span>
                  </div>
                  {modifiable ? (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', gap: SPACE.sm }}>
                        <span style={{ color: COLORS.inkSoft, whiteSpace: 'nowrap' }}>{t("devis.conditionsPaiement")}</span>
                        <input className="flat-input" value={detailMeta.conditionsPaiement} onChange={e => setDetailMeta(m => ({ ...m, conditionsPaiement: e.target.value }))} placeholder={t("devis.conditionsPaiementPlaceholder")} style={{ width: 120, textAlign: 'right' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', gap: SPACE.sm }}>
                        <span style={{ color: COLORS.inkSoft, whiteSpace: 'nowrap' }}>{t("devis.livraisonPromise")}</span>
                        <input className="flat-input" type="date" value={detailMeta.livraisonPromise} onChange={e => setDetailMeta(m => ({ ...m, livraisonPromise: e.target.value }))} style={{ width: 'auto' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0', gap: SPACE.sm }}>
                        <span style={{ color: COLORS.inkSoft, whiteSpace: 'nowrap' }}>{t("devis.validityDate")}</span>
                        <input className="flat-input" type="date" value={detailMeta.validityDate} onChange={e => setDetailMeta(m => ({ ...m, validityDate: e.target.value }))} style={{ width: 'auto' }} />
                      </div>
                    </>
                  ) : (
                    <>
                      {detailData.validityDate && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                          <span style={{ color: COLORS.inkSoft }}>{t("devis.validityDate")}</span>
                          <span style={detailData.expired ? { color: COLORS.red, fontWeight: 600 } : undefined}>
                            {fmtDate(detailData.validityDate)}{detailData.expired ? ` — ${t('devis.expired')}` : ''}
                          </span>
                        </div>
                      )}
                      {detailData.conditionsPaiement && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                          <span style={{ color: COLORS.inkSoft }}>{t("devis.conditionsPaiement")}</span>
                          <span>{detailData.conditionsPaiement}</span>
                        </div>
                      )}
                      {detailData.livraisonPromise && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                          <span style={{ color: COLORS.inkSoft }}>{t("devis.livraisonPromise")}</span>
                          <span>{fmtDate(detailData.livraisonPromise)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {detailData.signataireNom && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ color: COLORS.inkSoft }}>{t("devis.signePar")}</span>
                      <span>{detailData.signataireNom} — {fmtDate(detailData.dateSignature)}</span>
                    </div>
                  )}
                  {detailData.modePaiement && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                      <span style={{ color: COLORS.inkSoft }}>{t("devis.modePaiement")}</span>
                      <span>{detailData.modePaiement}</span>
                    </div>
                  )}
                </div>
              </div>

              {detailTab === 'notes' ? (
                <div style={{ minHeight: 80, padding: '10px 0', fontSize: TEXT.base, color: detailData.notes ? COLORS.ink : COLORS.inkSoft, fontStyle: detailData.notes ? 'normal' : 'italic', whiteSpace: 'pre-wrap' }}>
                  {detailData.notes || t("devis.notesEmpty")}
                </div>
              ) : (
              <>
              <DataTable style={{ marginBottom: SPACE.md }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
                    <th style={{ width: '25%' }}>{t("devis.colProduit")}</th><th style={{ width: '10%' }}>{t("devis.colQte")}</th><th style={{ width: '10%' }}>{t("devis.colLivre")}</th><th style={{ width: '10%' }}>{t("devis.colFacture")}</th><th style={{ width: '6%' }}>{t("devis.colUnite")}</th><th style={{ width: '10%' }}>{t("devis.colPU")}</th><th style={{ width: '5%' }}>{t("devis.colRemise")}</th><th style={{ width: '14%' }}>{t("devis.colTaxe")}</th><th style={{ width: '10%', textAlign: 'right' }}>{t("common.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detailData.lignes.map(l => {
                    if (l.type === 'section') {
                      return (
                        <tr key={l.id}>
                          <td colSpan={9} style={{ fontWeight: 700 }}>{l.produit}</td>
                        </tr>
                      );
                    }
                    const pct = Number(l.remisePourcentage) || 0;
                    const brutLigne = (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0) * (1 - pct / 100);
                    const taxesLigne = (l.taxIds || []).map(id => taxById.get(id)).filter(Boolean);
                    const { base: baseLigne, taxe: taxeLigne } = taxesLigneCalc(brutLigne, l.quantite, l.taxIds);
                    const netLigne = baseLigne + taxeLigne;
                    const recolteLiee = l.recolteId ? recoltes.find(r => r.id === l.recolteId) : null;
                    const qEdit = quantitesEdit[l.id] || { quantiteLivree: 0, quantiteFacturee: 0 };
                    return (
                      <tr key={l.id}>
                        <td>
                          {l.produit}
                          {recolteLiee && (
                            <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft, marginTop: 2 }}>
                              🌾 {recolteLiee.parcelle} — {formatDateFr(recolteLiee.date)}
                            </div>
                          )}
                        </td>
                        <td>{l.quantite}</td>
                        <td>
                          {detailData.statut !== 'Brouillon' ? (
                            <input className="flat-input" type="number" value={qEdit.quantiteLivree} onChange={e => updateQuantiteEdit(l.id, 'quantiteLivree', e.target.value)} style={{ width: 56 }} />
                          ) : '—'}
                        </td>
                        <td>
                          {detailData.statut !== 'Brouillon' ? (
                            <input className="flat-input" type="number" value={qEdit.quantiteFacturee} onChange={e => updateQuantiteEdit(l.id, 'quantiteFacturee', e.target.value)} style={{ width: 56 }} />
                          ) : '—'}
                        </td>
                        <td style={{ color: COLORS.inkSoft }}>{l.unite || '—'}</td>
                        <td>{enDevise(l.prixUnitaire, detailData.devise)}</td>
                        <td>{pct.toLocaleString(locale)}</td>
                        <td style={{ color: COLORS.inkSoft }}>{taxesLigne.length ? taxesLigne.map(tx => tx.name).join(', ') : '—'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{enDevise(netLigne, detailData.devise)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
              {detailData.statut !== 'Brouillon' && (
                <div style={{ textAlign: 'right', marginBottom: SPACE.sm }}>
                  <Button small variant="outline" onClick={handleSaveQuantites} disabled={quantitesSaving}>
                    {quantitesSaving ? <Loader2 size={14} className="spin" /> : null} {t("devis.enregistrerQuantites")}
                  </Button>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: SPACE.md }}>
                <div style={{ minWidth: 240 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: TEXT.sm, color: COLORS.inkSoft, padding: '2px 0' }}>
                    <span>{t("devis.montantHT")}</span><span>{enDevise(montantHT, detailData.devise)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: TEXT.sm, color: COLORS.inkSoft, padding: '2px 0', gap: SPACE.sm }}>
                    <span>{t("devis.remiseGlobale")}</span>
                    {modifiable ? (
                      <input className="flat-input" type="number" value={detailMeta.remiseGlobale} onChange={e => setDetailMeta(m => ({ ...m, remiseGlobale: e.target.value }))} style={{ width: 64, textAlign: 'right' }} />
                    ) : <span>{Number(detailData.remiseGlobale) || 0}%</span>}
                  </div>
                  {/* Étape 1 Comptabilité : chaque ligne référence des taxes réutilisables
                      (account.tax-like) via la colonne "Taxes" ci-dessus — ce total n'est
                      qu'un récapitulatif de ce que l'ensemble des lignes applique. */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: TEXT.sm, color: COLORS.inkSoft, padding: '2px 0' }}>
                    <span>{t("devis.montantTaxes")}</span><span>{enDevise(montantTaxe, detailData.devise)}</span>
                  </div>
                  {modifiable && (
                    <div style={{ textAlign: 'right', marginTop: SPACE.xs, marginBottom: SPACE.xs }}>
                      <Button small variant="outline" onClick={handleSaveDetailMeta} disabled={detailMetaSaving}>
                        {detailMetaSaving ? <Loader2 size={14} className="spin" /> : null} {t("common.save")}
                      </Button>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: TEXT.md, borderTop: `2px solid ${COLORS.border}`, paddingTop: SPACE.sm }}>
                    <span>{t("common.total")}</span>
                    <span>{enDevise(detailData.total, detailData.devise)}</span>
                  </div>
                  {detailData.devise && detailData.devise !== deviseEntreprise && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: TEXT.sm, color: COLORS.inkSoft }}>
                      <span>{t("devis.totalDeviseEntreprise")}</span><span>{fmtMoney(detailData.totalDeviseEntreprise)}</span>
                    </div>
                  )}
                  {margeInfo && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: TEXT.sm, color: COLORS.inkSoft, marginTop: SPACE.xs }}>
                      <span>{t("devis.marge")}</span><span>{t("devis.margeValeur", { montant: fmtMoney(margeInfo.marge), pct: margeInfo.pourcentage.toFixed(1) })}</span>
                    </div>
                  )}
                </div>
              </div>

              {detailData.echeances && detailData.echeances.length > 0 && (
                <div>
                  <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.sm }}>
                    {t("devis.echeances")} {detailData.modePaiement && `· ${detailData.modePaiement}`}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                    {detailData.echeances.map(ech => (
                      <div key={ech.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: RADIUS.card, border: `1px solid ${COLORS.border}` }}>
                        <div>
                          <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>{enDevise(ech.montant, detailData.devise)}</div>
                          <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft }}>{t("devis.echeanceDate", { date: fmtDate(ech.dateEcheance) })}</div>
                        </div>
                        {ech.statut === 'Payé' ? (
                          <Badge tone="green">{t("devis.payeLe", { date: fmtDate(ech.datePaiement) })}</Badge>
                        ) : (
                          <Button small variant="green" onClick={() => handlePayerEcheance(detailData.id, ech.id)} disabled={actionBusy}>
                            {t("devis.marquerPaye")}
                          </Button>
                        )}
                        {detailData.statut === 'Brouillon' && (
                          <Button small variant="outline" onClick={() => handleRemettreBrouillon(detailData.id)} disabled={actionBusy}>
                            {t("devis.remettreBrouillon")}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </>
              )}
            </div>

            {/* Panneau latéral façon chatter d'un ERP de référence : messages, activités planifiées, journal des modifications */}
            <div style={{ flex: '0 0 340px', width: 340, borderLeft: `1px solid ${COLORS.border}`, background: COLORS.bg, padding: '22px 18px', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, textAlign: 'left', marginBottom: SPACE.lg }}>
                <div style={{ fontSize: TEXT.sm, fontWeight: 700, color: COLORS.inkSoft }}>{t("devis.messages")}</div>
                <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'flex-start' }}>
                  <textarea
                    className="flat-input"
                    rows={2}
                    value={nouveauMessage}
                    onChange={e => setNouveauMessage(e.target.value)}
                    placeholder={t("devis.messagePlaceholder")}
                    // Entrée = retour à la ligne (comportement natif du textarea) ;
                    // Ctrl/Cmd + Entrée = envoyer, comme dans la plupart des messageries.
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleEnvoyerMessage(); } }}
                    style={{ flex: 1, resize: 'vertical', minHeight: 34, lineHeight: 1.4 }}
                  />
                  <Button small variant="outline" onClick={handleEnvoyerMessage} disabled={messageSaving || !nouveauMessage.trim()}>
                    {messageSaving ? <Loader2 size={13} className="spin" /> : t('devis.envoyer')}
                  </Button>
                </div>
                {messages.length === 0 ? (
                  <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, fontStyle: 'italic' }}>{t("devis.noMessage")}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                    {messages.map(m => (
                      <div key={m.id} style={{ padding: '6px 8px', borderRadius: RADIUS.control, background: '#fff', border: `1px solid ${COLORS.border}` }}>
                        <div style={{ fontSize: TEXT.sm, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.contenu}</div>
                        <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft, marginTop: 2 }}>{m.userEmail || t("devis.systeme")} · {fmtDate(m.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <ActivitesSection ressourceType="devis" ressourceId={detailData.id} />
              {journal.length > 0 && (
                <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: SPACE.md, marginTop: SPACE.lg, textAlign: 'left' }}>
                  <div style={{ fontSize: TEXT.sm, fontWeight: 700, color: COLORS.inkSoft, marginBottom: SPACE.sm }}>{t("devis.historique")}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                    {journal.map(j => (
                      <div key={j.id} style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>
                        {fmtDate(j.createdAt, { dateStyle: 'short', timeStyle: 'short' })} — {j.userEmail || t('devis.systeme')} :{' '}
                        {j.changements.map((c, i) => (
                          <span key={i}>{i > 0 && ', '}<strong>{c.champ}</strong> {c.ancienne ?? '—'} → {c.nouvelle ?? '—'}</span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}
      {/* Popup demandant le mode et la modalité de paiement avant de facturer */}
      {paiementPopupOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }} onClick={() => setPaiementPopupOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: RADIUS.card, padding: SPACE.xl, maxWidth: 500, width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: TEXT.md, marginBottom: SPACE.md }}>{t("devis.paiementTitle")}</div>

            <Select label={t("devis.modePaiement")} value={paiementForm.modePaiement} onChange={e => setPaiementForm({ ...paiementForm, modePaiement: e.target.value })} style={{ marginBottom: SPACE.md }}>
              <option value="Espèces">{t("devis.modePaiementEspeces")}</option>
              <option value="Banque">{t("devis.modePaiementBanque")}</option>
              <option value="Mobile Money">{t("devis.modePaiementMobile")}</option>
              <option value="Chèque">{t("devis.modePaiementCheque")}</option>
            </Select>

            <Select label={t("devis.conditionPaiement")} value={paiementForm.paymentTermId} onChange={e => setPaiementForm({ ...paiementForm, paymentTermId: e.target.value })} style={{ marginBottom: SPACE.md }}>
              <option value="">{t("devis.saisieManuelle")}</option>
              {paymentTerms.map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
            </Select>

            {paiementForm.paymentTermId && (
              <div style={{ marginBottom: SPACE.md, padding: '10px 12px', background: COLORS.surfaceAlt, borderRadius: RADIUS.card }}>
                <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, marginBottom: SPACE.sm }}>
                  {resumeTerme(paymentTerms.find(pt => String(pt.id) === String(paiementForm.paymentTermId)) || { lignes: [] })}
                </div>
                <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.sm }}>{t("devis.acompte")}</div>
                <div style={{ display: 'grid', gridTemplateColumns: etroitDevis ? '1fr' : '1fr 1fr', gap: SPACE.sm }}>
                  <Select value={paiementForm.acompteMethod} onChange={e => setPaiementForm({ ...paiementForm, acompteMethod: e.target.value })}>
                    <option value="">{t("devis.acompteAucun")}</option>
                    <option value="percentage">%</option>
                    <option value="fixed">{t("devis.acompteMontant")}</option>
                  </Select>
                  {paiementForm.acompteMethod && (
                    <Field type="text" inputMode="decimal" placeholder="0" value={paiementForm.acompteValue}
                      onChange={e => setPaiementForm({ ...paiementForm, acompteValue: e.target.value.replace(/[^\d.]/g, '') })} />
                  )}
                </div>
              </div>
            )}

            <div style={{ display: paiementForm.paymentTermId ? 'none' : 'flex', gap: SPACE.sm, marginBottom: SPACE.md }}>
              <button
                type="button"
                onClick={() => setPaiementForm({ ...paiementForm, modalitePaiement: 'complet' })}
                style={{
                  flex: 1, padding: '10px 8px', borderRadius: RADIUS.control, cursor: 'pointer',
                  border: `1.5px solid ${paiementForm.modalitePaiement === 'complet' ? COLORS.green : COLORS.border}`,
                  background: paiementForm.modalitePaiement === 'complet' ? COLORS.greenSoft : '#fff',
                  color: paiementForm.modalitePaiement === 'complet' ? COLORS.green : COLORS.inkSoft,
                  fontWeight: 600, fontSize: TEXT.base,
                }}
              >
                {t("devis.paiementComplet")}
              </button>
              <button
                type="button"
                onClick={() => setPaiementForm({ ...paiementForm, modalitePaiement: 'echelonne' })}
                style={{
                  flex: 1, padding: '10px 8px', borderRadius: RADIUS.control, cursor: 'pointer',
                  border: `1.5px solid ${paiementForm.modalitePaiement === 'echelonne' ? COLORS.green : COLORS.border}`,
                  background: paiementForm.modalitePaiement === 'echelonne' ? COLORS.greenSoft : '#fff',
                  color: paiementForm.modalitePaiement === 'echelonne' ? COLORS.green : COLORS.inkSoft,
                  fontWeight: 600, fontSize: TEXT.base,
                }}
              >
                {t("devis.paiementEchelonne")}
              </button>
            </div>

            {!paiementForm.paymentTermId && paiementForm.modalitePaiement === 'echelonne' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, marginBottom: SPACE.md }}>
                <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>{t("devis.echeances")}</div>
                {paiementForm.echeances.map((e, i) => (
                  // Montant, date et bouton : trois éléments courts qui tiennent encore sur une
                  // ligne en 375 px. Les empiler allongerait la saisie sans rien gagner.
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: SPACE.sm, alignItems: 'end' }}>
                    <Field label={i === 0 ? t('devis.montant') : ''} type="text" inputMode="decimal" placeholder="0" value={e.montant} onChange={ev => updateEcheance(i, 'montant', ev.target.value.replace(/[^\d]/g, ''))} />
                    <Field label={i === 0 ? t('common.date') : ''} type="date" value={e.dateEcheance} onChange={ev => updateEcheance(i, 'dateEcheance', ev.target.value)} />
                    <button type="button" onClick={() => removeEcheance(i)} disabled={paiementForm.echeances.length === 1} style={{ background: 'none', border: 'none', cursor: paiementForm.echeances.length === 1 ? 'default' : 'pointer', color: paiementForm.echeances.length === 1 ? COLORS.border : COLORS.red, padding: '9px 0' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="ghost" onClick={addEcheance} style={{ alignSelf: 'flex-start' }}>
                  <Plus size={14} /> {t("devis.addEcheance")}
                </Button>
              </div>
            )}

            <div style={{ display: 'flex', gap: SPACE.sm, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setPaiementPopupOpen(false)}>{t("common.cancel")}</Button>
              <Button variant="green" onClick={submitFacturer} disabled={actionBusy}>
                {actionBusy ? <Loader2 size={14} className="spin" /> : null} {t("devis.confirmerFacturer")}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Édition DANS le formulaire, et non dans une fenêtre par-dessus : dans l'ERP de
          référence, la fiche EST l'éditeur — on modifie les champs sur place et une paire
          Enregistrer / Annuler apparaît. Le contenu du formulaire est celui qui vivait
          auparavant dans la modale ; seule son enveloppe change. */}
      {editingId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <div style={{ background: '#fff', borderRadius: RADIUS.card, width: '100%', padding: SPACE.xl }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t("devis.editTitle")}</div>
              <button onClick={cancelEditDevis} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, fontSize: TEXT.lg }}>×</button>
            </div>
            {editForm.statut === 'Signé' && (
              <div style={{ background: COLORS.ochreSoft, color: COLORS.ink, border: `1px solid ${COLORS.ochre}`, borderRadius: RADIUS.card, padding: '8px 12px', fontSize: TEXT.sm, marginBottom: SPACE.md }}>
                {t("devis.editSigneNotice")}
              </div>
            )}
            <form onSubmit={submitEditForm} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
              <div>
                <Field
                  label={t("devis.client")}
                  list="devis-clients-datalist"
                  placeholder={t("devis.selectClient")}
                  value={editClientSearch}
                  onChange={e => {
                    const v = e.target.value;
                    setEditClientSearch(v);
                    const match = findClientByLabel(v);
                    setEditForm(f => ({ ...f, clientId: match ? String(match.id) : '' }));
                  }}
                  required
                />
                {renderClientCard(findClientById(editForm.clientId))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>{t("devis.lignesProduits")}</div>
                <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
                      <th style={{ width: '3.5%' }}></th>
                      <th style={{ width: '24%' }}>{t("devis.colDesignation")}</th>
                      <th style={{ width: '9%' }}>{t("devis.colQte")}</th>
                      <th style={{ width: '9%' }}>{t("devis.colLivre")}</th>
                      <th style={{ width: '9%' }}>{t("devis.colFacture")}</th>
                      <th style={{ width: '6%' }}>{t("devis.colUnite")}</th>
                      <th style={{ width: '9%' }}>{t("devis.colPrixUnit")}</th>
                      <th style={{ width: '6%' }}>{t("devis.colRemise")}</th>
                      <th style={{ width: '13%' }}>{t("devis.colTaxe")}</th>
                      <th style={{ width: '10%', textAlign: 'right' }}>{t("devis.colMontant")}</th>
                      <th style={{ width: '3%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editForm.lignes.map((ligne, i) => (
                      <React.Fragment key={i}>
                      <tr
                        draggable
                        onDragStart={() => setDraggedEditLigneIndex(i)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); if (draggedEditLigneIndex !== null && draggedEditLigneIndex !== i) moveEditLigne(draggedEditLigneIndex, i); setDraggedEditLigneIndex(null); }}
                        onDragEnd={() => setDraggedEditLigneIndex(null)}
                        style={{ opacity: draggedEditLigneIndex === i ? 0.4 : 1 }}
                      >
                        <td style={{ cursor: 'grab', color: COLORS.inkSoft, textAlign: 'center' }}><GripVertical size={14} /></td>
                        {ligne.type === 'section' ? (
                          <td colSpan={9}>
                            <input placeholder={t("devis.sectionPlaceholder")} value={ligne.produit} onChange={e => updateEditLigne(i, 'produit', e.target.value)} style={{ ...ligneCellInputStyle, fontWeight: 700 }} />
                          </td>
                        ) : (
                          <>
                            <td>
                              <input placeholder={t("devis.produitPlaceholder")} list={catalogDatalistId} value={ligne.produit} onChange={async e => {
                                const value = e.target.value;
                                updateEditLigne(i, 'produit', value);
                                const match = catalogItems.find(item => item.nom.toLowerCase() === value.toLowerCase());
                                updateEditLigne(i, 'stockId', match ? match.id : null);
                                updateEditLigne(i, 'stockModule', match ? match.module : null);
                                updateEditLigne(i, 'uomId', match ? match.uniteId || null : null);
                                if (match && match.unite && !ligne.unite) {
                                  updateEditLigne(i, 'unite', match.unite);
                                }
                                if (match && !ligne.prixUnitaire) {
                                  try {
                                    const { prix } = await getPrixEffectif({ stockId: match.id, contactId: editForm.clientId || undefined, quantite: ligne.quantite || undefined });
                                    if (prix != null) updateEditLigne(i, 'prixUnitaire', String(prix));
                                  } catch (err) {
                                    console.error('[DevisModule prix effectif]', err);
                                    if (match.prixDefaut != null) updateEditLigne(i, 'prixUnitaire', String(match.prixDefaut));
                                  }
                                }
                              }} style={ligneCellInputStyle} />
                            </td>
                            <td><input type="number" placeholder="0" value={ligne.quantite} onChange={e => updateEditLigne(i, 'quantite', e.target.value)} style={ligneCellInputStyle} /></td>
                            <td style={{ textAlign: 'center', color: COLORS.border }}>—</td>
                            <td style={{ textAlign: 'center', color: COLORS.border }}>—</td>
                            <td><input placeholder={t("devis.unitePlaceholder")} value={ligne.unite} onChange={e => updateEditLigne(i, 'unite', e.target.value)} style={ligneCellInputStyle} /></td>
                            <td><input type="number" placeholder="0" value={ligne.prixUnitaire} onChange={e => updateEditLigne(i, 'prixUnitaire', e.target.value)} style={ligneCellInputStyle} /></td>
                            <td><input type="number" placeholder="0" value={ligne.remisePourcentage} onChange={e => updateEditLigne(i, 'remisePourcentage', e.target.value)} style={ligneCellInputStyle} /></td>
                            <td><TaxSelect value={ligne.taxIds} options={taxes} onChange={ids => updateEditLigne(i, 'taxIds', ids)} /></td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(ligneTotalAvecTaxe(ligne))}</td>
                          </>
                        )}
                        <td style={{ textAlign: 'center' }}>
                          <button type="button" onClick={() => removeEditLigne(i)} disabled={editForm.lignes.length === 1} style={{ background: 'none', border: 'none', cursor: editForm.lignes.length === 1 ? 'default' : 'pointer', color: editForm.lignes.length === 1 ? COLORS.border : COLORS.red, padding: 0 }}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      {ligne.type !== 'section' && (
                        <tr>
                          <td></td>
                          <td colSpan={9} style={{ paddingBottom: SPACE.sm }}>
                            <Select label={t("devis.recolteLiee")} value={ligne.recolteId} onChange={e => updateEditLigne(i, 'recolteId', e.target.value)}>
                              <option value="">{t("common.none")}</option>
                              {recoltes.map(r => (
                                <option key={r.id} value={r.id}>{r.parcelle} — {formatDateFr(r.date)}</option>
                              ))}
                            </Select>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                </div>
                <div style={{ display: 'flex', gap: SPACE.sm }}>
                  <Button type="button" variant="ghost" onClick={addEditLigne} style={{ alignSelf: 'flex-start' }}>
                    <Plus size={14} /> {t("devis.addLigne")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={addSectionEditLigne} style={{ alignSelf: 'flex-start' }}>
                    <Plus size={14} /> {t("devis.addSection")}
                  </Button>
                </div>
              </div>

              <Field label={t("devis.notes")} placeholder={t("devis.notesPlaceholder")} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: SPACE.sm, borderTop: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: TEXT.md, fontWeight: 700 }}>{t("devis.totalLabel", { total: fmtMoney(totalEditForm) })}</div>
                <div style={{ display: 'flex', gap: SPACE.sm }}>
                  <Button type="button" variant="ghost" onClick={cancelEditDevis}>{t("common.cancel")}</Button>
                  <Button type="submit" variant="green" disabled={editSaving}>
                    {editSaving ? <Loader2 size={14} className="spin" /> : <Check size={15} />} {t("devis.update")}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Sous-menu façon barre d'application d'un ERP de référence (Ventes : Commandes/À facturer/Produits/
// Analyse/Configuration) — mêmes 5 entrées, reliées à des fonctionnalités déjà
// existantes plutôt qu'à de nouvelles pages : voir VentesWithDevis ci-dessous pour
// le détail de ce que rend chaque entrée. Couleurs YEELEN conservées (vert plutôt que
// le violet de l'ERP de référence), seule la structure horizontale est reprise.
const VENTES_SOUS_NAV = [
  { id: 'commandes', labelKey: 'ventes.navCommandes' },
  { id: 'a_facturer', labelKey: 'ventes.navAFacturer' },
  { id: 'produits', labelKey: 'ventes.navProduits' },
  { id: 'analyse', labelKey: 'ventes.navAnalyse' },
  { id: 'configuration', labelKey: 'ventes.navConfiguration' },
];

// Achats et Ventes sont deux objets symétriques, présentés jusqu'ici de deux manières
// différentes : Ventes avec cinq sous-onglets, Achats sans aucun. Même barre, mêmes rôles —
// « À recevoir » est à l'achat ce que « À facturer » est à la vente, une liste filtrée sur
// l'étape en cours et non un second point de création. Pas d'onglet Configuration ici : les
// achats n'ont aucun référentiel qui leur soit propre.
// L'écran Stocks empilait tout sur une page : formulaire de création, quatre panneaux pliables
// (gabarits, recettes, ordres de transformation, HACCP), graphique, puis la liste des articles —
// et deux panneaux de plus depuis l'exposition du stock par emplacement. Six barres grises l'une
// sous l'autre. La référence sépare Opérations / Produits / Rapports / Configuration ; on reprend
// ce découpage, avec la même barre de sous-onglets que Ventes et Achats.
//
// « Gérer les catégories » reste dans le formulaire de création malgré sa nature de
// configuration : c'est là qu'on en a besoin, au moment de classer un article qu'on saisit.
const STOCKS_SOUS_NAV = [
  { id: 'articles', labelKey: 'stocks.navArticles' },
  { id: 'inventaire', labelKey: 'stocks.navInventaire' },
  { id: 'transformation', labelKey: 'stocks.navTransformation' },
  { id: 'configuration', labelKey: 'stocks.navConfiguration' },
];

const ACHATS_SOUS_NAV = [
  { id: 'commandes', labelKey: 'achats.navCommandes' },
  { id: 'a_recevoir', labelKey: 'achats.navARecevoir' },
  { id: 'produits', labelKey: 'achats.navProduits' },
];

// Grand livre des ventes (devis signés/facturés), en lecture seule — équivalent
// minimal d'un menu "Analyse" de référence. Réutilise getVentesLedger, déjà la source de
// vérité de ComptabiliteTab pour les mêmes données.
function VentesAnalyseTab() {
  const { t } = useTranslation();
  const { fmtMoney } = useLocale();
  const [mouvements, setMouvements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { mouvements } = await getVentesLedger();
        setMouvements(mouvements || []);
      } catch (err) {
        console.error('[VentesAnalyseTab]', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const total = mouvements.reduce((s, m) => s + montantLigneEntreprise(m), 0);

  return (
    <Card>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
        {t('ventes.analyseTitle')}
      </div>
      {loading ? (
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <Loader2 size={15} className="spin" /> {t('common.loading')}
        </div>
      ) : mouvements.length === 0 ? (
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('ventes.analyseEmpty')}</div>
      ) : (
        <>
          <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.md }}>
            {t('ventes.analyseResume', { count: mouvements.length, total: fmtMoney(total) })}
          </div>
          <DataTable>
            <thead>
              <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
                <th>{t('common.date')}</th><th>{t('ventes.colProduit')}</th><th>{t('ventes.colClient')}</th><th>{t('devis.colQte')}</th><th style={{ textAlign: 'right' }}>{t('common.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {mouvements.map(m => (
                <tr key={m.id}>
                  <td>{formatDateFr(m.date)}</td>
                  <td>{m.produit}</td>
                  <td>{m.partenaire}</td>
                  <td>{m.quantite}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(montantLigneEntreprise(m))}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </>
      )}
    </Card>
  );
}

// Affiche le modèle de devis multi-lignes dans l'onglet Ventes, avec une barre de
// sous-navigation façon ERP au-dessus (voir VENTES_SOUS_NAV).
function VentesWithDevis({ farmId, moduleType = 'Cultures' }) {
  const { t } = useTranslation();
  const [clientsListe, setClientsListe] = useState([]);
  const [sousNav, setSousNav] = useState('commandes');
  // Référentiels du sous-onglet Configuration. Chargés paresseusement : inutile d'aller les
  // chercher tant que l'utilisateur reste sur Commandes, qui est l'écran d'entrée.
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const rechargerPaymentTerms = () => getPaymentTerms().then(d => setPaymentTerms(d.paymentTerms || [])).catch(() => {});
  const rechargerTaxes = () => getTaxes().then(d => setTaxes(d.taxes || [])).catch(() => {});
  useEffect(() => {
    if (sousNav !== 'configuration') return;
    rechargerPaymentTerms();
    rechargerTaxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sousNav]);

  // Charge la liste des clients une seule fois, nécessaire au formulaire de devis
  useEffect(() => {
    (async () => {
      try {
        const { contacts } = await getContacts('client');
        setClientsListe(contacts || []);
      } catch (err) {
        console.error('[VentesWithDevis clients]', err);
      }
    })();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <SousNavOnglets items={VENTES_SOUS_NAV} actif={sousNav} onSelect={setSousNav} />

      {sousNav === 'commandes' && (
        <>
          <Card>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.xs }}>
              {t('ventes.devisTitle')}
            </div>
            <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>
              {t('ventes.devisSubtitle')}
            </div>
          </Card>
          <DevisModule clientsListe={clientsListe} />
        </>
      )}
      {sousNav === 'a_facturer' && (
        <>
          <Card>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.xs }}>
              {t('ventes.aFacturerTitle')}
            </div>
            <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>
              {t('ventes.aFacturerSubtitle')}
            </div>
          </Card>
          <DevisModule clientsListe={clientsListe} filtreStatut="Signé" />
        </>
      )}
      {sousNav === 'produits' && <StocksTab farmId={farmId} moduleType={moduleType} />}
      {sousNav === 'analyse' && <VentesAnalyseTab />}
      {sousNav === 'configuration' && (
        <>
          <Card>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.md }}>
              {t('ventes.configTitle')}
            </div>
            <ListesPrixManager />
          </Card>
          {/* Conditions de paiement, taxes, journaux et plan de comptes sont partis sous
              Finance → Factures → Configuration : dans l'ERP de référence, seules les listes de
              prix relèvent des ventes, les trois autres sont de la configuration comptable.
              Ils étaient ici parce que c'est là qu'ils ont été construits. */}
        </>
      )}
    </div>
  );
}

// Pendant d'AchatModule ce que VentesWithDevis est à DevisModule : la sous-navigation qui
// manquait à l'onglet Achats. Les deux écrans se lisent désormais de la même façon.
function AchatsAvecSousNav({ farmId, storageKey, moduleType }) {
  const { t } = useTranslation();
  const [sousNav, setSousNav] = useState('commandes');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <SousNavOnglets items={ACHATS_SOUS_NAV} actif={sousNav} onSelect={setSousNav} />

      {sousNav === 'commandes' && (
        <AchatModule farmId={farmId} storageKey={storageKey} moduleType={moduleType} />
      )}
      {sousNav === 'a_recevoir' && (
        <>
          <Card>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.xs }}>
              {t('achats.aRecevoirTitle')}
            </div>
            <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>
              {t('achats.aRecevoirSubtitle')}
            </div>
          </Card>
          <AchatModule farmId={farmId} storageKey={storageKey} moduleType={moduleType} filtreReception />
        </>
      )}
      {sousNav === 'produits' && <StocksTab farmId={farmId} moduleType={moduleType} />}
    </div>
  );
}

// `filtreReception` restreint la liste aux commandes confirmées dont la marchandise n'est pas
// entièrement arrivée — le croisement des deux axes, et la question que pose le sous-onglet
// « À recevoir ». Comme la vue « À facturer » d'un devis : une liste filtrée, pas un second
// point de saisie.
function AchatModule({ farmId, storageKey = 'achats-documents', moduleType = 'Cultures', filtreReception }) {
  const etroitAchats = useAffichageEtroit();
  const { t } = useTranslation();
  const { fmtMoney, fmtDate } = useLocale();
  const [fournisseurs, setFournisseurs] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [useRemote, setUseRemote] = useState(true);
  const [form, setForm] = useState({ fournisseurId: '', fournisseurNom: '', notes: '', lignes: [{ produit: '', quantite: '', prixUnitaire: '', stockId: null, uomId: null }] });
  const [error, setError] = useState('');
  const [detailDoc, setDetailDoc] = useState(null);
  const key = `${storageKey}-${farmId}`;

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ fournisseurId: '', fournisseurNom: '', notes: '', lignes: [{ produit: '', quantite: '', prixUnitaire: '', stockId: null, uomId: null }] });
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Catalogue produit : les articles de stock du module servent de suggestions (avec
  // préremplissage du prix par défaut) pour le champ "Produit" — pas une liste fermée,
  // du texte libre reste possible pour un article non suivi en stock.
  const [catalogItems, setCatalogItems] = useState([]);
  const catalogDatalistId = `achat-catalog-${moduleType}`;
  // Filtrage côté client, comme DevisModule pour sa vue « À facturer » : la liste complète est
  // déjà chargée, un second appel réseau n'apporterait rien. 'Reçu' par défaut pour les lignes
  // historiques créées avant l'introduction de la colonne statut.
  // « À recevoir » = une commande confirmée dont la marchandise n'est pas entièrement là.
  // Sur l'ancien modèle c'était un filtre de statut ; avec deux axes, c'est le croisement des
  // deux, ce qui est exactement la question posée.
  const docsAffiches = filtreReception
    ? docs.filter(d => d.statut === 'Commandé' && (d.etatReception || 'en_attente') !== 'recu')
    : docs;
  // Même modèle que DevisModule, URL comprise : le document ouvert vit dans ?achat=.
  const [achatUrl, setAchatUrl] = useParametreUrl('achat');
  const creationOuverte = achatUrl === 'nouveau';
  const enFiche = Boolean(detailDoc);
  const enFormulaire = creationOuverte || enFiche || Boolean(editingId);
  const retourListe = () => { cancelEdit(); setAchatUrl(null); };

  useEffect(() => {
    if (!achatUrl || achatUrl === 'nouveau') {
      if (detailDoc) setDetailDoc(null);
      return;
    }
    const id = Number(achatUrl);
    if (id && (!detailDoc || detailDoc.id !== id)) {
      const doc = docs.find(d => d.id === id);
      if (doc) openDetail(doc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achatUrl, docs]);

  // Mêmes outils que la liste des devis, avec les questions propres à l'achat.
  const outilsAchats = useListeOutils(docsAffiches, useMemo(() => ({
    rechercheChamps: (d) => [d.numero, d.fournisseurNom, d.notes, d.total],
    filtres: [
      { id: 'brouillon', labelKey: 'achats.statut.Brouillon', test: (d) => d.statut === 'Brouillon' },
      { id: 'envoyee', labelKey: 'achats.statut.Envoyée', test: (d) => d.statut === 'Envoyée' },
      { id: 'commande', labelKey: 'achats.statut.Commandé', test: (d) => d.statut === 'Commandé' },
      { id: 'annulee', labelKey: 'achats.statut.Annulée', test: (d) => d.statut === 'Annulée' },
      // Second axe : ces deux-là répondent à « qu'est-ce que j'attends encore ? », la question
      // qui motivait le sous-onglet « À recevoir ».
      { id: 'attente', labelKey: 'achats.reception.en_attente', test: (d) => (d.etatReception || 'en_attente') === 'en_attente' },
      { id: 'partiel', labelKey: 'achats.reception.partiel', test: (d) => d.etatReception === 'partiel' },
      { id: 'recu', labelKey: 'achats.reception.recu', test: (d) => d.etatReception === 'recu' },
    ],
    groupes: [
      { id: 'statut', labelKey: 'common.status', valeur: (d) => d.statut || 'Brouillon' },
      { id: 'reception', labelKey: 'achats.colReceptionEtat', valeur: (d) => d.etatReception || 'en_attente' },
      { id: 'fournisseur', labelKey: 'achats.fournisseur', valeur: (d) => d.fournisseurNom || '—' },
      { id: 'mois', labelKey: 'listes.groupeMois', valeur: (d) => (d.date || '').slice(0, 7) || '—' },
    ],
    colonnes: {
      numero: (d) => d.numero,
      date: (d) => d.date,
      fournisseur: (d) => d.fournisseurNom,
      total: (d) => Number(d.total) || 0,
      statut: (d) => d.statut || 'Brouillon',
      reception: (d) => d.etatReception || 'en_attente',
    },
    triParDefaut: { colonne: 'date', sens: 'desc' },
  }), []));
  useEffect(() => {
    (async () => {
      try {
        const { stocks } = await getProduits(moduleType);
        setCatalogItems(stocks || []);
      } catch (err) {
        console.error('[AchatModule catalog]', err);
      }
    })();
  }, [moduleType]);

  const loadDocs = useCallback(async () => {
    try {
      const data = await getAchatsDocuments(moduleType);
      if (!data || !Array.isArray(data.documents)) {
        throw new Error('Aucune donnée reçue du serveur.');
      }
      setDocs(data.documents);
      setUseRemote(true);
    } catch (err) {
      console.error('[AchatModule remote load]', err);
      setUseRemote(false);
      const stored = await storageGet(key, []);
      setDocs(Array.isArray(stored) ? stored : []);
    } finally {
      setLoaded(true);
    }
  }, [key, moduleType]);

  useEffect(() => {
    (async () => {
      try {
        const { contacts } = await getContacts('fournisseur');
        setFournisseurs(contacts || []);
      } catch (err) {
        console.error('[AchatModule fournisseurs]', err);
      }
    })();
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  useEffect(() => {
    if (!loaded || useRemote) return;
    storageSet(key, docs);
  }, [docs, loaded, useRemote, key]);

  const supplierName = form.fournisseurId === '__autre__'
    ? form.fournisseurNom
    : fournisseurs.find(f => String(f.id) === String(form.fournisseurId))?.nom || '';

  const addLigne = () => setForm(f => ({
    ...f,
    lignes: [...f.lignes, { produit: '', quantite: '', prixUnitaire: '', stockId: null, uomId: null }],
  }));

  const removeLigne = (index) => setForm(f => ({
    ...f,
    lignes: f.lignes.filter((_, i) => i !== index),
  }));

  const updateLigne = (index, field, value) => {
    setForm(f => ({
      ...f,
      lignes: f.lignes.map((ligne, i) => i === index ? { ...ligne, [field]: value } : ligne),
    }));
  };

  const totalForm = form.lignes.reduce((sum, ligne) => sum + (Number(ligne.quantite) || 0) * (Number(ligne.prixUnitaire) || 0), 0);

  const resetForm = () => {
    setForm({ fournisseurId: '', fournisseurNom: '', notes: '', lignes: [{ produit: '', quantite: '', prixUnitaire: '', stockId: null, uomId: null }] });
    setError('');
  };

  const submitForm = async (e) => {
    e.preventDefault();
    if (!supplierName) {
      setError(t('achats.errFournisseurRequis'));
      return;
    }
    if (form.lignes.some(l => !l.produit || l.quantite === '' || l.prixUnitaire === '')) {
      setError(t('achats.errLignesIncompletes'));
      return;
    }

    const payload = {
      fournisseurId: form.fournisseurId === '__autre__' ? null : Number(form.fournisseurId),
      fournisseurNom: supplierName,
      notes: form.notes,
      lignes: form.lignes.map(l => ({
        produit: l.produit,
        quantite: Number(l.quantite),
        prixUnitaire: Number(l.prixUnitaire),
        stockId: l.stockId || null,
        uomId: l.uomId || null,
      })),
    };

    if (useRemote) {
      try {
        await createAchatDocument({ module: moduleType, ...payload });
        await loadDocs();
        resetForm();
        setAchatUrl(null);
      } catch (err) {
        setError(err.message || t('achats.errSave'));
      }
      return;
    }

    const doc = {
      id: Date.now(),
      fournisseurId: payload.fournisseurId,
      fournisseurNom: payload.fournisseurNom,
      notes: payload.notes,
      date: payload.date,
      lignes: payload.lignes,
      total: totalForm,
    };

    setDocs(docs => [doc, ...docs]);
    resetForm();
    setAchatUrl(null);
  };

  // Ligne d'achat — version formulaire de modification (fenêtre séparée)
  const addEditLigne = () => setEditForm(f => ({
    ...f,
    lignes: [...f.lignes, { produit: '', quantite: '', prixUnitaire: '', stockId: null, uomId: null }],
  }));
  const removeEditLigne = (index) => setEditForm(f => ({
    ...f,
    lignes: f.lignes.filter((_, i) => i !== index),
  }));
  const updateEditLigne = (index, field, value) => {
    setEditForm(f => ({
      ...f,
      lignes: f.lignes.map((ligne, i) => i === index ? { ...ligne, [field]: value } : ligne),
    }));
  };
  const editSupplierName = editForm.fournisseurId === '__autre__'
    ? editForm.fournisseurNom
    : fournisseurs.find(f => String(f.id) === String(editForm.fournisseurId))?.nom || '';
  const totalEditForm = editForm.lignes.reduce((sum, ligne) => sum + (Number(ligne.quantite) || 0) * (Number(ligne.prixUnitaire) || 0), 0);

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ fournisseurId: '', fournisseurNom: '', notes: '', lignes: [{ produit: '', quantite: '', prixUnitaire: '', stockId: null, uomId: null }] });
  };

  const startEdit = async (doc) => {
    setError('');
    let source = doc;
    if (useRemote) {
      try {
        const data = await getAchatDocument(doc.id);
        source = data.document;
      } catch (err) {
        setError(err.message || t('achats.errLoadDoc'));
        return;
      }
    }

    setEditingId(source.id);
    setEditForm({
      fournisseurId: source.fournisseurId ? String(source.fournisseurId) : '__autre__',
      fournisseurNom: source.fournisseurId ? '' : source.fournisseurNom,
      notes: source.notes || '',
      lignes: source.lignes.map(l => ({ produit: l.produit, quantite: String(l.quantite), prixUnitaire: String(l.prixUnitaire), stockId: l.stockId || null, uomId: l.uomId || null })),
    });
  };

  const submitEditForm = async (e) => {
    e.preventDefault();
    if (!editSupplierName) {
      setError(t('achats.errFournisseurRequis'));
      return;
    }
    if (editForm.lignes.some(l => !l.produit || l.quantite === '' || l.prixUnitaire === '')) {
      setError(t('achats.errLignesIncompletes'));
      return;
    }

    const payload = {
      fournisseurId: editForm.fournisseurId === '__autre__' ? null : Number(editForm.fournisseurId),
      fournisseurNom: editSupplierName,
      notes: editForm.notes,
      lignes: editForm.lignes.map(l => ({
        produit: l.produit,
        quantite: Number(l.quantite),
        prixUnitaire: Number(l.prixUnitaire),
        stockId: l.stockId || null,
        uomId: l.uomId || null,
      })),
    };

    setEditSubmitting(true);
    if (useRemote) {
      try {
        await updateAchatDocument(editingId, { module: moduleType, ...payload });
        await loadDocs();
        cancelEdit();
      } catch (err) {
        setError(err.message || t('achats.errSave'));
      } finally {
        setEditSubmitting(false);
      }
      return;
    }

    const doc = {
      id: editingId,
      fournisseurId: payload.fournisseurId,
      fournisseurNom: payload.fournisseurNom,
      notes: payload.notes,
      date: payload.date,
      lignes: payload.lignes,
      total: totalEditForm,
    };
    setDocs(docs => docs.map(d => d.id === editingId ? doc : d));
    setEditSubmitting(false);
    cancelEdit();
  };

  const removeDoc = async (id) => {
    if (!window.confirm(t('achats.confirmDelete'))) return;
    if (useRemote) {
      try {
        await deleteAchatDocument(id);
        await loadDocs();
      } catch (err) {
        setError(err.message || t('achats.errDeleteDoc'));
      }
      return;
    }
    setDocs(docs => docs.filter(doc => doc.id !== id));
  };

  const changerStatutDoc = async (id, action, confirmMessage) => {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    try {
      const api = {
        envoyer: envoyerAchatDocument,
        commander: commanderAchatDocument,
        annuler: annulerAchatDocument,
        remettreBrouillon: remettreBrouillonAchatDocument,
        receptionPartielle: receptionPartielleAchatDocument,
        recevoir: recevoirAchatDocument,
        annulerReception: annulerReceptionAchatDocument,
      }[action];
      await api(id);
      await loadDocs();
      notifySuccess({
        envoyer: t('achats.okEnvoye'),
        commander: t('achats.okCommande'),
        annuler: t('achats.okAnnule'),
        remettreBrouillon: t('achats.okRemisBrouillon'),
        receptionPartielle: t('achats.okPartiel'),
        recevoir: t('achats.okRecu'),
        annulerReception: t('achats.okAnnulerReception'),
      }[action]);
    } catch (err) {
      notifyError(err, t('achats.errStatut'));
    }
  };

  const openDetail = async (doc) => {
    if (useRemote) {
      try {
        const data = await getAchatDocument(doc.id);
        setDetailDoc(data.document);
      } catch (err) {
        setError(err.message || t('achats.errLoadDetail'));
      }
      return;
    }
    setDetailDoc(doc);
  };

  const closeDetail = () => setAchatUrl(null);

  const exportCsv = () => {
    const header = [t('common.date'), t('achats.fournisseur'), t('achats.notes'), t('common.total'), t('achats.detailLignes')];
    const rows = docs.map(doc => [
      doc.date,
      doc.fournisseurNom,
      doc.notes || '',
      doc.total,
      doc.lignes.map(l => `${l.produit} x${l.quantite} @ ${l.prixUnitaire}`).join(' | '),
    ]);
    const csv = [header, ...rows].map(line => line.map(celluleCsv).join(',')).join('\n');
    downloadFile(`${storageKey}.csv`, csv, 'text/csv;charset=utf-8;');
  };

  const exportPdf = () => {
    // Toute donnée saisie par un utilisateur passe par escapeHtml : cette fenêtre est de même
    // origine que l'application (voir src/lib/securite.js).
    const content = docs.map(doc => `
      <tr>
        <td>${escapeHtml(fmtDate(doc.date))}</td>
        <td>${escapeHtml(doc.fournisseurNom)}</td>
        <td>${escapeHtml(fmtMoney(doc.total))}</td>
        <td>${doc.lignes.map(l => escapeHtml(`${l.produit} x${l.quantite} — ${fmtMoney(l.prixUnitaire)}`)).join('<br />')}</td>
      </tr>
    `).join('');
    // Les couleurs de cette feuille de style restent littérales, et c est voulu : ce document
    // part à l imprimante, sur papier blanc — la palette de l application, pensée pour un fond
    // beige à l écran, n a pas cours ici.
    const printWindow = window.open('', '_blank', 'width=900,height=1000');
    if (!printWindow) return;
    printWindow.document.write(`<!doctype html><html><head><title>${t('achats.pdfTitle')}</title><style>body{font-family:Arial,sans-serif;padding:20px;color:#1f2937}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #ddd;text-align:left} th{background:#f7f7f7}</style></head><body><h2>${t('achats.pdfHeading')}</h2><table><thead><tr><th>${t('common.date')}</th><th>${t('achats.fournisseur')}</th><th>${t('common.total')}</th><th>${t('achats.detailLignes')}</th></tr></thead><tbody>${content}</tbody></table></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  // Colonnes déclarées, comme la liste des devis — voir colonnesDevis pour le pourquoi.
  const colonnesAchats = useMemo(() => [
    { id: 'numero', labelKey: 'achats.colNumero', triable: true,
      rendu: (d) => <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{d.numero || '—'}</span> },
    { id: 'date', labelKey: 'common.date', triable: true,
      rendu: (d) => <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatDateFr(d.date)}</span> },
    { id: 'fournisseur', labelKey: 'achats.fournisseur', triable: true,
      rendu: (d) => d.fournisseurNom || '—' },
    { id: 'acheteur', labelKey: 'achats.colAcheteur', triable: true, optionnelle: true,
      rendu: (d) => d.acheteurNom || '—' },
    // La référence a une « arrivée prévue » (date_planned) que nous ne collectons pas : nous
    // n'avons que la réception effective. Colonne réelle plutôt que champ inventé.
    { id: 'receptionDate', labelKey: 'achats.colReception', optionnelle: true, masqueeParDefaut: true,
      rendu: (d) => (d.dateReception ? formatDateFr(d.dateReception) : '—') },
    { id: 'notes', labelKey: 'achats.notes', optionnelle: true, masqueeParDefaut: true,
      rendu: (d) => d.notes || '—' },
    { id: 'total', labelKey: 'common.total', triable: true, alignement: 'right',
      style: { fontWeight: 600 },
      somme: (d) => Number(d.total) || 0,
      formatSomme: (n) => fmtMoney(n),
      rendu: (d) => fmtMoney(d.total) },
    { id: 'statut', labelKey: 'achats.colCommandeEtat', triable: true,
      rendu: (d) => {
        const statut = d.statut || 'Brouillon';
        const tons = { Brouillon: 'ochre', 'Envoyée': 'blue', 'Commandé': 'green', 'Annulée': 'red' };
        return <Badge tone={tons[statut] || 'blue'}>{t(`achats.statut.${statut}`, { defaultValue: statut })}</Badge>;
      } },
    { id: 'reception', labelKey: 'achats.colReceptionEtat', triable: true,
      rendu: (d) => <BadgeReception etat={d.etatReception} /> },
    // Les transitions d'état vivent dans l'en-tête de la fiche, avec la barre de chevrons —
    // comme pour un devis, et comme dans la référence, où l'action porte sur le document.
    { id: 'actions', labelKey: 'common.actions', alignement: 'right',
      rendu: (d) => {
        const modifiable = ['Brouillon', 'Envoyée'].includes(d.statut) && (d.etatReception || 'en_attente') === 'en_attente';
        if (!modifiable) return null;
        return (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: SPACE.sm }} onClick={e => e.stopPropagation()}>
            <button onClick={() => { setAchatUrl(d.id, { remplacer: false }); startEdit(d); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue }}><Settings2 size={15} /></button>
            <button onClick={() => removeDoc(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.red }}><Trash2 size={15} /></button>
          </div>
        );
      } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, fmtMoney]);

  // Réception groupée : le cas d'usage réel d'une sélection multiple ici — plusieurs commandes
  // arrivent dans le même chargement. Chaque document passe par la route unitaire existante,
  // donc la synchronisation stock/finance reste exactement celle d'une réception à l'unité.
  const recevoirLot = async (documents) => {
    if (!window.confirm(t('achats.confirmRecevoirLot', { count: documents.length }))) return;
    let echecs = 0;
    for (const d of documents) {
      try {
        await recevoirAchatDocument(d.id);
      } catch (err) {
        echecs += 1;
        console.error('[recevoirLot]', err);
      }
    }
    outilsAchats.viderSelection();
    await loadDocs();
    if (echecs > 0) notifyError(new Error(t('achats.recevoirLotEchec', { count: echecs })));
    else notifySuccess(t('achats.recevoirLotOk', { count: documents.length }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <datalist id={catalogDatalistId}>
        {catalogItems.map(item => <option key={item.id} value={item.nom} />)}
      </datalist>

      {/* Fil d'ariane local, même rôle que celui de DevisModule. */}
      {enFormulaire && (
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
          <Button variant="ghost" small onClick={retourListe}><ChevronLeft size={14} /> {t('achats.retourListe')}</Button>
          <span style={{ fontSize: TEXT.sm, color: COLORS.inkFaint }}>
            {t('achats.filAriane')} / <strong style={{ color: COLORS.inkSoft }}>
              {editingId ? t('achats.editTitle') : (enFiche ? (detailDoc?.numero || '…') : t('achats.nouveau'))}
            </strong>
          </span>
        </div>
      )}

      {/* Formulaire de création — masqué en vue « À recevoir », comme DevisModule masque le
          sien en vue « À facturer ». */}
      {!filtreReception && creationOuverte && (
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
          {t('achats.newTitle')}
        </div>
        {error && <div style={{ color: COLORS.red, marginBottom: SPACE.sm }}>{error}</div>}
        <form onSubmit={submitForm} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Select label={t('achats.fournisseur')} value={form.fournisseurId} onChange={e => setForm({ ...form, fournisseurId: e.target.value, fournisseurNom: '' })}>
            <option value="">{t('achats.selectFournisseur')}</option>
            {fournisseurs.map(f => (
              <option key={f.id} value={f.id}>{f.nom}</option>
            ))}
            <option value="__autre__">{t('achats.autreFournisseur')}</option>
          </Select>
          {form.fournisseurId === '__autre__' && (
            <Field label={t('achats.fournisseurNom')} placeholder={t('achats.fournisseurNomPlaceholder')} value={form.fournisseurNom} onChange={e => setForm({ ...form, fournisseurNom: e.target.value })} />
          )}
          <Field label={t('achats.notes')} placeholder={t('common.optionalPlaceholder')} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>{t('achats.lignesAchat')}</div>
            {form.lignes.map((ligne, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: etroitAchats ? '1fr' : '2fr 1fr 1fr auto', gap: SPACE.sm, alignItems: 'end' }}>
                <Field placeholder={t('achats.produit')} list={catalogDatalistId} value={ligne.produit} onChange={e => {
                  const value = e.target.value;
                  updateLigne(index, 'produit', value);
                  const match = catalogItems.find(item => item.nom.toLowerCase() === value.toLowerCase());
                  updateLigne(index, 'stockId', match ? match.id : null);
                  updateLigne(index, 'uomId', match ? match.uniteId || null : null);
                  if (match && match.prixDefaut != null && !ligne.prixUnitaire) {
                    updateLigne(index, 'prixUnitaire', String(match.prixDefaut));
                  }
                }} />
                <Field type="number" placeholder={t('achats.qte')} value={ligne.quantite} onChange={e => updateLigne(index, 'quantite', e.target.value)} />
                <Field type="number" placeholder={t('achats.prixU')} value={ligne.prixUnitaire} onChange={e => updateLigne(index, 'prixUnitaire', e.target.value)} />
                <button type="button" onClick={() => removeLigne(index)} disabled={form.lignes.length === 1} style={{ background: 'none', border: 'none', cursor: form.lignes.length === 1 ? 'default' : 'pointer', color: form.lignes.length === 1 ? COLORS.border : COLORS.red, padding: '8px 0' }}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <Button type="button" variant="ghost" onClick={addLigne} style={{ alignSelf: 'flex-start' }}><Plus size={14} /> {t('achats.addLigne')}</Button>
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: SPACE.sm, borderTop: `1px solid ${COLORS.border}` }}>
            <div style={{ fontSize: TEXT.md, fontWeight: 700 }}>{t('achats.totalLabel', { total: fmtMoney(totalForm) })}</div>
            <div style={{ display: 'flex', gap: SPACE.sm }}>
              <Button type="submit" variant="ochre">{t('achats.submit')}</Button>
            </div>
          </div>
        </form>
      </Card>
      )}

      {/* Bandeau de contrôle de la liste : création à gauche, exports à droite. La carte
          « Historique des achats » n'avait pas d'autre contenu que ces deux boutons. */}
      {!enFormulaire && (
        <Card>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, justifyContent: 'space-between', alignItems: 'center' }}>
            {!filtreReception ? (
              <Button variant="green" onClick={() => setAchatUrl('nouveau', { remplacer: false })}><Plus size={14} /> {t('achats.nouveau')}</Button>
            ) : <div style={{ fontWeight: 600, fontSize: TEXT.base }}>{t('achats.historique')}</div>}
            <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
              <Button small variant="outline" onClick={exportCsv}><Download size={14} /> {t('achats.exportCsv')}</Button>
              <Button small variant="outline" onClick={exportPdf}><FileText size={14} /> {t('achats.exportPdf')}</Button>
            </div>
          </div>
        </Card>
      )}
      {!enFormulaire && (
        <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <BarreOutilsListe etat={outilsAchats} placeholderRecherche={t("achats.rechercher")} />
          </div>
          <MenuColonnes etat={outilsAchats} colonnes={colonnesAchats} />
        </div>
      )}

      {!enFormulaire && (
      <Card style={{ padding: 0 }}>
        <TableauListe
          etat={outilsAchats}
          colonnes={colonnesAchats}
          cle={(d) => d.id}
          onLigneClic={(d) => setAchatUrl(d.id, { remplacer: false })}
          ligneAttenuee={(d) => d.statut === 'Annulée'}
          selectionActive
          actionsGroupees={(selection) => {
            const recevables = docs.filter(d => selection.includes(d.id) && d.statut === 'Commandé' && (d.etatReception || 'en_attente') !== 'recu');
            if (recevables.length === 0) return null;
            return (
              <Button variant="green" small onClick={() => recevoirLot(recevables)}>
                <Check size={13} /> {t('achats.recevoirLot', { count: recevables.length })}
              </Button>
            );
          }}
          vide={(
            <div style={{ padding: SPACE.xl, color: COLORS.inkSoft, fontSize: TEXT.base }}>
              {outilsAchats.actif ? t('listes.aucunResultat') : (filtreReception ? t('achats.emptyARecevoir') : t('achats.emptyTable'))}
            </div>
          )}
        />
        <PiedListe etat={outilsAchats} />
      </Card>
      )}
      {detailDoc && !editingId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <div style={{ background: '#fff', borderRadius: RADIUS.card, width: '100%', padding: SPACE.xl }}>
            {/* En-tête aligné sur la fiche d'un devis : la référence en titre, la barre d'état en
                chevrons, puis les actions de transition — dans l'ERP de référence, ces boutons
                vivent dans l'en-tête du document, pas dans la liste. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACE.md }}>
              <div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.md, fontWeight: 700 }}>{detailDoc.numero || '—'}</div>
                <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{detailDoc.fournisseurNom} · {fmtDate(detailDoc.date)}</div>
              </div>
            </div>

            {/* Deux lignes pour deux axes : la commande au-dessus, la réception en dessous.
                Les mélanger était le défaut d'origine. Les actions de chaque ligne ne portent
                que sur son propre axe. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.sm }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
                <span style={{ fontSize: TEXT.xs, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('achats.axeCommande')}</span>
                <AchatStatusBar statut={detailDoc.statut || 'Brouillon'} />
              </div>
              <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
                {detailDoc.statut === 'Brouillon' && (
                  <Button small variant="outline" onClick={() => changerStatutDoc(detailDoc.id, 'envoyer')}>{t('achats.envoyerFournisseur')}</Button>
                )}
                {['Brouillon', 'Envoyée'].includes(detailDoc.statut) && (
                  <Button small variant="green" onClick={() => changerStatutDoc(detailDoc.id, 'commander')}>{t('achats.commander')}</Button>
                )}
                {['Brouillon', 'Envoyée', 'Commandé'].includes(detailDoc.statut) && (detailDoc.etatReception || 'en_attente') === 'en_attente' && (
                  <Button small variant="danger" onClick={() => changerStatutDoc(detailDoc.id, 'annuler', t('achats.confirmAnnuler'))}>{t('common.cancel')}</Button>
                )}
                {detailDoc.statut === 'Annulée' && (
                  <Button small variant="outline" onClick={() => changerStatutDoc(detailDoc.id, 'remettreBrouillon')}>{t('achats.remettreBrouillon')}</Button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.lg }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
                <span style={{ fontSize: TEXT.xs, color: COLORS.inkFaint, textTransform: 'uppercase', letterSpacing: 0.4 }}>{t('achats.axeReception')}</span>
                <BadgeReception etat={detailDoc.etatReception} />
                {detailDoc.dateReception && (
                  <span style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{formatDateFr(detailDoc.dateReception)}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
                {detailDoc.statut === 'Commandé' && (detailDoc.etatReception || 'en_attente') === 'en_attente' && (
                  <Button small variant="outline" onClick={() => changerStatutDoc(detailDoc.id, 'receptionPartielle')}>{t('achats.marquerPartiel')}</Button>
                )}
                {detailDoc.statut === 'Commandé' && (detailDoc.etatReception || 'en_attente') !== 'recu' && (
                  <Button small variant="green" onClick={() => changerStatutDoc(detailDoc.id, 'recevoir')}>{t('achats.marquerRecu')}</Button>
                )}
                {(detailDoc.etatReception || 'en_attente') === 'recu' && (
                  <Button small variant="ghost" onClick={() => changerStatutDoc(detailDoc.id, 'annulerReception', t('achats.confirmAnnulerReception'))}>{t('achats.annulerReception')}</Button>
                )}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: etroitAchats ? '1fr' : '1fr 1fr', gap: SPACE.md, marginBottom: SPACE.md }}>
              <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}><strong>{t('common.total')}</strong><div style={{ fontWeight: 700, marginTop: SPACE.sm }}>{fmtMoney(detailDoc.total)}</div></div>
              <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}><strong>{t('achats.notes')}</strong><div style={{ marginTop: SPACE.sm }}>{detailDoc.notes || t('achats.detailNoNote')}</div></div>
            </div>
            <div style={{ marginBottom: SPACE.md }}>
              <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: SPACE.sm }}>{t('achats.detailLignes')}</div>
              <DataTable>
                <thead>
                  <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
                    <th>{t('achats.produit')}</th>
                    <th>{t('achats.qte')}</th>
                    <th>{t('achats.pu')}</th>
                    <th style={{ textAlign: 'right' }}>{t('common.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detailDoc.lignes.map((ligne, index) => (
                    <tr key={index}>
                      <td>{ligne.produit}</td>
                      <td>{ligne.quantite}</td>
                      <td>{fmtMoney(ligne.prixUnitaire)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(Number(ligne.quantite) * Number(ligne.prixUnitaire))}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
            <Button variant="ghost" onClick={closeDetail}><ChevronLeft size={14} /> {t('achats.retourListe')}</Button>
          </div>
        </div>
      )}
      {/* Édition dans le formulaire, même traitement que la fiche d'un devis. */}
      {editingId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <div style={{ background: '#fff', borderRadius: RADIUS.card, width: '100%', padding: SPACE.xl }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('achats.editTitle')}</div>
              <button onClick={cancelEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, fontSize: TEXT.lg }}>×</button>
            </div>
            {error && <div style={{ color: COLORS.red, marginBottom: SPACE.sm }}>{error}</div>}
            <form onSubmit={submitEditForm} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
              <Select label={t('achats.fournisseur')} value={editForm.fournisseurId} onChange={e => setEditForm({ ...editForm, fournisseurId: e.target.value, fournisseurNom: '' })}>
                <option value="">{t('achats.selectFournisseur')}</option>
                {fournisseurs.map(f => (
                  <option key={f.id} value={f.id}>{f.nom}</option>
                ))}
                <option value="__autre__">{t('achats.autreFournisseur')}</option>
              </Select>
              {editForm.fournisseurId === '__autre__' && (
                <Field label={t('achats.fournisseurNom')} placeholder={t('achats.fournisseurNomPlaceholder')} value={editForm.fournisseurNom} onChange={e => setEditForm({ ...editForm, fournisseurNom: e.target.value })} />
              )}
              <Field label={t('achats.notes')} placeholder={t('common.optionalPlaceholder')} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>{t('achats.lignesAchat')}</div>
                {editForm.lignes.map((ligne, index) => (
                  <div key={index} style={{ display: 'grid', gridTemplateColumns: etroitAchats ? '1fr' : '2fr 1fr 1fr auto', gap: SPACE.sm, alignItems: 'end' }}>
                    <Field placeholder={t('achats.produit')} list={catalogDatalistId} value={ligne.produit} onChange={e => {
                      const value = e.target.value;
                      updateEditLigne(index, 'produit', value);
                      const match = catalogItems.find(item => item.nom.toLowerCase() === value.toLowerCase());
                      updateEditLigne(index, 'stockId', match ? match.id : null);
                      updateEditLigne(index, 'uomId', match ? match.uniteId || null : null);
                      if (match && match.prixDefaut != null && !ligne.prixUnitaire) {
                        updateEditLigne(index, 'prixUnitaire', String(match.prixDefaut));
                      }
                    }} />
                    <Field type="number" placeholder={t('achats.qte')} value={ligne.quantite} onChange={e => updateEditLigne(index, 'quantite', e.target.value)} />
                    <Field type="number" placeholder={t('achats.prixU')} value={ligne.prixUnitaire} onChange={e => updateEditLigne(index, 'prixUnitaire', e.target.value)} />
                    <button type="button" onClick={() => removeEditLigne(index)} disabled={editForm.lignes.length === 1} style={{ background: 'none', border: 'none', cursor: editForm.lignes.length === 1 ? 'default' : 'pointer', color: editForm.lignes.length === 1 ? COLORS.border : COLORS.red, padding: '8px 0' }}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="ghost" onClick={addEditLigne} style={{ alignSelf: 'flex-start' }}><Plus size={14} /> {t('achats.addLigne')}</Button>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: SPACE.sm, borderTop: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: TEXT.md, fontWeight: 700 }}>{t('achats.totalLabel', { total: fmtMoney(totalEditForm) })}</div>
                <div style={{ display: 'flex', gap: SPACE.sm }}>
                  <Button type="button" variant="ghost" onClick={cancelEdit}>{t('common.cancel')}</Button>
                  <Button type="submit" variant="green" disabled={editSubmitting}>
                    {editSubmitting ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {t('achats.update')}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Données de démarrage Poulailler uniquement (Cultures démarre volontairement vide plutôt
// que d'inventer des données agricoles) — categorie ici est un nom à faire correspondre
// aux catégories réellement chargées au moment du seed, voir StocksTab plus bas.
const DEFAULT_STOCKS = [
  { nom: 'Aliment ponte', categorie: 'Aliment', quantite: 12, unite: 'sacs 50kg', seuil: 5 },
  { nom: 'Œufs frais', categorie: 'Œufs', quantite: 340, unite: 'unités', seuil: 100 },
  { nom: 'Poulets de chair', categorie: 'Volailles vivantes', quantite: 180, unite: 'têtes', seuil: 20 },
];

const DEFAULT_STOCKS_PISCICULTURE = [
  { nom: 'Aliment poisson', categorie: 'Aliment', quantite: 15, unite: 'sacs 25kg', seuil: 5 },
  { nom: 'Alevins tilapia', categorie: 'Alevins', quantite: 500, unite: 'unités', seuil: 100 },
  { nom: 'Tilapia adulte', categorie: 'Poissons vivants', quantite: 220, unite: 'kg', seuil: 30 },
];

function useTable(farmId, key, defaults) {
  const [rows, setRows] = useState(defaults);
  const loadedRef = useRef(false);
  useEffect(() => {
    (async () => {
      const data = await storageGet(`poulailler-${key}-${farmId}`, defaults);
      setRows(data);
      loadedRef.current = true;
    })();
  }, [farmId, key]);
  useEffect(() => {
    if (!loadedRef.current) return;
    storageSet(`poulailler-${key}-${farmId}`, rows);
  }, [rows, farmId, key]);
  return [rows, setRows];
}

// Étape A « élargissement stock » : typologie des intrants + fiche enrichie par type.
// Champs à plat sur produits (voir server/src/routes/produits.js). Le sous-formulaire est
// factorisé ici pour être identique entre le formulaire d'ajout et celui d'édition.
const TYPES_INTRANT = ['semence', 'engrais', 'phytosanitaire', 'aliment', 'materiel', 'autre'];
const INTRANT_FORM_DEFAULTS = {
  typeIntrant: '', variete: '', tauxGermination: '',
  npkN: '', npkP: '', npkK: '', npkUnit: 'percent', doseHa: '', doseHaUnite: 'kg/ha',
  matiereActive: '', numeroAmm: '', darJours: '', zntMetres: '', bioAutorise: false,
};
const INTRANT_KEYS = Object.keys(INTRANT_FORM_DEFAULTS);
const pickIntrant = (f) => Object.fromEntries(INTRANT_KEYS.map(k => [k, f[k]]));
const fillIntrant = (s) => ({
  typeIntrant: s.typeIntrant || '', variete: s.variete || '',
  tauxGermination: s.tauxGermination != null ? String(s.tauxGermination) : '',
  npkN: s.npkN != null ? String(s.npkN) : '', npkP: s.npkP != null ? String(s.npkP) : '',
  npkK: s.npkK != null ? String(s.npkK) : '', npkUnit: s.npkUnit || 'percent',
  doseHa: s.doseHa != null ? String(s.doseHa) : '', doseHaUnite: s.doseHaUnite || 'kg/ha',
  matiereActive: s.matiereActive || '', numeroAmm: s.numeroAmm || '',
  darJours: s.darJours != null ? String(s.darJours) : '',
  zntMetres: s.zntMetres != null ? String(s.zntMetres) : '', bioAutorise: !!s.bioAutorise,
});

// Un lot périmé ou proche de la péremption (≤ 30 j) — sert au surlignage et à l'alerte.
const LOT_PEREMPTION_SEUIL_JOURS = 30;
function lotPerimeSoon(datePeremption) {
  if (!datePeremption) return false;
  const j = Math.ceil((new Date(datePeremption + 'T00:00:00') - new Date()) / 86400000);
  return j <= LOT_PEREMPTION_SEUIL_JOURS;
}

function IntrantChamps({ v, patch, t }) {
  const type = v.typeIntrant;
  return (
    <>
      <Select label={t('stocks.typeIntrant')} value={type} onChange={e => patch({ typeIntrant: e.target.value })}>
        <option value="">{t('stocks.intrant.none')}</option>
        {TYPES_INTRANT.map(x => <option key={x} value={x}>{t(`stocks.intrant.${x}`)}</option>)}
      </Select>
      {type === 'semence' && (
        <>
          <Field label={t('stocks.variete')} value={v.variete} onChange={e => patch({ variete: e.target.value })} />
          <Field label={t('stocks.tauxGermination')} type="number" value={v.tauxGermination} onChange={e => patch({ tauxGermination: e.target.value })} />
        </>
      )}
      {type === 'engrais' && (
        <>
          <Field label="N" type="number" value={v.npkN} onChange={e => patch({ npkN: e.target.value })} />
          <Field label="P" type="number" value={v.npkP} onChange={e => patch({ npkP: e.target.value })} />
          <Field label="K" type="number" value={v.npkK} onChange={e => patch({ npkK: e.target.value })} />
          <Select label={t('stocks.npkUnit')} value={v.npkUnit} onChange={e => patch({ npkUnit: e.target.value })}>
            <option value="percent">%</option>
            <option value="ratio">{t('stocks.npkRatio')}</option>
          </Select>
          <Field label={t('stocks.doseHa')} type="number" value={v.doseHa} onChange={e => patch({ doseHa: e.target.value })} />
          <Field label={t('stocks.doseHaUnite')} value={v.doseHaUnite} onChange={e => patch({ doseHaUnite: e.target.value })} />
        </>
      )}
      {type === 'phytosanitaire' && (
        <>
          <Field label={t('stocks.matiereActive')} value={v.matiereActive} onChange={e => patch({ matiereActive: e.target.value })} />
          <Field label={t('stocks.numeroAmm')} value={v.numeroAmm} onChange={e => patch({ numeroAmm: e.target.value })} />
          <Field label={t('stocks.darJours')} type="number" value={v.darJours} onChange={e => patch({ darJours: e.target.value })} />
          <Field label={t('stocks.zntMetres')} type="number" value={v.zntMetres} onChange={e => patch({ zntMetres: e.target.value })} />
        </>
      )}
      {['semence', 'engrais', 'phytosanitaire'].includes(type) && (
        <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.sm, color: COLORS.inkSoft, alignSelf: 'center' }}>
          <input type="checkbox" checked={v.bioAutorise} onChange={e => patch({ bioAutorise: e.target.checked })} />
          {t('stocks.bioAutorise')}
        </label>
      )}
    </>
  );
}

function StocksTab({ farmId, moduleType = 'Poulailler', highlightId }) {
  const { t } = useTranslation();
  const { devise, fmtMoney } = useLocale();
  const api = {
    get: () => getProduits(moduleType),
    create: (payload) => createProduit({ ...payload, module: moduleType }),
    update: (id, payload) => updateProduit(id, payload),
    remove: deleteProduit,
    mouvements: getProduitMouvements,
  };

  // Catégories : vraie ressource CRUD par entreprise depuis la fusion produits
  // (2026-08-18), inspirée d'un compte ERP réel (Inventaire > Configuration >
  // Catégories de produits) — plus une liste figée dans le code.
  const [categories, setCategories] = useState([]);
  const defaultCategorieId = categories[0]?.id ?? '';
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const [newCatNom, setNewCatNom] = useState('');
  const [newCatParentId, setNewCatParentId] = useState('');
  const [catSubmitting, setCatSubmitting] = useState(false);

  // Recharge depuis le serveur plutôt qu'un ajout/retrait optimiste local : le serveur
  // trie déjà par completeName (chaîne hiérarchique), reproduire ce tri côté client pour
  // une insertion optimiste serait un second endroit à garder synchronisé avec la logique
  // du CTE récursif de la route.
  const rechargerCategories = async () => {
    const { categories: fetchedCats } = await getProduitCategories(moduleType);
    setCategories(fetchedCats || []);
  };

  const addCategorie = async (e) => {
    e.preventDefault();
    if (!newCatNom.trim()) return;
    setCatSubmitting(true);
    try {
      await createProduitCategorie({ module: moduleType, nom: newCatNom.trim(), ordre: categories.length, parentId: newCatParentId || null });
      await rechargerCategories();
      setNewCatNom('');
      setNewCatParentId('');
    } catch (err) {
      console.error('[StocksTab addCategorie]', err);
      notifyError(err, t('stocks.categorieAddError'));
    } finally {
      setCatSubmitting(false);
    }
  };
  const removeCategorie = async (id, nom) => {
    if (!window.confirm(t('stocks.confirmDeleteCategorie', { nom }))) return;
    try {
      await deleteProduitCategorie(id);
      await rechargerCategories();
    } catch (err) {
      console.error('[StocksTab removeCategorie]', err);
      notifyError(err, t('stocks.categorieDeleteError'));
    }
  };

  const [stocks, setStocks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [unites, setUnites] = useState([]);
  const [form, setForm] = useState({ nom: '', categorieId: '', quantite: '', uniteId: '', seuil: '', prixDefaut: '', cout: '', ...INTRANT_FORM_DEFAULTS });

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ nom: '', categorieId: '', quantite: '', uniteId: '', seuil: '', prixDefaut: '', cout: '', ...INTRANT_FORM_DEFAULTS });
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [historiqueArticle, setHistoriqueArticle] = useState(null);
  const [historiqueMouvements, setHistoriqueMouvements] = useState([]);
  const [historiqueLoading, setHistoriqueLoading] = useState(false);

  // Suivi de lot + péremption (étape B) — registre parallèle, un produit à la fois déplié.
  const emptyLotForm = { numeroLot: '', datePeremption: '', quantiteInitiale: '', coutUnitaire: '' };
  const [lotsFor, setLotsFor] = useState(null);
  const [lots, setLots] = useState([]);
  const [lotForm, setLotForm] = useState(emptyLotForm);
  const [lotBusy, setLotBusy] = useState(false);
  const [lotsPerimes, setLotsPerimes] = useState([]);

  const rechargerLotsPerimes = () => getLotsPerimes(LOT_PEREMPTION_SEUIL_JOURS).then(d => setLotsPerimes(d.lots || [])).catch(() => {});

  const toggleLots = async (produitId) => {
    if (lotsFor === produitId) { setLotsFor(null); setLots([]); return; }
    setLotsFor(produitId);
    setLots([]);
    setLotForm(emptyLotForm);
    try {
      const { lots: fetched } = await getProduitLots(produitId);
      setLots(fetched || []);
    } catch (err) {
      console.error('[StocksTab lots]', err);
      notifyError(err, t('stocks.lotLoadError'));
    }
  };

  const addLot = async (e) => {
    e.preventDefault();
    if (!lotForm.numeroLot.trim()) return;
    setLotBusy(true);
    try {
      const { lot } = await createProduitLot(lotsFor, {
        numeroLot: lotForm.numeroLot.trim(),
        datePeremption: lotForm.datePeremption || null,
        quantiteInitiale: lotForm.quantiteInitiale === '' ? 0 : Number(lotForm.quantiteInitiale),
        coutUnitaire: lotForm.coutUnitaire === '' ? null : Number(lotForm.coutUnitaire),
      });
      if (lot) {
        setLots(l => [...l, lot].sort((a, b) => (a.datePeremption || '9999') < (b.datePeremption || '9999') ? -1 : 1));
        setLotForm(emptyLotForm);
        rechargerLotsPerimes();
        notifySuccess(t('stocks.lotAdded'));
      }
    } catch (err) {
      console.error('[StocksTab addLot]', err);
      notifyError(err, t('stocks.lotAddError'));
    } finally {
      setLotBusy(false);
    }
  };

  const removeLot = async (lotId) => {
    try {
      await deleteProduitLot(lotId);
      setLots(l => l.filter(x => x.id !== lotId));
      rechargerLotsPerimes();
      notifySuccess(t('stocks.lotDeleted'));
    } catch (err) {
      console.error('[StocksTab removeLot]', err);
      notifyError(err, t('stocks.lotDeleteError'));
    }
  };

  const saveLotQte = async (lot, nouvelleQte) => {
    try {
      const { lot: updated } = await updateProduitLot(lot.id, {
        numeroLot: lot.numeroLot, datePeremption: lot.datePeremption || null,
        quantiteRestante: Number(nouvelleQte) || 0,
        coutUnitaire: lot.coutUnitaire, notes: lot.notes,
      });
      if (updated) {
        setLots(l => l.map(x => x.id === lot.id ? updated : x));
        rechargerLotsPerimes();
      }
    } catch (err) {
      console.error('[StocksTab saveLotQte]', err);
      notifyError(err, t('stocks.lotUpdateError'));
    }
  };

  const openHistorique = async (stock) => {
    setHistoriqueArticle(stock);
    setHistoriqueLoading(true);
    try {
      const { mouvements } = await api.mouvements(stock.id);
      setHistoriqueMouvements(mouvements || []);
    } catch (err) {
      console.error('[StocksTab historique]', err);
      notifyError(err, t('stocks.historiqueLoadError'));
      setHistoriqueMouvements([]);
    } finally {
      setHistoriqueLoading(false);
    }
  };
  const closeHistorique = () => { setHistoriqueArticle(null); setHistoriqueMouvements([]); };

  // Atterrissage depuis la recherche globale (Ctrl+K) sur un produit : une fois
  // les stocks chargés, ouvre directement son historique — pas de vrai concept
  // de "ligne sélectionnée" dans cet écran (liste + modales), donc l'historique
  // en lecture seule est le landing le plus proche de ce qui existe déjà.
  useEffect(() => {
    if (highlightId && stocks.length > 0) {
      const match = stocks.find(s => s.id === highlightId);
      if (match) openHistorique(match);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, stocks]);

  // Catégories puis stocks, dans le même effet (pas deux effets séparés) pour que le
  // seed Poulailler ci-dessous puisse résoudre un categorieId à partir du nom de
  // catégorie avant de créer les articles de démarrage.
  useEffect(() => {
    (async () => {
      try {
        const { categories: fetchedCats } = await getProduitCategories(moduleType);
        setCategories(fetchedCats || []);
        setForm(f => ({ ...f, categorieId: f.categorieId || fetchedCats?.[0]?.id || '' }));

        const { unites: fetchedUnites } = await getUnitesMesure();
        setUnites(fetchedUnites || []);

        const { stocks: fetched } = await api.get();
        const seedList = moduleType === 'Poulailler' ? DEFAULT_STOCKS
          : moduleType === 'Pisciculture' ? DEFAULT_STOCKS_PISCICULTURE
          : null;
        if (fetched.length === 0 && seedList) {
          const seeded = [];
          for (const s of seedList) {
            const cat = (fetchedCats || []).find(c => c.nom === s.categorie);
            if (!cat) continue;
            try {
              const { stock } = await api.create({ nom: s.nom, categorieId: cat.id, quantite: s.quantite, unite: s.unite, seuil: s.seuil });
              if (stock) seeded.push(stock);
            } catch (err) {
              console.error('[StocksTab seed]', err);
            }
          }
          setStocks(seeded);
        } else {
          setStocks(fetched);
        }
        rechargerLotsPerimes();
      } catch (err) {
        console.error('[StocksTab load]', err);
      } finally {
        setLoaded(true);
      }
    })();
  }, [farmId, moduleType]);

  const add = async (e) => {
    e.preventDefault();
    if (!form.nom || form.quantite === '') return;
    try {
      const { stock } = await api.create({
        nom: form.nom, categorieId: form.categorieId, quantite: Number(form.quantite), uniteId: form.uniteId || null, seuil: Number(form.seuil || 0),
        prixDefaut: form.prixDefaut === '' ? null : Number(form.prixDefaut),
        cout: form.cout === '' ? null : Number(form.cout),
        ...pickIntrant(form),
      });
      if (stock) {
        setStocks(s => [...s, stock]);
        notifySuccess(t('stocks.articleAdded'));
      }
    } catch (err) {
      console.error('[StocksTab add]', err);
      notifyError(err, t('stocks.articleAddError'));
    }
    setForm({ nom: '', categorieId: defaultCategorieId, quantite: '', uniteId: '', seuil: '', prixDefaut: '', cout: '', ...INTRANT_FORM_DEFAULTS });
  };
  const remove = async (id, nom) => {
    if (!window.confirm(t('stocks.confirmDeleteArticle', { nom }))) return;
    try {
      await api.remove(id);
      setStocks(s => s.filter(r => r.id !== id));
      notifySuccess(t('stocks.articleDeleted'));
    } catch (err) {
      console.error('[StocksTab remove]', err);
      notifyError(err, t('stocks.articleDeleteError'));
    }
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditForm({ nom: s.nom, categorieId: s.categorieId, quantite: String(s.quantite), uniteId: s.uniteId || '', seuil: String(s.seuil), prixDefaut: s.prixDefaut != null ? String(s.prixDefaut) : '', cout: s.cout != null ? String(s.cout) : '', ...fillIntrant(s) });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ nom: '', categorieId: defaultCategorieId, quantite: '', uniteId: '', seuil: '', prixDefaut: '', cout: '', ...INTRANT_FORM_DEFAULTS });
  };

  // Les outils de liste partagés. Le filtre par type d'intrant remplace la rangée de pastilles
  // maison : deux mécanismes de filtrage côte à côte sur le même écran, c'était précisément le
  // genre de disparate que cette harmonisation vise.
  const outilsArticles = useListeOutils(stocks, useMemo(() => ({
    rechercheChamps: (a) => [a.nom, a.categorie, a.variete, a.matiereActive, a.numeroAmm],
    filtres: [
      // Le filtre qui déclenche une action : ce qu'il faut racheter. Les six types d'intrants
      // suivent, cumulables entre eux comme partout ailleurs.
      { id: 'sousSeuil', labelKey: 'stocks.filtreSousSeuil', test: (a) => a.quantite <= a.seuil },
      ...TYPES_INTRANT.map((x) => ({ id: x, labelKey: `stocks.intrant.${x}`, test: (a) => a.typeIntrant === x })),
    ],
    groupes: [
      { id: 'categorie', labelKey: 'stocks.categorie', valeur: (a) => a.categorie || '—' },
      { id: 'typeIntrant', labelKey: 'stocks.typeIntrant', valeur: (a) => a.typeIntrant || '—' },
    ],
    colonnes: {
      nom: (a) => a.nom,
      categorie: (a) => a.categorie,
      typeIntrant: (a) => a.typeIntrant,
      quantite: (a) => a.quantite,
      seuil: (a) => a.seuil,
      prixDefaut: (a) => a.prixDefaut,
    },
    triParDefaut: { colonne: 'nom', sens: 'asc' },
  }), []));

  const colonnesArticles = useMemo(() => [
    { id: 'nom', labelKey: 'stocks.article', triable: true, principale: true, style: { fontWeight: 500 },
      rendu: (a) => (
        <>
          {a.nom}
          {a.bioAutorise ? <span title={t('stocks.bioAutorise')} style={{ marginLeft: SPACE.sm, color: COLORS.green, fontSize: TEXT.xs }}>bio</span> : null}
        </>
      ) },
    { id: 'categorie', labelKey: 'stocks.categorie', triable: true, rendu: (a) => <Badge tone="ochre">{a.categorie}</Badge> },
    { id: 'typeIntrant', labelKey: 'stocks.typeIntrant', triable: true, optionnelle: true,
      rendu: (a) => (
        <span style={{ color: COLORS.inkSoft, fontSize: TEXT.sm }}>
          {a.typeIntrant ? t(`stocks.intrant.${a.typeIntrant}`) : '—'}
          {a.typeIntrant === 'phytosanitaire' && a.darJours != null
            ? <span style={{ color: COLORS.ochre }}> · {t('stocks.darShort', { n: a.darJours })}</span> : null}
        </span>
      ) },
    { id: 'quantite', labelKey: 'stocks.quantite', triable: true, rendu: (a) => `${a.quantite} ${a.unite || ''}` },
    { id: 'seuil', labelKey: 'stocks.seuil', triable: true,
      rendu: (a) => (a.quantite <= a.seuil
        ? <span style={{ color: COLORS.red, display: 'flex', alignItems: 'center', gap: SPACE.xs, fontWeight: 600 }}><AlertTriangle size={13} /> {t('stocks.stockLow', { seuil: a.seuil })}</span>
        : <span style={{ color: COLORS.inkSoft }}>{a.seuil}</span>) },
    { id: 'prixDefaut', labelKey: 'stocks.prixDefaut', triable: true, optionnelle: true,
      rendu: (a) => <span style={{ color: COLORS.inkSoft }}>{a.prixDefaut != null ? fmtMoney(a.prixDefaut) : '—'}</span> },
    { id: 'actions', labelKey: 'common.actions', alignement: 'right', masqueeSurCarte: true,
      rendu: (a) => (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: SPACE.sm }}>
          <button onClick={() => toggleLots(a.id)} title={t('stocks.lotsTitle')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: lotsFor === a.id ? COLORS.ochre : COLORS.inkSoft, display: 'flex' }}>
            <Package size={15} />
          </button>
          <button onClick={() => openHistorique(a)} title={t('stocks.historiqueTitle')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, display: 'flex' }}>
            <History size={15} />
          </button>
          <button onClick={() => startEdit(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue, display: 'flex' }}>
            <Settings2 size={15} />
          </button>
          <button onClick={() => remove(a.id, a.nom)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, display: 'flex' }}>
            <Trash2 size={15} />
          </button>
        </div>
      ) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, lotsFor, fmtMoney]);

  // Le dépli des lots : extrait tel quel de la ligne supplémentaire qu'il occupait dans le
  // tableau. Le composant partagé ne fait que lui ménager la place — sous la ligne en tableau,
  // sous la carte sur un téléphone, où il n'y a pas de colonne à étendre.
  const rendreLotsArticle = () => (
    <>
      <div style={{ fontSize: TEXT.sm, fontWeight: 600, marginBottom: SPACE.sm }}>{t('stocks.lotsTitle')}</div>
      {lots.length === 0 ? (
        <div style={{ color: COLORS.inkSoft, fontSize: TEXT.sm }}>{t('stocks.lotsEmpty')}</div>
      ) : (
        <DataTable style={{ marginBottom: SPACE.sm }}>
          <thead><tr style={{ color: COLORS.inkSoft }}>
            <th>{t('stocks.lotNumero')}</th>
            <th>{t('stocks.lotDateEntree')}</th>
            <th>{t('stocks.lotPeremption')}</th>
            <th>{t('stocks.lotRestant')}</th>
            <th>{t('stocks.coutRevient', { devise })}</th>
            <th></th>
          </tr></thead>
          <tbody>
            {lots.map(l => (
              <tr key={l.id} style={lotPerimeSoon(l.datePeremption) ? { background: COLORS.redSoft } : undefined}>
                <td style={{ fontWeight: 500 }}>{l.numeroLot}</td>
                <td style={{ color: COLORS.inkSoft }}>{l.dateEntree}</td>
                <td style={{ color: lotPerimeSoon(l.datePeremption) ? COLORS.red : COLORS.inkSoft, fontWeight: lotPerimeSoon(l.datePeremption) ? 600 : 400 }}>{l.datePeremption || '—'}</td>
                <td>
                  <input type="number" defaultValue={l.quantiteRestante}
                    onBlur={e => { if (Number(e.target.value) !== l.quantiteRestante) saveLotQte(l, e.target.value); }}
                    style={{ width: 70, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.control, padding: '2px 6px', fontSize: TEXT.sm }} />
                  <span style={{ color: COLORS.inkSoft, fontSize: TEXT.xs }}> / {l.quantiteInitiale}</span>
                </td>
                <td style={{ color: COLORS.inkSoft }}>{l.coutUnitaire != null ? fmtMoney(l.coutUnitaire) : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button onClick={() => removeLot(l.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, display: 'flex' }}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <form onSubmit={addLot} style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap', alignItems: 'end' }}>
        <Field label={t('stocks.lotNumero')} value={lotForm.numeroLot} onChange={e => setLotForm({ ...lotForm, numeroLot: e.target.value })} />
        <Field label={t('stocks.lotPeremption')} type="date" value={lotForm.datePeremption} onChange={e => setLotForm({ ...lotForm, datePeremption: e.target.value })} />
        <Field label={t('stocks.lotQuantiteInitiale')} type="number" value={lotForm.quantiteInitiale} onChange={e => setLotForm({ ...lotForm, quantiteInitiale: e.target.value })} />
        <Field label={t('stocks.coutRevient', { devise })} type="number" placeholder={t('stocks.optionalPlaceholder')} value={lotForm.coutUnitaire} onChange={e => setLotForm({ ...lotForm, coutUnitaire: e.target.value })} />
        <Button type="submit" disabled={lotBusy} style={{ whiteSpace: 'nowrap' }}>
          {lotBusy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {t('stocks.lotAdd')}
        </Button>
      </form>
    </>
  );


  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editForm.nom || editForm.quantite === '') return;
    setEditSubmitting(true);
    try {
      const { stock } = await api.update(editingId, {
        nom: editForm.nom, categorieId: editForm.categorieId, quantite: Number(editForm.quantite), uniteId: editForm.uniteId || null, seuil: Number(editForm.seuil || 0),
        prixDefaut: editForm.prixDefaut === '' ? null : Number(editForm.prixDefaut),
        cout: editForm.cout === '' ? null : Number(editForm.cout),
        ...pickIntrant(editForm),
      });
      if (stock) {
        setStocks(s => s.map(r => r.id === editingId ? stock : r));
        notifySuccess(t('stocks.articleUpdated'));
      }
      cancelEdit();
    } catch (err) {
      console.error('[StocksTab saveEdit]', err);
      notifyError(err, t('stocks.articleUpdateError'));
    } finally {
      setEditSubmitting(false);
    }
  };

  // Évolution réelle de la VALEUR du stock, reconstituée côté serveur depuis stock_moves.
  // Avant, trois des quatre points étaient fabriqués (total actuel moins 120, 80 puis 40)
  // et affichés comme un historique ; l'axe est passé en valeur parce qu'un module mélange
  // des kilos, des litres et des sacs, dont la somme brute ne veut rien dire.
  // Sous-onglet interne, en état local comme celui de VentesWithDevis : l'URL porte déjà
  // l'onglet de module (?onglet=stocks), et un troisième niveau dans l'adresse n'apporterait
  // rien tant qu'aucun de ces écrans n'est un document qu'on partage.
  const [sousOnglet, setSousOnglet] = useState('articles');
  const [evolution, setEvolution] = useState(null);
  useEffect(() => {
    let vivant = true;
    getEvolutionStock(moduleType, 6)
      .then((d) => { if (vivant) setEvolution(d); })
      .catch(() => { if (vivant) setEvolution(null); });
    return () => { vivant = false; };
  }, [moduleType, stocks.length]);
  const moisCourts = t('common.months', { returnObjects: true });
  const stockEvolution = (evolution && evolution.points ? evolution.points : []).map((pt) => ({
    id: pt.mois,
    label: Array.isArray(moisCourts) ? moisCourts[Number(pt.mois.slice(5, 7)) - 1] : pt.mois,
    value: pt.valeur,
  }));

  if (!loaded) {
    return <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}>{t('stocks.loading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <SousNavOnglets items={STOCKS_SOUS_NAV} actif={sousOnglet} onSelect={setSousOnglet} />

      {sousOnglet === 'articles' && (
        <>
      <Card>
        <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Field label={t('stocks.article')} placeholder={t('stocks.articlePlaceholder')} value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} />
          <Select label={t('stocks.categorie')} value={form.categorieId} onChange={e => setForm({ ...form, categorieId: Number(e.target.value) })}>
            {categories.map(c => <option key={c.id} value={c.id}>{c.completeName || c.nom}</option>)}
          </Select>
          <Field label={t('stocks.quantite')} type="number" placeholder="0" value={form.quantite} onChange={e => setForm({ ...form, quantite: e.target.value })} />
          <Select label={t('stocks.unite')} value={form.uniteId} onChange={e => setForm({ ...form, uniteId: e.target.value ? Number(e.target.value) : '' })}>
            <option value="">{t('stocks.uniteAucune')}</option>
            {unites.map(u => <option key={u.id} value={u.id}>{u.categorieNom} — {u.nom}{u.symbole ? ` (${u.symbole})` : ''}</option>)}
          </Select>
          <Field label={t('stocks.seuilAlerte')} type="number" placeholder="0" value={form.seuil} onChange={e => setForm({ ...form, seuil: e.target.value })} />
          <Field label={t('stocks.prixDefautField', { devise })} type="number" placeholder={t('stocks.optionalPlaceholder')} value={form.prixDefaut} onChange={e => setForm({ ...form, prixDefaut: e.target.value })} />
          <Field label={t('stocks.coutRevient', { devise })} type="number" placeholder={t('stocks.optionalPlaceholder')} value={form.cout} onChange={e => setForm({ ...form, cout: e.target.value })} />
          <IntrantChamps v={form} patch={p => setForm(f => ({ ...f, ...p }))} t={t} />
          <Button variant="ochre" type="submit"><Plus size={15} /> {t('common.add')}</Button>
        </form>
        <button type="button" onClick={() => setCatManagerOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue, fontSize: TEXT.sm, padding: 0, marginTop: SPACE.sm }}>
          {catManagerOpen ? t('stocks.hideCategories') : t('stocks.manageCategories')}
        </button>
        {catManagerOpen && (
          <div style={{ marginTop: SPACE.sm, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            {categories.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: TEXT.base }}>
                <span>{c.completeName || c.nom}</span>
                <button type="button" onClick={() => removeCategorie(c.id, c.nom)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, display: 'flex' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <form onSubmit={addCategorie} style={{ display: 'flex', gap: SPACE.sm }}>
              <Field placeholder={t('stocks.newCategorie')} value={newCatNom} onChange={e => setNewCatNom(e.target.value)} />
              <select className="flat-input" value={newCatParentId} onChange={e => setNewCatParentId(e.target.value)} style={{ maxWidth: 180 }}>
                <option value="">{t('stocks.categorieParentNone')}</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.completeName || c.nom}</option>)}
              </select>
              <Button type="submit" disabled={catSubmitting} style={{ whiteSpace: 'nowrap' }}>
                {catSubmitting ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {t('common.add')}
              </Button>
            </form>
          </div>
        )}
      </Card>
      {lotsPerimes.length > 0 && (
        <Card style={{ background: COLORS.ochreSoft, border: `1px solid ${COLORS.ochre}`, fontSize: TEXT.base }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontWeight: 600, marginBottom: SPACE.xs }}>
            <AlertTriangle size={15} /> {t('stocks.lotsPerimesTitle', { n: lotsPerimes.length, jours: LOT_PEREMPTION_SEUIL_JOURS })}
          </div>
          <div style={{ color: COLORS.inkSoft }}>
            {lotsPerimes.slice(0, 6).map(l => `${l.produitNom} · ${t('stocks.lotShort', { numero: l.numeroLot })} · ${l.datePeremption}`).join('  —  ')}
            {lotsPerimes.length > 6 ? ` …+${lotsPerimes.length - 6}` : ''}
          </div>
        </Card>
      )}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: `${SPACE.md}px ${SPACE.lg}px 0` }}>
          <BarreOutilsListe etat={outilsArticles} placeholderRecherche={t('stocks.rechercher')} />
        </div>
        <TableauListe
          etat={outilsArticles}
          colonnes={colonnesArticles}
          cle={(a) => a.id}
          rendreDepli={(a) => (lotsFor === a.id ? rendreLotsArticle() : null)}
          vide={(
            <div style={{ padding: SPACE.lg, color: COLORS.inkSoft, fontSize: TEXT.base }}>
              {outilsArticles.actif ? t('listes.aucunResultat') : t('stocks.emptyTable')}
            </div>
          )}
        />
        <PiedListe etat={outilsArticles} />
      </Card>
        </>
      )}

      {sousOnglet === 'inventaire' && (
        <>
          <InventaireRebutPanel
            module={moduleType}
            produits={stocks}
            ouvertParDefaut
            onQuantiteChangee={(id, quantite) => setStocks(liste => liste.map(p => (p.id === id ? { ...p, quantite } : p)))}
          />
          <StockEmplacementsPanel module={moduleType} ouvertParDefaut />
          <TransfertsStockPanel module={moduleType} produits={stocks} />
      <Card>
        <div style={{ fontSize: TEXT.base, fontWeight: 600, marginBottom: 2 }}>{t('stocks.stockEvolution')}</div>
        <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft, marginBottom: SPACE.sm }}>{t('stocks.stockEvolutionAide')}</div>
        {stockEvolution.length === 0 ? (
          <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{t('stocks.stockEvolutionVide')}</div>
        ) : (
          <>
            <MiniChart data={stockEvolution} color={COLORS.blue} />
            {evolution && evolution.sansCout > 0 && (
              <div style={{ fontSize: TEXT.xs, color: COLORS.ochre, marginTop: SPACE.sm }}>
                {t('stocks.stockEvolutionSansCout', { count: evolution.sansCout })}
              </div>
            )}
          </>
        )}
      </Card>
        </>
      )}

      {sousOnglet === 'transformation' && (
        <>
          <OrdresTransformationPanel module={moduleType} ouvertParDefaut />
          <HaccpPanel module={moduleType} ouvertParDefaut />
        </>
      )}

      {sousOnglet === 'configuration' && (
        <>
          <ProduitTemplatesPanel module={moduleType} categories={categories} ouvertParDefaut />
          <ProduitRecettesPanel module={moduleType} produits={stocks} ouvertParDefaut />
        </>
      )}


      {editingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={cancelEdit}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: RADIUS.card, width: '90%', maxWidth: 500, padding: SPACE.xl }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('stocks.editArticle')}</div>
              <button onClick={cancelEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, fontSize: TEXT.lg }}>×</button>
            </div>
            <form onSubmit={saveEdit} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
                <Field label={t('stocks.article')} placeholder={t('stocks.articlePlaceholder')} value={editForm.nom} onChange={e => setEditForm({ ...editForm, nom: e.target.value })} required />
                <Select label={t('stocks.categorie')} value={editForm.categorieId} onChange={e => setEditForm({ ...editForm, categorieId: Number(e.target.value) })}>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.completeName || c.nom}</option>)}
                </Select>
                <Field label={t('stocks.quantite')} type="number" placeholder="0" value={editForm.quantite} onChange={e => setEditForm({ ...editForm, quantite: e.target.value })} required />
                <Select label={t('stocks.unite')} value={editForm.uniteId} onChange={e => setEditForm({ ...editForm, uniteId: e.target.value ? Number(e.target.value) : '' })}>
                  <option value="">{t('stocks.uniteAucune')}</option>
                  {unites.map(u => <option key={u.id} value={u.id}>{u.categorieNom} — {u.nom}{u.symbole ? ` (${u.symbole})` : ''}</option>)}
                </Select>
                <Field label={t('stocks.seuilAlerte')} type="number" placeholder="0" value={editForm.seuil} onChange={e => setEditForm({ ...editForm, seuil: e.target.value })} />
                <Field label={t('stocks.prixDefautField', { devise })} type="number" placeholder={t('stocks.optionalPlaceholder')} value={editForm.prixDefaut} onChange={e => setEditForm({ ...editForm, prixDefaut: e.target.value })} />
                <Field label={t('stocks.coutRevient', { devise })} type="number" placeholder={t('stocks.optionalPlaceholder')} value={editForm.cout} onChange={e => setEditForm({ ...editForm, cout: e.target.value })} />
                <IntrantChamps v={editForm} patch={p => setEditForm(f => ({ ...f, ...p }))} t={t} />
              </div>
              <div style={{ display: 'flex', gap: SPACE.sm }}>
                <Button type="submit" variant="green" disabled={editSubmitting}>
                  {editSubmitting ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {t('common.save')}
                </Button>
                <Button type="button" onClick={cancelEdit}>{t('common.cancel')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historiqueArticle && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={closeHistorique}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: RADIUS.card, width: '90%', maxWidth: 800, maxHeight: '80vh', overflowY: 'auto', padding: SPACE.xl }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg }}>
              <div>
                <div style={{ fontSize: TEXT.md, fontWeight: 700 }}>{historiqueArticle.nom}</div>
                <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('stocks.historiqueTitle')}</div>
              </div>
              <button onClick={closeHistorique} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, fontSize: TEXT.lg }}>×</button>
            </div>
            {historiqueLoading ? (
              <div style={{ color: COLORS.inkSoft }}>{t('common.loading')}</div>
            ) : historiqueMouvements.length === 0 ? (
              <div style={{ color: COLORS.inkSoft }}>{t('stocks.historiqueEmpty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                {historiqueMouvements.map(m => (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card }}>
                    <div>
                      <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>{t(`stocks.raison.${m.raison}`, { defaultValue: m.raison })}</div>
                      <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{formatDateTimeFr(m.createdAt)}</div>
                    </div>
                    <div style={{ fontWeight: 700, color: m.delta >= 0 ? COLORS.green : COLORS.red }}>
                      {m.delta >= 0 ? '+' : ''}{m.delta}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{2}\/\d{2}\/\d{4}/.test(text)) {
    const [d, m, y] = text.split('/').map(Number);
    return new Date(y, m - 1, d);
  }
  const iso = text.split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Formate une date venant du serveur (ISO) selon la LOCALE de l'entreprise (fmtDate,
// src/lib/locale.jsx) — plus de format fr-FR figé. Repli sur la valeur brute si illisible
// (certains appels s'attendent à une chaîne vide plutôt qu'à un tiret).
function formatDateFr(value) {
  const d = parseDate(value);
  return d ? fmtDate(d, { dateStyle: 'short' }) : (value || '');
}

// Idem pour un timestamp complet (date + heure) affiché dans les historiques.
function formatDateTimeFr(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : fmtDate(d, { dateStyle: 'short', timeStyle: 'short' });
}

// Jour civil porté par une valeur de date, lu TEL QUEL. Une date de pièce ('2026-09-08')
// désigne un jour du calendrier, pas un instant : la convertir en Date puis la reprojeter
// dans un fuseau la ferait reculer ou avancer d un jour. On extrait donc directement les
// composantes, sans passer par un instant.
function jourCivil(valeur) {
  if (valeur == null || valeur === '') return null;
  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return null;
    const m = String(valeur.getMonth() + 1).padStart(2, '0');
    const j = String(valeur.getDate()).padStart(2, '0');
    return `${valeur.getFullYear()}-${m}-${j}`;
  }
  const texte = String(valeur).trim();
  // Reconnaissance par position plutôt que par expression régulière : les deux seuls formats
  // produits par l'app sont 'AAAA-MM-JJ…' (API) et 'JJ/MM/AAAA' (saisie française).
  const chiffres = (s) => /^[0-9]+$/.test(s);
  if (texte.length >= 10 && texte[4] === '-' && texte[7] === '-'
      && chiffres(texte.slice(0, 4)) && chiffres(texte.slice(5, 7)) && chiffres(texte.slice(8, 10))) {
    return texte.slice(0, 10);
  }
  if (texte.length >= 10 && texte[2] === '/' && texte[5] === '/'
      && chiffres(texte.slice(0, 2)) && chiffres(texte.slice(3, 5)) && chiffres(texte.slice(6, 10))) {
    return `${texte.slice(6, 10)}-${texte.slice(3, 5)}-${texte.slice(0, 2)}`;
  }
  const d = parseDate(texte);
  return d ? jourCivil(d) : null;
}

// Filtrage par période. Le serveur date les pièces dans le fuseau de l ENTREPRISE (fonction
// SQL date_entreprise) ; « aujourd hui » doit donc être calculé dans ce même fuseau, sinon
// une vente saisie en soirée bascule d un jour. La date de la pièce, elle, est un jour civil
// déjà exprimé dans ce fuseau : on la compare telle quelle, en chaînes AAAA-MM-JJ, qui
// s'ordonnent naturellement.
function matchesPeriod(rowDate, period) {
  const jour = jourCivil(rowDate);
  if (!jour) return true;
  const { fuseau } = getLocaleConfig();
  const aujourdhui = jourEntreprise(new Date(), fuseau);
  if (!aujourdhui) return true;

  if (period === 'jour') return jour === aujourdhui;

  const [a, m, j] = aujourdhui.split('-').map(Number);
  const repere = new Date(Date.UTC(a, m - 1, j));
  const isoUtc = (d) => d.toISOString().slice(0, 10);

  if (period === 'semaine') {
    const jourSemaine = repere.getUTCDay();
    const decalage = jourSemaine === 0 ? -6 : 1 - jourSemaine; // semaine commençant lundi
    const debutSemaine = new Date(repere);
    debutSemaine.setUTCDate(repere.getUTCDate() + decalage);
    return jour >= isoUtc(debutSemaine);
  }
  if (period === 'mois') return jour >= isoUtc(new Date(Date.UTC(a, m - 1, 1)));
  if (period === 'annee') return jour >= isoUtc(new Date(Date.UTC(a, 0, 1)));
  return true;
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const STATUTS = ['En attente', 'En cours', 'Livré'];
function LivraisonsTab({ farmId }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ client: '', produit: '', quantite: '' });

  useEffect(() => {
    (async () => {
      try {
        const { livraisons } = await getPoulaillerLivraisons();
        setRows(livraisons);
      } catch (err) {
        console.error('[LivraisonsTab load]', err);
      } finally {
        setLoaded(true);
      }
    })();
  }, [farmId]);

  const add = async (e) => {
    e.preventDefault();
    if (!form.client || !form.produit) return;
    try {
      const { livraison } = await createPoulaillerLivraison({ client: form.client, produit: form.produit, quantite: Number(form.quantite || 0) });
      if (livraison) {
        setRows(r => [livraison, ...r]);
        notifySuccess(t('poulailler.livraisonPlanifiee'));
      }
    } catch (err) {
      console.error('[LivraisonsTab add]', err);
      notifyError(err, t('poulailler.livraisonAddError'));
    }
    setForm({ client: '', produit: '', quantite: '' });
  };
  const remove = async (id, produit) => {
    if (!window.confirm(t('poulailler.confirmDeleteLivraison', { produit }))) return;
    try {
      await deletePoulaillerLivraison(id);
      setRows(r => r.filter(x => x.id !== id));
      notifySuccess(t('poulailler.livraisonDeleted'));
    } catch (err) {
      console.error('[LivraisonsTab remove]', err);
      notifyError(err, t('poulailler.livraisonDeleteError'));
    }
  };
  const setStatut = async (id, statut) => {
    setRows(r => r.map(x => x.id === id ? { ...x, statut } : x));
    try {
      await updatePoulaillerLivraison(id, { statut });
    } catch (err) {
      console.error('[LivraisonsTab setStatut]', err);
      notifyError(err, t('poulailler.statutUpdateError'));
    }
  };

  if (!loaded) {
    return <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}>{t('poulailler.livraisonsLoading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Field label={t('poulailler.client')} placeholder={t('poulailler.clientPlaceholder')} value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} />
          <Field label={t('poulailler.produit')} placeholder={t('poulailler.produitPlaceholder')} value={form.produit} onChange={e => setForm({ ...form, produit: e.target.value })} />
          <Field label={t('poulailler.quantite')} type="number" placeholder="0" value={form.quantite} onChange={e => setForm({ ...form, quantite: e.target.value })} />
          <Button variant="ochre" type="submit"><Plus size={15} /> {t('poulailler.planifier')}</Button>
        </form>
      </Card>
      <Card style={{ padding: 0 }}>
        <DataTable>
          <thead>
            <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
              <th>{t('common.date')}</th><th>{t('poulailler.client')}</th><th>{t('poulailler.produit')}</th><th>{t('poulailler.colQte')}</th><th>{t('common.status')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.base }}>{formatDateFr(r.date)}</td>
                <td>{r.client}</td>
                <td>{r.produit}</td>
                <td>{r.quantite}</td>
                <td>
                  <select value={r.statut} onChange={e => setStatut(r.id, e.target.value)} style={{
                    fontSize: TEXT.sm, fontWeight: 600, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.pill,
                    padding: '4px 8px', background: COLORS.surfaceAlt, color: COLORS.ink
                  }}>
                    {STATUTS.map(s => <option key={s} value={s}>{t(`poulailler.statut.${s}`, { defaultValue: s })}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button onClick={() => remove(r.id, r.produit)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft }}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </div>
  );
}

// Mirroir quasi verbatim de LivraisonsTab, câblé sur les routes /api/pisciculture/livraisons.
function PiscicultureLivraisonsTab({ farmId }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ client: '', produit: '', quantite: '' });

  useEffect(() => {
    (async () => {
      try {
        const { livraisons } = await getPiscicultureLivraisons();
        setRows(livraisons);
      } catch (err) {
        console.error('[PiscicultureLivraisonsTab load]', err);
      } finally {
        setLoaded(true);
      }
    })();
  }, [farmId]);

  const add = async (e) => {
    e.preventDefault();
    if (!form.client || !form.produit) return;
    try {
      const { livraison } = await createPiscicultureLivraison({ client: form.client, produit: form.produit, quantite: Number(form.quantite || 0) });
      if (livraison) {
        setRows(r => [livraison, ...r]);
        notifySuccess(t('pisciculture.livraisonPlanifiee'));
      }
    } catch (err) {
      console.error('[PiscicultureLivraisonsTab add]', err);
      notifyError(err, t('pisciculture.livraisonAddError'));
    }
    setForm({ client: '', produit: '', quantite: '' });
  };
  const remove = async (id, produit) => {
    if (!window.confirm(t('pisciculture.confirmDeleteLivraison', { produit }))) return;
    try {
      await deletePiscicultureLivraison(id);
      setRows(r => r.filter(x => x.id !== id));
      notifySuccess(t('pisciculture.livraisonDeleted'));
    } catch (err) {
      console.error('[PiscicultureLivraisonsTab remove]', err);
      notifyError(err, t('pisciculture.livraisonDeleteError'));
    }
  };
  const setStatut = async (id, statut) => {
    setRows(r => r.map(x => x.id === id ? { ...x, statut } : x));
    try {
      await updatePiscicultureLivraison(id, { statut });
    } catch (err) {
      console.error('[PiscicultureLivraisonsTab setStatut]', err);
      notifyError(err, t('pisciculture.statutUpdateError'));
    }
  };

  if (!loaded) {
    return <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}>{t('pisciculture.livraisonsLoading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Field label={t('pisciculture.client')} placeholder={t('pisciculture.clientPlaceholder')} value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} />
          <Field label={t('pisciculture.produit')} placeholder={t('pisciculture.produitPlaceholder')} value={form.produit} onChange={e => setForm({ ...form, produit: e.target.value })} />
          <Field label={t('pisciculture.quantite')} type="number" placeholder="0" value={form.quantite} onChange={e => setForm({ ...form, quantite: e.target.value })} />
          <Button variant="ochre" type="submit"><Plus size={15} /> {t('pisciculture.planifier')}</Button>
        </form>
      </Card>
      <Card style={{ padding: 0 }}>
        <DataTable>
          <thead>
            <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
              <th>{t('common.date')}</th><th>{t('pisciculture.client')}</th><th>{t('pisciculture.produit')}</th><th>{t('pisciculture.colQte')}</th><th>{t('common.status')}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.base }}>{formatDateFr(r.date)}</td>
                <td>{r.client}</td>
                <td>{r.produit}</td>
                <td>{r.quantite}</td>
                <td>
                  <select value={r.statut} onChange={e => setStatut(r.id, e.target.value)} style={{
                    fontSize: TEXT.sm, fontWeight: 600, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.pill,
                    padding: '4px 8px', background: COLORS.surfaceAlt, color: COLORS.ink
                  }}>
                    {STATUTS.map(s => <option key={s} value={s}>{t(`pisciculture.statut.${s}`, { defaultValue: s })}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button onClick={() => remove(r.id, r.produit)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft }}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </div>
  );
}

function ComptabiliteTab({ farmId, ventesKey = 'ventes', achatsKey = 'achats', remoteVentes, remoteAchats, remoteHistorique }) {
  const { t } = useTranslation();
  const { fmtMoney, fmtDate } = useLocale();
  const [localVentes] = useTable(farmId, remoteVentes ? '__unused-ventes' : ventesKey, []);
  const [localAchats] = useTable(farmId, remoteAchats ? '__unused-achats' : achatsKey, []);
  const [fetchedVentes, setFetchedVentes] = useState([]);
  const [fetchedAchats, setFetchedAchats] = useState([]);

  // Popup listant l'historique global des modifications/suppressions du module
  const [historiqueOpen, setHistoriqueOpen] = useState(false);
  const [historiqueData, setHistoriqueData] = useState([]);
  const [historiqueLoading, setHistoriqueLoading] = useState(false);

  useEffect(() => {
    if (remoteVentes) remoteVentes().then(setFetchedVentes).catch(err => console.error('[ComptabiliteTab ventes]', err));
  }, [remoteVentes]);
  useEffect(() => {
    if (remoteAchats) remoteAchats().then(setFetchedAchats).catch(err => console.error('[ComptabiliteTab achats]', err));
  }, [remoteAchats]);

  const openHistorique = async () => {
    if (!remoteHistorique) return;
    setHistoriqueOpen(true);
    setHistoriqueLoading(true);
    try {
      const data = await remoteHistorique();
      setHistoriqueData(data.historique || []);
    } catch (err) {
      console.error('[ComptabiliteTab historique]', err);
    } finally {
      setHistoriqueLoading(false);
    }
  };

  const ventes = remoteVentes ? fetchedVentes : localVentes;
  const achats = remoteAchats ? fetchedAchats : localAchats;

  const totalVentes = ventes.reduce((s, r) => s + montantLigneEntreprise(r), 0);
  const totalAchats = achats.reduce((s, r) => s + r.quantite * r.prixUnitaire, 0);
  const solde = totalVentes - totalAchats;

  const ledger = [
    ...ventes.map(v => ({ ...v, type: 'Vente', montant: montantLigneEntreprise(v) })),
    ...achats.map(a => ({ ...a, type: 'Achat', montant: -(a.quantite * a.prixUnitaire) })),
  ].sort((a, b) => {
    const dateDiff = (parseDate(b.date)?.getTime() || 0) - (parseDate(a.date)?.getTime() || 0);
    if (dateDiff !== 0) return dateDiff;
    return String(b.id).localeCompare(String(a.id));
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: SPACE.md }}>
        <Card style={{ background: COLORS.greenSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600, marginBottom: SPACE.xs }}>{t('compta.totalVentes')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.green }}>{fmtMoney(totalVentes)}</div>
        </Card>
        <Card style={{ background: COLORS.redSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.red, fontWeight: 600, marginBottom: SPACE.xs }}>{t('compta.totalAchats')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.red }}>{fmtMoney(totalAchats)}</div>
        </Card>
        <Card style={{ background: solde >= 0 ? COLORS.blueSoft : COLORS.redSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: solde >= 0 ? COLORS.blue : COLORS.red, fontWeight: 600, marginBottom: SPACE.xs }}>{t('compta.solde')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: solde >= 0 ? COLORS.blue : COLORS.red }}>{fmtMoney(solde)}</div>
        </Card>
      </div>

      {/* Bouton d'accès au journal complet des modifications/suppressions */}
      {remoteHistorique && (
        <Button variant="outline" onClick={openHistorique} style={{ alignSelf: 'flex-start' }}>
          <ClipboardList size={15} /> {t('compta.historiqueBtn')}
        </Button>
      )}

      <Card style={{ padding: 0 }}>
        <DataTable>
          <thead>
            <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
              <th>{t('common.date')}</th><th>{t('compta.type')}</th><th>{t('compta.detail')}</th><th style={{ textAlign: 'right' }}>{t('common.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 && (
              <tr><td colSpan={4} style={{ padding: SPACE.xl, color: COLORS.inkSoft, textAlign: 'center' }}>{t('compta.emptyLedger')}</td></tr>
            )}
            {ledger.map(l => (
              <tr key={l.type + l.id}>
                <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.base }}>{fmtDate(l.date)}</td>
                <td>
                  {l.type === 'Vente'
                    ? <span style={{ color: COLORS.green, display: 'flex', alignItems: 'center', gap: SPACE.xs, fontWeight: 600 }}><ArrowUpCircle size={13} /> {t('compta.vente')}</span>
                    : <span style={{ color: COLORS.red, display: 'flex', alignItems: 'center', gap: SPACE.xs, fontWeight: 600 }}><ArrowDownCircle size={13} /> {t('compta.achat')}</span>}
                </td>
                <td>{l.produit} — {l.partenaire} ({l.quantite})</td>
                <td style={{ textAlign: 'right', fontWeight: 600, color: l.montant >= 0 ? COLORS.green : COLORS.red }}>
                  {l.montant >= 0 ? '+' : ''}{fmtMoney(l.montant)}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>

      {/* Popup listant tout l'historique (modifications + suppressions) du module */}
      {historiqueOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setHistoriqueOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: RADIUS.card, padding: SPACE.xl, maxWidth: 800, width: '90%', maxHeight: '75vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: TEXT.md, marginBottom: SPACE.md }}>{t('compta.historiqueBtn')}</div>
            {historiqueLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.base, color: COLORS.inkSoft }}>
                <Loader2 size={15} className="spin" /> {t('common.loading')}
              </div>
            ) : historiqueData.length === 0 ? (
              <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('compta.historiqueEmpty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                {historiqueData.map(h => {
                  const values = h.action === 'suppression' ? h.anciennesValeurs : h.nouvellesValeurs;
                  return (
                    <div key={h.id} style={{ borderBottom: `1px solid ${COLORS.border}`, paddingBottom: SPACE.sm }}>
                      <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>
                        <Badge tone={h.action === 'suppression' ? 'red' : 'blue'}>{h.action === 'suppression' ? t('compta.supprime') : t('compta.modifie')}</Badge>
                        {' '}{t('compta.parUtilisateur', { email: h.utilisateurEmail || t('compta.utilisateurInconnu') })}
                      </div>
                      {values && (
                        <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, marginTop: 3 }}>
                          {values.produit} — {values.partenaire} ({values.quantite} × {fmtMoney(values.prixUnitaire)})
                        </div>
                      )}
                      <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{fmtDate(h.date, { dateStyle: 'short', timeStyle: 'short' })}</div>
                      <div style={{ fontSize: TEXT.base, marginTop: SPACE.xs }}>{t('compta.raison', { raison: h.raison })}</div>
                    </div>
                  );
                })}
              </div>
            )}
            <Button variant="ghost" onClick={() => setHistoriqueOpen(false)} style={{ marginTop: SPACE.md }}>{t('common.close')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}


function PoultryMonitoringTab({ farmId }) {
  const { t } = useTranslation();
  const todayValue = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ date: todayValue(), type: 'mortalite', quantity: '', detail: '' });

  useEffect(() => {
    (async () => {
      try {
        const { suivi } = await getPoulaillerSuivi();
        setRecords(suivi.map(r => ({ id: r.id, date: r.date, type: r.type, quantity: r.quantite, detail: r.detail })));
      } catch (err) {
        console.error('[PoultryMonitoringTab load]', err);
      } finally {
        setLoaded(true);
      }
    })();
  }, [farmId]);

  const addRecord = async (e) => {
    e.preventDefault();
    if (!form.date || form.quantity === '') return;
    try {
      const { entry } = await createPoulaillerSuivi({ date: form.date, type: form.type, quantite: Number(form.quantity), detail: form.detail });
      if (entry) {
        setRecords(prev => [{ id: entry.id, date: entry.date, type: entry.type, quantity: entry.quantite, detail: entry.detail }, ...prev]);
        notifySuccess(t('poulailler.entrySaved'));
      }
    } catch (err) {
      console.error('[PoultryMonitoringTab addRecord]', err);
      notifyError(err, t('poulailler.entrySaveError'));
    }
    setForm({ date: todayValue(), type: form.type, quantity: '', detail: '' });
  };

  // tone + clé d'unité ; libellé et unité affichés via t('poulailler.type.*'/'poulailler.unit.*')
  const typeMeta = {
    mortalite: { tone: 'red', unit: 'tetes' },
    naissance: { tone: 'green', unit: 'poussins' },
    vaccination: { tone: 'blue', unit: 'tetes' },
    alimentation: { tone: 'ochre', unit: 'kg' },
    oeufs: { tone: 'green', unit: 'oeufs' },
  };
  const typeLabel = (type) => t(`poulailler.type.${type}`, { defaultValue: type });
  const unitLabel = (type, fallback = 'unite') => t(`poulailler.unit.${typeMeta[type]?.unit || fallback}`);

  const summary = records.reduce((acc, item) => {
    if (item.type === 'mortalite') acc.mortalite += item.quantity;
    if (item.type === 'naissance') acc.naissance += item.quantity;
    if (item.type === 'vaccination') acc.vaccination += item.quantity;
    if (item.type === 'alimentation') acc.alimentation += item.quantity;
    if (item.type === 'oeufs') acc.oeufs += item.quantity;
    return acc;
  }, { mortalite: 0, naissance: 0, vaccination: 0, alimentation: 0, oeufs: 0 });

  const quantityLabel = unitLabel(form.type);

  if (!loaded) {
    return <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}>{t('poulailler.suiviLoading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('poulailler.suiviTitle')}</div>
        <form onSubmit={addRecord} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Field label={t('common.date')} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Select label={t('compta.type')} value={form.type} onChange={e => setForm({ ...form, type: e.target.value, quantity: '' })}>
            <option value="mortalite">{typeLabel('mortalite')}</option>
            <option value="naissance">{typeLabel('naissance')}</option>
            <option value="vaccination">{typeLabel('vaccination')}</option>
            <option value="alimentation">{typeLabel('alimentation')}</option>
            <option value="oeufs">{typeLabel('oeufs')}</option>
          </Select>
          <Field label={t('poulailler.quantiteAvecUnite', { unit: quantityLabel })} type="number" placeholder="0" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
          <Field label={t('poulailler.detail')} placeholder={t('poulailler.detailPlaceholder')} value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} />
          <Button variant="ochre" type="submit"><Plus size={15} /> {t('common.add')}</Button>
        </form>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: SPACE.md }}>
        <Card style={{ background: COLORS.redSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.red, fontWeight: 600, marginBottom: SPACE.xs }}>{t('poulailler.summaryMortalite')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.red }}>{summary.mortalite}</div>
        </Card>
        <Card style={{ background: COLORS.greenSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600, marginBottom: SPACE.xs }}>{t('poulailler.summaryNaissances')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.green }}>{summary.naissance}</div>
        </Card>
        <Card style={{ background: COLORS.blueSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.blue, fontWeight: 600, marginBottom: SPACE.xs }}>{t('poulailler.summaryVaccinations')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.blue }}>{summary.vaccination}</div>
        </Card>
        <Card style={{ background: COLORS.ochreSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.ochre, fontWeight: 600, marginBottom: SPACE.xs }}>{t('poulailler.summaryAliments')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.ochre }}>{summary.alimentation} {t('poulailler.unit.kg')}</div>
        </Card>
        <Card style={{ background: COLORS.greenSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600, marginBottom: SPACE.xs }}>{t('poulailler.summaryOeufs')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.green }}>{summary.oeufs}</div>
        </Card>
      </div>

      <Card style={{ padding: 0 }}>
        <DataTable>
          <thead>
            <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
              <th>{t('common.date')}</th>
              <th>{t('compta.type')}</th>
              <th>{t('poulailler.quantite')}</th>
              <th>{t('poulailler.detail')}</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan="4" style={{ color: COLORS.inkSoft }}>{t('poulailler.suiviEmpty')}</td></tr>
            ) : records.map(item => (
              <tr key={item.id}>
                <td>{formatDateFr(item.date)}</td>
                <td><Badge tone={typeMeta[item.type]?.tone || 'green'}>{typeLabel(item.type)}</Badge></td>
                <td>{item.quantity} {unitLabel(item.type, 'u')}</td>
                <td>{item.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </div>
  );
}

// Mirroir de PoultryMonitoringTab — types mortalite/croissance/alimentation/traitement au
// lieu de mortalite/naissance/vaccination/alimentation/oeufs, câblé sur
// /api/pisciculture/suivi.
function PiscicultureMonitoringTab({ farmId }) {
  const { t } = useTranslation();
  const todayValue = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const [records, setRecords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ date: todayValue(), type: 'mortalite', quantity: '', detail: '' });

  useEffect(() => {
    (async () => {
      try {
        const { suivi } = await getPiscicultureSuivi();
        setRecords(suivi.map(r => ({ id: r.id, date: r.date, type: r.type, quantity: r.quantite, detail: r.detail })));
      } catch (err) {
        console.error('[PiscicultureMonitoringTab load]', err);
      } finally {
        setLoaded(true);
      }
    })();
  }, [farmId]);

  const addRecord = async (e) => {
    e.preventDefault();
    if (!form.date || form.quantity === '') return;
    try {
      const { entry } = await createPiscicultureSuivi({ date: form.date, type: form.type, quantite: Number(form.quantity), detail: form.detail });
      if (entry) {
        setRecords(prev => [{ id: entry.id, date: entry.date, type: entry.type, quantity: entry.quantite, detail: entry.detail }, ...prev]);
        notifySuccess(t('pisciculture.entrySaved'));
      }
    } catch (err) {
      console.error('[PiscicultureMonitoringTab addRecord]', err);
      notifyError(err, t('pisciculture.entrySaveError'));
    }
    setForm({ date: todayValue(), type: form.type, quantity: '', detail: '' });
  };

  const typeMeta = {
    mortalite: { tone: 'red', unit: 'poissons' },
    croissance: { tone: 'blue', unit: 'kg' },
    alimentation: { tone: 'ochre', unit: 'kg' },
    traitement: { tone: 'green', unit: 'dose' },
  };
  const typeLabel = (type) => t(`pisciculture.type.${type}`, { defaultValue: type });
  const unitLabel = (type, fallback = 'unite') => t(`pisciculture.unit.${typeMeta[type]?.unit || fallback}`);

  const summary = records.reduce((acc, item) => {
    if (item.type === 'mortalite') acc.mortalite += item.quantity;
    if (item.type === 'croissance') acc.croissance += item.quantity;
    if (item.type === 'alimentation') acc.alimentation += item.quantity;
    if (item.type === 'traitement') acc.traitement += item.quantity;
    return acc;
  }, { mortalite: 0, croissance: 0, alimentation: 0, traitement: 0 });

  const quantityLabel = unitLabel(form.type);

  if (!loaded) {
    return <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}>{t('pisciculture.suiviLoading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('pisciculture.suiviTitle')}</div>
        <form onSubmit={addRecord} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Field label={t('common.date')} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Select label={t('compta.type')} value={form.type} onChange={e => setForm({ ...form, type: e.target.value, quantity: '' })}>
            <option value="mortalite">{typeLabel('mortalite')}</option>
            <option value="croissance">{typeLabel('croissance')}</option>
            <option value="alimentation">{typeLabel('alimentation')}</option>
            <option value="traitement">{typeLabel('traitement')}</option>
          </Select>
          <Field label={t('pisciculture.quantiteAvecUnite', { unit: quantityLabel })} type="number" placeholder="0" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} />
          <Field label={t('pisciculture.detail')} placeholder={t('pisciculture.detailPlaceholder')} value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })} />
          <Button variant="ochre" type="submit"><Plus size={15} /> {t('common.add')}</Button>
        </form>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: SPACE.md }}>
        <Card style={{ background: COLORS.redSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.red, fontWeight: 600, marginBottom: SPACE.xs }}>{t('pisciculture.summaryMortalite')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.red }}>{summary.mortalite}</div>
        </Card>
        <Card style={{ background: COLORS.blueSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.blue, fontWeight: 600, marginBottom: SPACE.xs }}>{t('pisciculture.summaryCroissance')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.blue }}>{summary.croissance} {t('pisciculture.unit.kg')}</div>
        </Card>
        <Card style={{ background: COLORS.ochreSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.ochre, fontWeight: 600, marginBottom: SPACE.xs }}>{t('pisciculture.summaryAliments')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.ochre }}>{summary.alimentation} {t('pisciculture.unit.kg')}</div>
        </Card>
        <Card style={{ background: COLORS.greenSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600, marginBottom: SPACE.xs }}>{t('pisciculture.summaryTraitements')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.green }}>{summary.traitement}</div>
        </Card>
      </div>

      <Card style={{ padding: 0 }}>
        <DataTable>
          <thead>
            <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
              <th>{t('common.date')}</th>
              <th>{t('compta.type')}</th>
              <th>{t('pisciculture.quantite')}</th>
              <th>{t('pisciculture.detail')}</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan="4" style={{ color: COLORS.inkSoft }}>{t('pisciculture.suiviEmpty')}</td></tr>
            ) : records.map(item => (
              <tr key={item.id}>
                <td>{formatDateFr(item.date)}</td>
                <td><Badge tone={typeMeta[item.type]?.tone || 'green'}>{typeLabel(item.type)}</Badge></td>
                <td>{item.quantity} {unitLabel(item.type, 'u')}</td>
                <td>{item.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </div>
  );
}

// Bouton d'un onglet de ModuleTabBar — extrait pour être rendu deux fois
// (couche de mesure invisible + rendu visible réel) sans dupliquer le JSX.
function ModuleTabButton({ tab, active, onClick }) {
  const Icon = tab.icon;
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.base, fontWeight: 600, whiteSpace: 'nowrap',
      padding: '8px 13px', borderRadius: RADIUS.pill, border: 'none', cursor: 'pointer',
      background: active ? COLORS.green : 'transparent', color: active ? '#fff' : COLORS.inkSoft,
    }}>
      <Icon size={14} /> {tab.label}
    </button>
  );
}

// Barre d'onglets horizontale adaptative — remplace le simple flexWrap qui
// existait avant (fonctionnel mais provoque un retour à la ligne peu soigné
// sur petit écran) par un repli des onglets en trop dans un menu "Plus",
// inspiré de une barre de navigation de client web de référence (adapt(), voir
// project_erp_ux_alignment.md). Mesure la largeur réelle des onglets via une
// couche invisible avant de décider combien en afficher — même principe que
// l'implémentation de référence plutôt qu'un seuil de largeur codé en dur.
//
// Un onglet peut porter `ressources` / `uneParmi` (voir src/lib/restrictions.jsx) : il est alors
// masqué si le rôle de l'utilisateur n'a pas le droit de consulter ces ressources, et l'onglet
// actif bascule sur le premier onglet visible s'il vient d'être masqué.
function ModuleTabBar({ tabs: tousOnglets, activeTab, onSelect }) {
  const restrictions = useRestrictions();
  const tabs = tousOnglets.filter(onglet => exigencesSatisfaites(onglet, restrictions));
  const containerRef = useRef(null);
  const measureRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [moreOpen, setMoreOpen] = useState(false);

  const premierVisible = tabs[0]?.id;
  const actifVisible = tabs.some(t => t.id === activeTab);
  useEffect(() => {
    if (!actifVisible && premierVisible) onSelect(premierVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actifVisible, premierVisible]);

  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure || typeof ResizeObserver === 'undefined') return;

    const MORE_BUTTON_WIDTH = 90;
    const GAP = 6;

    const recompute = () => {
      const available = container.clientWidth;
      const itemEls = Array.from(measure.children);
      let used = 0;
      let count = 0;
      for (let i = 0; i < itemEls.length; i++) {
        const width = itemEls[i].getBoundingClientRect().width + (i > 0 ? GAP : 0);
        const isLast = i === itemEls.length - 1;
        const reserve = isLast ? 0 : MORE_BUTTON_WIDTH;
        if (count > 0 && used + width + reserve > available) break;
        used += width;
        count++;
      }
      setVisibleCount(Math.max(count, 1));
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [tabs]);

  const visibleTabs = tabs.slice(0, visibleCount);
  const overflowTabs = tabs.slice(visibleCount);
  const activeHiddenInOverflow = overflowTabs.some(t => t.id === activeTab);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'flex', gap: SPACE.sm, borderBottom: `1px solid ${COLORS.border}`, paddingBottom: SPACE.sm }}>
      <div ref={measureRef} style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', display: 'flex', gap: SPACE.sm, top: -9999, left: -9999 }}>
        {tabs.map(t => <ModuleTabButton key={t.id} tab={t} active={false} onClick={() => {}} />)}
      </div>
      {visibleTabs.map(t => (
        <ModuleTabButton key={t.id} tab={t} active={activeTab === t.id} onClick={() => onSelect(t.id)} />
      ))}
      {overflowTabs.length > 0 && (
        <div style={{ position: 'relative' }}>
          <button onClick={() => setMoreOpen(o => !o)} style={{
            display: 'flex', alignItems: 'center', gap: SPACE.xs, fontSize: TEXT.base, fontWeight: 600, whiteSpace: 'nowrap',
            padding: '8px 13px', borderRadius: RADIUS.pill, border: 'none', cursor: 'pointer',
            background: activeHiddenInOverflow ? COLORS.green : 'transparent',
            color: activeHiddenInOverflow ? '#fff' : COLORS.inkSoft,
          }}>
            Plus <ChevronRight size={14} style={{ transform: moreOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }} />
          </button>
          {moreOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: SPACE.xs, background: '#fff', borderRadius: RADIUS.card,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: `1px solid ${COLORS.border}`, zIndex: 30,
              display: 'flex', flexDirection: 'column', minWidth: 160, overflow: 'hidden',
            }}>
              {overflowTabs.map(t => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button key={t.id} onClick={() => { onSelect(t.id); setMoreOpen(false); }} style={{
                    display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.base, fontWeight: 600, textAlign: 'left',
                    padding: '10px 14px', border: 'none', cursor: 'pointer',
                    background: active ? COLORS.surfaceAlt : 'transparent', color: COLORS.ink,
                  }}>
                    <Icon size={14} /> {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const VANNE_ACTION_CODES = ['vanne_auto_open', 'vanne_auto_close', 'vanne_manual_open', 'vanne_manual_close'];

// Section pliable « Météo de cette parcelle » (voir routes/meteo.js) — recherche de ville
// optionnelle propre à la parcelle (même patron « au fil de la frappe » que ProfilModule/
// GlobalSearch) ; si non renseignée, la météo affichée retombe sur la localisation de
// l'entreprise (source indiquée par le backend).
function ParcelleMeteoSection({ parcelle }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [villeQuery, setVilleQuery] = useState('');
  const [villeResultats, setVilleResultats] = useState([]);
  const [villeBusy, setVilleBusy] = useState(false);
  const timerRef = useRef(null);
  const reqIdRef = useRef(0);

  const charger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getMeteo(parcelle.id));
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [parcelle.id]);

  useEffect(() => { charger(); }, [charger]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (villeQuery.trim().length < 2) { setVilleResultats([]); return undefined; }
    timerRef.current = setTimeout(async () => {
      const myId = ++reqIdRef.current;
      try {
        const { villes } = await rechercherVilleMeteo(villeQuery.trim());
        if (reqIdRef.current === myId) setVilleResultats(villes || []);
      } catch (err) {
        console.error('[ParcelleMeteoSection]', err);
      }
    }, 250);
    return () => clearTimeout(timerRef.current);
  }, [villeQuery]);

  const choisirVille = async (v) => {
    setVilleBusy(true);
    try {
      await updateParcelle(parcelle.id, { ville: v.nom, latitude: v.latitude, longitude: v.longitude });
      setVilleQuery('');
      setVilleResultats([]);
      await charger();
    } catch (err) {
      notifyError(err);
    } finally {
      setVilleBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      <div style={{ position: 'relative' }}>
        <Field
          label={t('cultures.meteoParcelleRecherche')}
          placeholder={t('profil.locationSearchPlaceholder')}
          value={villeQuery}
          onChange={(e) => setVilleQuery(e.target.value)}
        />
        {villeResultats.length > 0 && (
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, marginTop: SPACE.xs, overflow: 'hidden' }}>
            {villeResultats.map((v, i) => (
              <button
                key={`${v.nom}-${i}`}
                type="button"
                disabled={villeBusy}
                onClick={() => choisirVille(v)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: TEXT.base, color: COLORS.ink, borderBottom: i < villeResultats.length - 1 ? `1px solid ${COLORS.border}` : 'none' }}
              >
                {v.nom}{v.region ? `, ${v.region}` : ''}{v.pays ? ` — ${v.pays}` : ''}
              </button>
            ))}
          </div>
        )}
      </div>
      {loading ? (
        <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{t('common.loading')}</div>
      ) : error ? (
        <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{error}</div>
      ) : data ? (
        <div style={{ fontSize: TEXT.sm, color: COLORS.ink, display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
          <div>
            <b>{data.ville}</b> ({data.source === 'parcelle' ? t('cultures.meteoParcelleSourcePropre') : t('cultures.meteoParcelleSourceEntreprise')})
          </div>
          <div>{t('meteo.temperature')} : {data.actuel.temperature}° · {t('meteo.humidite')} : {data.actuel.humidite}%</div>
          {data.alertes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {data.alertes.map((a) => (
                <Badge key={a.type} tone={a.gravite === 'haute' ? 'red' : a.gravite === 'moyenne' ? 'ochre' : 'blue'}>{a.message}</Badge>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

const BANDE_NDVI_TONE = { sol_nu: 'red', clairsemee: 'ochre', moderee: 'blue', dense: 'green' };

function ParcellePrecisionSection({ parcelle }) {
  const { t } = useTranslation();
  const [sol, setSol] = useState(null);
  const [solError, setSolError] = useState(null);
  const [solLoading, setSolLoading] = useState(true);
  const [ndvi, setNdvi] = useState(null);
  const [ndviError, setNdviError] = useState(null);
  const [ndviLoading, setNdviLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setSolLoading(true);
      try { setSol(await getAnalyseSol(parcelle.id)); }
      catch (err) { setSolError(err.message); }
      finally { setSolLoading(false); }
    })();
    (async () => {
      setNdviLoading(true);
      try { setNdvi(await getNdvi(parcelle.id)); }
      catch (err) { setNdviError(err.message); }
      finally { setNdviLoading(false); }
    })();
  }, [parcelle.id]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
      <div>
        <div style={{ fontSize: TEXT.sm, fontWeight: 700, color: COLORS.inkSoft, marginBottom: SPACE.sm, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {t('precisionAgricole.solTitle')}
        </div>
        {solLoading ? (
          <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{t('common.loading')}</div>
        ) : solError ? (
          <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{solError}</div>
        ) : sol ? (
          <div style={{ fontSize: TEXT.sm, color: COLORS.ink, display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
            <div>
              {t('precisionAgricole.texture')} : <b>{sol.texture.classe ? t(`precisionAgricole.textureClasse.${sol.texture.classe}`) : '—'}</b>
              {' '}({t('precisionAgricole.argile')} {sol.texture.argile}% · {t('precisionAgricole.sable')} {sol.texture.sable}% · {t('precisionAgricole.limon')} {sol.texture.limon}%)
            </div>
            <div>pH : <b>{sol.ph ?? '—'}</b> · {t('precisionAgricole.carboneOrganique')} : {sol.carboneOrganique ?? '—'} g/kg · {t('precisionAgricole.azote')} : {sol.azote ?? '—'} g/kg</div>
            {sol.culturesSuggerees.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs, marginTop: 2 }}>
                <span style={{ color: COLORS.inkSoft }}>{t('precisionAgricole.culturesSuggerees')} :</span>
                {sol.culturesSuggerees.map((c) => <Badge key={c} tone="green">{c}</Badge>)}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div>
        <div style={{ fontSize: TEXT.sm, fontWeight: 700, color: COLORS.inkSoft, marginBottom: SPACE.sm, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {t('precisionAgricole.ndviTitle')}
        </div>
        {ndviLoading ? (
          <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{t('common.loading')}</div>
        ) : ndviError ? (
          <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{ndviError}</div>
        ) : ndvi && ndvi.configured === false ? (
          <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{t('precisionAgricole.ndviNonConfigure')}</div>
        ) : ndvi && ndvi.historique.length === 0 ? (
          <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{t('precisionAgricole.ndviAucuneImage')}</div>
        ) : ndvi ? (
          <div style={{ fontSize: TEXT.sm, color: COLORS.ink, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            <div>
              NDVI : <b>{ndvi.ndviActuel}</b> ({ndvi.dateActuelle}) —{' '}
              <Badge tone={BANDE_NDVI_TONE[ndvi.bande] || 'blue'}>{t(`precisionAgricole.bande.${ndvi.bande}`)}</Badge>
            </div>
            <MiniChart data={ndvi.historique.map((h) => ({ label: h.label.slice(5), value: h.value }))} color={COLORS.green} height={70} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CulturesModule({ farmId, highlightProduitId }) {
  const { t } = useTranslation();
  const peutLireParcelles = useRestrictions().peutLire('parcelles');
  // Onglet interne repris de l'URL (?onglet=), pour qu'un lien vers un document ouvre le
  // bon onglet et qu'un rechargement y revienne. Même principe que l'onglet de premier
  // niveau dans le shell, une strate plus bas.
  const [ongletUrl, setOngletUrl] = useParametreUrl('onglet');
  const tab = ongletUrl || 'parcelles';
  const setTab = setOngletUrl;
  const renderAction = (action) => (VANNE_ACTION_CODES.includes(action) ? t(`cultures.vanneAction.${action}`) : action);

  // Atterrissage depuis la recherche globale (Ctrl+K) sur un produit Cultures :
  // bascule sur l'onglet Stocks dès qu'un id à surligner est fourni, que le
  // module vienne d'être monté ou qu'il soit déjà affiché.
  useEffect(() => {
    if (highlightProduitId) setTab('stocks');
  }, [highlightProduitId]);
  // Démarre vide, et rien n'est créé automatiquement. Jusqu'au 2026-09-10, l'état initial
  // portait trois parcelles fictives d'identifiants 1, 2 et 3 : jamais affichées (le rendu
  // attend `loaded`), mais la simulation d'irrigation plus bas tournait dessus et écrivait au
  // serveur sur ces identifiants — or `parcelles.id` est une séquence globale, donc le 3
  // désigne une vraie parcelle d'une vraie entreprise.
  const [parcelles, setParcelles] = useState([]);
  const [historique, setHistorique] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Garde de concurrence sur l'effet de chargement. Elle protégeait l'amorçage des parcelles
  // par défaut (deux exécutions rapprochées trouvaient chacune une liste vide et créaient
  // chacune trois parcelles) ; l'amorçage a disparu, mais la garde reste utile — elle évite un
  // double aller-retour réseau au montage, que React double en mode strict.
  const chargementRef = useRef(false);

  const normalizeParcelle = useCallback((p) => ({
    ...p,
    humidite: Number(p.humidite),
    temperature: Number(p.temperature),
    seuil: Number(p.seuil),
    x: Number(p.x),
    y: Number(p.y),
  }), []);

  // Fusion plutôt que remplacement : hors-ligne on ne reçoit que { id, contour }, et écraser
  // la parcelle entière ferait disparaître humidité, température et le reste de l'écran.
  const majParcelleLocale = useCallback((maj) => {
    setParcelles(prev => prev.map(p => (p.id === maj.id ? normalizeParcelle({ ...p, ...maj }) : p)));
  }, [normalizeParcelle]);

  useEffect(() => {
    // Rôle privé de la lecture des parcelles : le module reste accessible pour ses autres
    // onglets (stocks, registre…), sans interroger une ressource qui serait refusée.
    if (!peutLireParcelles) { setLoaded(true); return; }
    if (chargementRef.current) return;
    chargementRef.current = true;
    (async () => {
      try {
        // Aucune parcelle de démonstration n'est créée : une exploitation qui s'inscrit part
        // d'une base vide et saisit ses vraies parcelles. C'était d'ailleurs déjà l'intention
        // affichée ailleurs dans ce fichier (« Cultures démarre volontairement vide plutôt que
        // d'inventer des données agricoles », au-dessus de DEFAULT_STOCKS), que l'amorçage
        // contredisait.
        const { parcelles: fetched } = await getParcelles();
        setParcelles(fetched.map(normalizeParcelle));
        const { historique: fetchedHistorique } = await getParcellesHistorique();
        setHistorique(fetchedHistorique);
      } catch (err) {
        console.error('[CulturesModule load]', err);
      } finally {
        setLoaded(true);
        chargementRef.current = false;
      }
    })();
  }, [farmId, normalizeParcelle, peutLireParcelles]);

  const pushHistorique = useCallback(async (entry) => {
    setHistorique(h => [{ id: `local-${Date.now()}`, date: new Date().toISOString(), parcelle: entry.parcelle, action: entry.action }, ...h].slice(0, 40));
    try {
      const { entry: saved } = await createParcelleHistorique({ parcelleId: entry.parcelleId, action: entry.action });
      if (saved) setHistorique(h => [saved, ...h.filter(x => !String(x.id).startsWith('local-'))].slice(0, 40));
    } catch (err) {
      console.error('[pushHistorique]', err);
      notifyError(err, t('cultures.historiqueSaveError'));
    }
  }, [t]);

  // La simulation écrit au serveur (vanne, journal) : elle ne doit pas démarrer avant que les
  // vraies parcelles soient là, sans quoi elle écrit sur ce qu'elle trouve dans l'état.
  useEffect(() => {
    if (!loaded) return undefined;
    const t = setInterval(() => {
      setParcelles(prev => prev.map(p => {
        const humidite = Math.max(10, Math.min(85, p.humidite + (Math.random() - 0.5) * 6));
        const temperature = Math.max(15, Math.min(40, p.temperature + (Math.random() - 0.5) * 1.5));
        let vanneOuverte = p.vanneOuverte;
        if (p.mode === 'auto') {
          const shouldOpen = humidite < p.seuil;
          if (shouldOpen !== vanneOuverte) {
            vanneOuverte = shouldOpen;
            pushHistorique({ parcelleId: p.id, parcelle: p.nom, action: shouldOpen ? 'vanne_auto_open' : 'vanne_auto_close' });
            updateParcelle(p.id, { vanneOuverte }).catch(err => { console.error('[auto vanne update]', err); notifyError(err); });
          }
        }
        return { ...p, humidite, temperature, vanneOuverte };
      }));
    }, 6000);
    return () => clearInterval(t);
  }, [pushHistorique, loaded]);

  const toggleMode = (id) => {
    setParcelles(prev => prev.map(p => {
      if (p.id !== id) return p;
      const mode = p.mode === 'auto' ? 'manuel' : 'auto';
      updateParcelle(id, { mode }).catch(err => { console.error('[toggleMode]', err); notifyError(err); });
      return { ...p, mode };
    }));
  };

  const toggleVanne = (id) => {
    setParcelles(prev => prev.map(p => {
      if (p.id !== id) return p;
      const vanneOuverte = !p.vanneOuverte;
      pushHistorique({ parcelleId: p.id, parcelle: p.nom, action: vanneOuverte ? 'vanne_manual_open' : 'vanne_manual_close' });
      updateParcelle(id, { vanneOuverte }).catch(err => { console.error('[toggleVanne]', err); notifyError(err); });
      return { ...p, vanneOuverte };
    }));
  };

  const [newParcelleForm, setNewParcelleForm] = useState({ nom: '', culture: '', seuil: 35, superficie: '', localisation: '' });
  const [addingParcelle, setAddingParcelle] = useState(false);

  const addParcelle = async (e) => {
    e.preventDefault();
    if (!newParcelleForm.nom) return;
    setAddingParcelle(true);
    try {
      const { parcelle } = await createParcelle({
        nom: newParcelleForm.nom,
        culture: newParcelleForm.culture || null,
        humidite: 50,
        temperature: 25,
        mode: 'auto',
        vanneOuverte: false,
        seuil: Number(newParcelleForm.seuil) || 35,
        x: Math.round(10 + Math.random() * 80),
        y: Math.round(10 + Math.random() * 80),
        superficie: newParcelleForm.superficie ? Number(newParcelleForm.superficie) : null,
        localisation: newParcelleForm.localisation || null,
      });
      if (parcelle) {
        setParcelles(prev => [...prev, normalizeParcelle(parcelle)]);
        setNewParcelleForm({ nom: '', culture: '', seuil: 35, superficie: '', localisation: '' });
        notifySuccess(t('cultures.parcelleAdded'));
      }
    } catch (err) {
      console.error('[addParcelle]', err);
      notifyError(err, t('cultures.parcelleAddError'));
    } finally {
      setAddingParcelle(false);
    }
  };

  const removeParcelle = async (id, nom) => {
    if (!window.confirm(t('cultures.confirmDeleteParcelle', { nom }))) return;
    try {
      await deleteParcelle(id);
      setParcelles(prev => prev.filter(p => p.id !== id));
      notifySuccess(t('cultures.parcelleDeleted'));
    } catch (err) {
      console.error('[removeParcelle]', err);
      notifyError(err, t('cultures.parcelleDeleteError'));
    }
  };

  const saveDateSemis = async (id, dateSemis) => {
    try {
      const { parcelle } = await updateParcelle(id, { dateSemis });
      setParcelles(prev => prev.map(p => (p.id === id ? { ...p, dateSemis: parcelle.dateSemis } : p)));
    } catch (err) {
      console.error('[saveDateSemis]', err);
      notifyError(err, t('cultures.dateSemisError'));
    }
  };

  const [generatingPlanId, setGeneratingPlanId] = useState(null);
  const [planningOpenId, setPlanningOpenId] = useState(null);
  const [meteoOpenId, setMeteoOpenId] = useState(null);
  const [precisionOpenId, setPrecisionOpenId] = useState(null);

  const handleGenererPlan = async (id, nom) => {
    if (!window.confirm(t('cultures.confirmGenererPlan', { nom }))) return;
    setGeneratingPlanId(id);
    try {
      const res = await generatePlanning(id);
      notifySuccess(t('cultures.planGenere', { count: res.activitesCreees?.length || 0 }));
      setPlanningOpenId(id);
    } catch (err) {
      console.error('[handleGenererPlan]', err);
      notifyError(err, t('cultures.planGenereError'));
    } finally {
      setGeneratingPlanId(null);
    }
  };

  if (!loaded) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, color: COLORS.inkSoft, padding: SPACE.huge }}>
      <Loader2 size={18} className="spin" /> {t('cultures.loadingParcelles')}
    </div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <ModuleTabBar
        tabs={[
          // `ressources` : lecture exigée pour afficher l'onglet (voir ModuleTabBar).
          { id: 'parcelles', label: t('cultures.tabParcelles'), icon: Sprout, ressources: ['parcelles'] },
          { id: 'carte', label: t('cultures.tabCarte'), icon: Home, ressources: ['parcelles'] },
          { id: 'stocks', label: t('cultures.tabStocks'), icon: Package, ressources: ['produits'] },
          { id: 'ventes', label: t('cultures.tabVentes'), icon: TrendingUp, ressources: ['devis'] },
          { id: 'achats', label: t('cultures.tabAchats'), icon: ShoppingCart, ressources: ['achats'] },
          { id: 'registre', label: t('cultures.tabRegistre'), icon: ClipboardList, ressources: ['applications_intrants'] },
          { id: 'comptabilite', label: t('cultures.tabComptabilite'), icon: Wallet, ressources: ['devis', 'achats'] },
        ]}
        activeTab={tab}
        onSelect={setTab}
      />

      {tab === 'parcelles' && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('cultures.addParcelleTitle')}</div>
        <form onSubmit={addParcelle} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Field label={t('cultures.fieldNom')} placeholder={t('cultures.fieldNomPlaceholder')} value={newParcelleForm.nom} onChange={e => setNewParcelleForm({ ...newParcelleForm, nom: e.target.value })} />
          <Field label={t('cultures.fieldCulture')} placeholder={t('cultures.fieldCulturePlaceholder')} value={newParcelleForm.culture} onChange={e => setNewParcelleForm({ ...newParcelleForm, culture: e.target.value })} />
          <Field label={t('cultures.fieldSeuil')} type="number" value={newParcelleForm.seuil} onChange={e => setNewParcelleForm({ ...newParcelleForm, seuil: e.target.value })} />
          <Field label={t('cultures.fieldSuperficie')} type="number" placeholder={t('cultures.optionalPlaceholder')} value={newParcelleForm.superficie} onChange={e => setNewParcelleForm({ ...newParcelleForm, superficie: e.target.value })} />
          <Field label={t('cultures.fieldLocalisation')} placeholder={t('cultures.optionalPlaceholder')} value={newParcelleForm.localisation} onChange={e => setNewParcelleForm({ ...newParcelleForm, localisation: e.target.value })} />
          <Button variant="green" type="submit" disabled={addingParcelle}><Plus size={15} /> {addingParcelle ? t('cultures.adding') : t('common.add')}</Button>
        </form>
      </Card>
      {/* Une exploitation neuve n'a plus de parcelles de démonstration : sans message, elle
          verrait un écran vide sous le formulaire sans savoir que c'est normal. */}
      {parcelles.length === 0 && (
        <Card>
          <div style={{ textAlign: 'center', padding: `${SPACE.xl}px 0`, color: COLORS.inkSoft }}>
            <Sprout size={28} color={COLORS.inkFaint} />
            <div style={{ fontWeight: 600, color: COLORS.ink, marginTop: SPACE.sm }}>{t('cultures.aucuneParcelle')}</div>
            <div style={{ fontSize: TEXT.base, marginTop: SPACE.xs }}>{t('cultures.aucuneParcelleAide')}</div>
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: SPACE.lg }}>
        {parcelles.map(p => {
          const needsWater = p.humidite < p.seuil;
          return (
            <Card key={p.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACE.md }}>
                <div>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, color: COLORS.ink }}>{p.nom}</div>
                  <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{p.culture}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                  <Badge tone={needsWater ? 'blue' : 'green'}>{needsWater ? t('cultures.wateringRecommended') : t('cultures.soilMoistEnough')}</Badge>
                  <button onClick={() => removeParcelle(p.id, p.nom)} title={t('cultures.deleteParcelleTitle')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: SPACE.xl, justifyContent: 'center', padding: '6px 0 14px' }}>
                <GaugeDial
                  value={p.humidite} label={t('cultures.soilHumidity')} unit="%"
                  colorMain={COLORS.blue} colorTrack={COLORS.blueSoft}
                  icon={<Droplet size={15} color={COLORS.blue} />}
                />
                <GaugeDial
                  value={p.temperature} max={45} label={t('cultures.temperature')} unit="°"
                  colorMain={COLORS.ochre} colorTrack={COLORS.ochreSoft}
                  icon={<Thermometer size={15} color={COLORS.ochre} />}
                />
              </div>
              <div style={{ marginBottom: SPACE.md }}>
                <MentionSimulation texte={t('simulation.capteursIrrigation')} />
              </div>
              <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: SPACE.md, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  onClick={() => toggleMode(p.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, background: 'none', border: 'none', cursor: 'pointer', fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 500 }}
                >
                  {p.mode === 'auto' ? <ToggleRight size={22} color={COLORS.green} /> : <ToggleLeft size={22} color={COLORS.inkSoft} />}
                  {p.mode === 'auto' ? t('cultures.modeAuto') : t('cultures.modeManuel')}
                </button>
                <Button
                  small
                  variant={p.vanneOuverte ? 'green' : 'outline'}
                  disabled={p.mode === 'auto'}
                  onClick={() => toggleVanne(p.id)}
                >
                  {p.vanneOuverte ? t('cultures.valveOpen') : t('cultures.valveClosed')}
                </Button>
              </div>
              <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: SPACE.md, paddingTop: SPACE.md }}>
                <button
                  onClick={() => setPlanningOpenId(id => (id === p.id ? null : p.id))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 600, padding: 0 }}
                >
                  <ChevronRight size={14} style={{ transform: planningOpenId === p.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }} />
                  {t('cultures.planningTitle')}
                </button>
                {planningOpenId === p.id && (
                  <div style={{ marginTop: SPACE.sm, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                    <Field
                      label={t('cultures.dateSemis')}
                      type="date"
                      defaultValue={p.dateSemis || ''}
                      onBlur={e => { if (e.target.value !== (p.dateSemis || '')) saveDateSemis(p.id, e.target.value || null); }}
                    />
                    <Button
                      small
                      variant="outline"
                      disabled={generatingPlanId === p.id}
                      onClick={() => handleGenererPlan(p.id, p.nom)}
                    >
                      {generatingPlanId === p.id ? <Loader2 size={13} className="spin" /> : <ClipboardList size={13} />}
                      {t('cultures.genererPlan')}
                    </Button>
                    <ActivitesSection ressourceType="parcelle" ressourceId={p.id} />
                  </div>
                )}
              </div>
              <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: SPACE.md, paddingTop: SPACE.md }}>
                <button
                  onClick={() => setMeteoOpenId(id => (id === p.id ? null : p.id))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 600, padding: 0 }}
                >
                  <ChevronRight size={14} style={{ transform: meteoOpenId === p.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }} />
                  {t('cultures.meteoParcelleTitle')}
                </button>
                {meteoOpenId === p.id && (
                  <div style={{ marginTop: SPACE.sm }}>
                    <ParcelleMeteoSection parcelle={p} />
                  </div>
                )}
              </div>
              <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: SPACE.md, paddingTop: SPACE.md }}>
                <button
                  onClick={() => setPrecisionOpenId(id => (id === p.id ? null : p.id))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 600, padding: 0 }}
                >
                  <ChevronRight size={14} style={{ transform: precisionOpenId === p.id ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }} />
                  {t('cultures.precisionTitle')}
                </button>
                {precisionOpenId === p.id && (
                  <div style={{ marginTop: SPACE.sm }}>
                    <ParcellePrecisionSection parcelle={p} />
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <ClipboardList size={16} color={COLORS.green} /> {t('cultures.valveHistory')}
        </div>
        {historique.length === 0 ? (
          <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('cultures.noEvent')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, maxHeight: 220, overflowY: 'auto' }}>
            {historique.map(h => (
              <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: TEXT.base, borderBottom: `1px solid ${COLORS.border}`, paddingBottom: SPACE.sm }}>
                <span><strong style={{ fontWeight: 600 }}>{h.parcelle}</strong> — {renderAction(h.action)}</span>
                <span style={{ color: COLORS.inkSoft, fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xs }}>{formatDateTimeFr(h.date)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      </div>
      )}

      {tab === 'carte' && <ParcelMapTab parcelles={parcelles} onParcelleMaj={majParcelleLocale} />}
      {tab === 'stocks' && <StocksTab farmId={farmId} moduleType="Cultures" highlightId={highlightProduitId} />}
      {tab === 'ventes' && <VentesWithDevis farmId={farmId} moduleType="Cultures" />}
      {tab === 'achats' && <AchatsAvecSousNav farmId={farmId} storageKey="achats-cultures" moduleType="Cultures" />}
      {tab === 'registre' && <RegistreIntrantsView farmId={farmId} />}
      {tab === 'comptabilite' && <ComptabiliteTab farmId={farmId}
        remoteVentes={async () => (await getVentesLedger()).mouvements}
        remoteAchats={async () => (await getAchatsLedger('Cultures')).mouvements}
        remoteHistorique={getCulturesHistorique}
      />}
    </div>
  );
}

function PoulaillerModule({ farmId, highlightProduitId }) {
  const { t } = useTranslation();
  const [ongletUrl, setOngletUrl] = useParametreUrl('onglet');
  const tab = ongletUrl || 'environnement';
  const setTab = setOngletUrl;

  // Voir le commentaire équivalent dans CulturesModule.
  useEffect(() => {
    if (highlightProduitId) setTab('stocks');
  }, [highlightProduitId]);
  const tabs = [
    // `ressources` : lecture exigée pour afficher l'onglet (voir ModuleTabBar).
    { id: 'environnement', label: t('poulailler.tabAmbiance'), icon: Thermometer, ressources: ['poulailler'] },
    { id: 'suivi', label: t('poulailler.tabSuivi'), icon: ClipboardList, ressources: ['poulailler'] },
    { id: 'stocks', label: t('poulailler.tabStocks'), icon: Package, ressources: ['produits'] },
    { id: 'ventes', label: t('poulailler.tabVentes'), icon: TrendingUp, ressources: ['devis'] },
    { id: 'achats', label: t('poulailler.tabAchats'), icon: ShoppingCart, ressources: ['achats'] },
    { id: 'livraisons', label: t('poulailler.tabLivraisons'), icon: Truck, ressources: ['poulailler'] },
    { id: 'comptabilite', label: t('poulailler.tabComptabilite'), icon: Wallet, ressources: ['devis', 'achats'] },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <ModuleTabBar tabs={tabs} activeTab={tab} onSelect={setTab} />
      {tab === 'environnement' && <EnvironnementTab farmId={farmId} />}
      {tab === 'suivi' && <PoultryMonitoringTab farmId={farmId} />}
      {tab === 'stocks' && <StocksTab farmId={farmId} moduleType="Poulailler" highlightId={highlightProduitId} />}
      {tab === 'ventes' && <VentesWithDevis farmId={farmId} moduleType="Poulailler" />}
      {tab === 'achats' && <AchatsAvecSousNav farmId={farmId} storageKey="achats" moduleType="Poulailler" />}
      {tab === 'livraisons' && <LivraisonsTab farmId={farmId} />}
      {tab === 'comptabilite' && <ComptabiliteTab farmId={farmId}
        remoteVentes={async () => (await getVentesLedger()).mouvements}
        remoteAchats={async () => (await getAchatsLedger('Poulailler')).mouvements}
        remoteHistorique={getPoulaillerHistorique}
      />}
    </div>
  );
}

// Mirroir de PoulaillerModule — voir CLAUDE.md/docs/journal.md pour le contexte : le stock
// (produits) et les vraies ventes/achats réutilisent les composants génériques ci-dessus tels
// quels (moduleType="Pisciculture"), seuls Bassins/Suivi/Livraisons sont dédiés (comme côté
// Poulailler). Pas de remoteHistorique : Pisciculture n'a pas de "mouvements" texte-libre à
// auditer (ce ledger, côté Poulailler, est un vestige de l'ancien système).
function PiscicultureModule({ farmId, highlightProduitId }) {
  const { t } = useTranslation();
  const [ongletUrl, setOngletUrl] = useParametreUrl('onglet');
  const tab = ongletUrl || 'environnement';
  const setTab = setOngletUrl;

  useEffect(() => {
    if (highlightProduitId) setTab('stocks');
  }, [highlightProduitId]);
  const tabs = [
    { id: 'environnement', label: t('pisciculture.tabBassins'), icon: Droplet, ressources: ['pisciculture'] },
    { id: 'suivi', label: t('pisciculture.tabSuivi'), icon: ClipboardList, ressources: ['pisciculture'] },
    { id: 'stocks', label: t('pisciculture.tabStocks'), icon: Package, ressources: ['produits'] },
    { id: 'ventes', label: t('pisciculture.tabVentes'), icon: TrendingUp, ressources: ['devis'] },
    { id: 'achats', label: t('pisciculture.tabAchats'), icon: ShoppingCart, ressources: ['achats'] },
    { id: 'livraisons', label: t('pisciculture.tabLivraisons'), icon: Truck, ressources: ['pisciculture'] },
    { id: 'comptabilite', label: t('pisciculture.tabComptabilite'), icon: Wallet, ressources: ['devis', 'achats'] },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <ModuleTabBar tabs={tabs} activeTab={tab} onSelect={setTab} />
      {tab === 'environnement' && <BassinsEnvironnementTab farmId={farmId} />}
      {tab === 'suivi' && <PiscicultureMonitoringTab farmId={farmId} />}
      {tab === 'stocks' && <StocksTab farmId={farmId} moduleType="Pisciculture" highlightId={highlightProduitId} />}
      {tab === 'ventes' && <VentesWithDevis farmId={farmId} moduleType="Pisciculture" />}
      {tab === 'achats' && <AchatsAvecSousNav farmId={farmId} storageKey="achats-pisciculture" moduleType="Pisciculture" />}
      {tab === 'livraisons' && <PiscicultureLivraisonsTab farmId={farmId} />}
      {tab === 'comptabilite' && <ComptabiliteTab farmId={farmId}
        remoteVentes={async () => (await getVentesLedger()).mouvements}
        remoteAchats={async () => (await getAchatsLedger('Pisciculture')).mouvements}
      />}
    </div>
  );
}

function LoginScreen({ onAuth, onConfirmerInscription, onRenvoyerCodeInscription }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [nomEntreprise, setNomEntreprise] = useState('');
  const [typeCompte, setTypeCompte] = useState('entreprise'); // 'entreprise' | 'particulier'
  const [siret, setSiret] = useState('');
  const [telephone, setTelephone] = useState('');
  const [pays, setPays] = useState('');
  const [numeroTva, setNumeroTva] = useState('');
  const [adresse, setAdresse] = useState('');
  const [devise, setDevise] = useState('XOF');
  const [locale, setLocale] = useState('fr-FR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaMethod, setMfaMethod] = useState('totp');
  // Étape de confirmation d'inscription (code par email, voir routes/auth.js) — distincte
  // du MFA ci-dessus : un compte tout juste créé, pas une connexion à un compte existant.
  const [confirmationStep, setConfirmationStep] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [resendMsg, setResendMsg] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (mode === 'register' && password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    // Même règle que le serveur (server/src/utils/motDePasse.js) : retour immédiat plutôt
    // qu'un aller-retour réseau pour une erreur connue d'avance.
    if (mode === 'register' && (password.length < 8 || !/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password))) {
      setError(t('auth.passwordRule'));
      return;
    }
    setBusy(true);
    try {
      const extra = mode === 'register'
        ? {
            nomEntreprise, typeCompte, siret: typeCompte === 'entreprise' ? siret : undefined, devise, locale,
            telephone: typeCompte === 'entreprise' ? telephone : undefined,
            pays: typeCompte === 'entreprise' ? pays : undefined,
            numeroTva: typeCompte === 'entreprise' ? numeroTva : undefined,
            adresse: typeCompte === 'entreprise' ? adresse : undefined,
            // reCAPTCHA v3 : undefined si VITE_RECAPTCHA_SITE_KEY n'est pas configuré (repli
            // gracieux côté serveur aussi, voir lib/recaptcha.js) — n'empêche jamais l'inscription.
            recaptchaToken: await getRecaptchaToken('register'),
          }
        : null;
      const result = await onAuth(mode, email, password, extra);
      if (result?.mfaRequired) {
        setMfaStep(true);
        if (result.mfaMethod) setMfaMethod(result.mfaMethod);
      } else if (result?.confirmationRequired) {
        setConfirmationEmail(result.email || email);
        setConfirmationStep(true);
      }
    } catch (err) {
      setError(err.message || (mode === 'login' ? t('auth.loginFailed') : t('auth.registerFailed')));
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await onAuth('login', email, password, null, mfaCode);
    } catch (err) {
      setError(err.message || t('auth.mfaInvalid'));
    } finally {
      setBusy(false);
    }
  };

  const submitConfirmation = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await onConfirmerInscription(confirmationEmail, confirmationCode);
    } catch (err) {
      setError(err.message || t('auth.confirmationInvalid'));
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmationCode = async () => {
    if (busy) return;
    setResendMsg('');
    setBusy(true);
    try {
      await onRenvoyerCodeInscription(confirmationEmail);
      setResendMsg(t('auth.resendSent'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (confirmationStep) {
    return (
      <div style={{ minHeight: 520, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <Card>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: 3 }}>
              {t('auth.confirmationTitle')}
            </div>
            <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.lg }}>
              {t('auth.confirmationHint', { email: confirmationEmail })}
            </div>
            <form onSubmit={submitConfirmation} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
              <Field label={t('auth.confirmationCode')} placeholder="123456" value={confirmationCode} onChange={e => setConfirmationCode(e.target.value)} required maxLength={6} />
              {error && (
                <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                  <AlertTriangle size={14} /> {error}
                </div>
              )}
              {resendMsg && (
                <div style={{ background: COLORS.greenSoft, color: COLORS.green, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base }}>
                  {resendMsg}
                </div>
              )}
              <Button type="submit" variant="green" style={{ justifyContent: 'center', marginTop: SPACE.sm }} disabled={busy}>
                {busy ? <Loader2 size={15} className="spin" /> : <Lock size={14} />} {t('auth.confirmationSubmit')}
              </Button>
            </form>
            <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginTop: SPACE.lg, textAlign: 'center' }}>
              <button type="button" onClick={resendConfirmationCode} disabled={busy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.green, fontWeight: 600, fontSize: TEXT.base }}>
                {t('auth.resendCode')}
              </button>
            </div>
            <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginTop: SPACE.sm, textAlign: 'center' }}>
              <button type="button" onClick={() => { setConfirmationStep(false); setConfirmationCode(''); setError(''); setResendMsg(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.green, fontWeight: 600, fontSize: TEXT.base }}>
                {t('common.back')}
              </button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (mfaStep) {
    return (
      <div style={{ minHeight: 520, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <Card>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: 3 }}>
              {t('auth.mfaTitle')}
            </div>
            <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.lg }}>
              {mfaMethod === 'email' ? t('auth.mfaHintEmail') : t('auth.mfaHint')}
            </div>
            <form onSubmit={submitMfa} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
              <Field label={t('auth.mfaCode')} placeholder="123456" value={mfaCode} onChange={e => setMfaCode(e.target.value)} required maxLength={6} />
              {error && (
                <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                  <AlertTriangle size={14} /> {error}
                </div>
              )}
              <Button type="submit" variant="green" style={{ justifyContent: 'center', marginTop: SPACE.sm }} disabled={busy}>
                {busy ? <Loader2 size={15} className="spin" /> : <Lock size={14} />} {t('auth.mfaSubmit')}
              </Button>
            </form>
            <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginTop: SPACE.lg, textAlign: 'center' }}>
              <button type="button" onClick={() => { setMfaStep(false); setMfaCode(''); setError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.green, fontWeight: 600, fontSize: TEXT.base }}>
                {t('common.back')}
              </button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: 520, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, justifyContent: 'center', marginBottom: SPACE.xxl }}>
          <div style={{ width: 40, height: 40, borderRadius: RADIUS.card, background: COLORS.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sprout size={21} color="#fff" />
          </div>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: TEXT.xl, color: COLORS.ink }}>{t('auth.brand')}</span>
        </div>
        <Card>
          <div style={{ display: 'flex', gap: SPACE.sm, marginBottom: SPACE.lg, background: COLORS.surfaceAlt, borderRadius: RADIUS.control, padding: SPACE.xs }}>
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: RADIUS.control, border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: TEXT.base,
                background: mode === 'login' ? COLORS.surface : 'transparent',
                color: mode === 'login' ? COLORS.ink : COLORS.inkSoft,
                boxShadow: mode === 'login' ? `0 1px 2px rgba(0,0,0,0.06)` : 'none',
              }}
            >
              {t('auth.tabLogin')}
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: RADIUS.control, border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: TEXT.base,
                background: mode === 'register' ? COLORS.surface : 'transparent',
                color: mode === 'register' ? COLORS.ink : COLORS.inkSoft,
                boxShadow: mode === 'register' ? `0 1px 2px rgba(0,0,0,0.06)` : 'none',
              }}
            >
              {t('auth.tabRegister')}
            </button>
          </div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: 3 }}>
            {mode === 'login' ? t('auth.titleLogin') : t('auth.titleRegister')}
          </div>
          <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.lg }}>
            {mode === 'login' ? t('auth.subtitleLogin') : t('auth.subtitleRegister')}
          </div>

          {mode === 'register' && (
            <div style={{ display: 'flex', gap: SPACE.sm, marginBottom: SPACE.md }}>
              <button
                type="button"
                onClick={() => setTypeCompte('entreprise')}
                style={{
                  flex: 1, padding: '10px 8px', borderRadius: RADIUS.control, cursor: 'pointer',
                  border: `1.5px solid ${typeCompte === 'entreprise' ? COLORS.green : COLORS.border}`,
                  background: typeCompte === 'entreprise' ? COLORS.greenSoft || COLORS.greenSoft : '#fff',
                  color: typeCompte === 'entreprise' ? COLORS.green : COLORS.inkSoft,
                  fontWeight: 600, fontSize: TEXT.base,
                }}
              >
                {t('auth.accountTypeCompany')}
              </button>
              <button
                type="button"
                onClick={() => setTypeCompte('particulier')}
                style={{
                  flex: 1, padding: '10px 8px', borderRadius: RADIUS.control, cursor: 'pointer',
                  border: `1.5px solid ${typeCompte === 'particulier' ? COLORS.green : COLORS.border}`,
                  background: typeCompte === 'particulier' ? COLORS.greenSoft || COLORS.greenSoft : '#fff',
                  color: typeCompte === 'particulier' ? COLORS.green : COLORS.inkSoft,
                  fontWeight: 600, fontSize: TEXT.base,
                }}
              >
                {t('auth.accountTypeIndividual')}
              </button>
            </div>
          )}

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
            <Field label={t('auth.email')} type="email" placeholder={t('auth.emailPlaceholder')} value={email} onChange={e => setEmail(e.target.value)} required />
            <Field label={t('auth.password')} type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : undefined} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} title={mode === 'register' ? t('auth.passwordRule') : undefined} />
            {mode === 'register' && (
              <Field label={t('auth.confirmPassword')} type="password" placeholder="••••••••" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            )}
            {mode === 'register' && (
              <Field
                label={typeCompte === 'entreprise' ? t('auth.companyName') : t('auth.activityName')}
                placeholder={typeCompte === 'entreprise' ? t('auth.companyNamePlaceholder') : t('auth.activityNamePlaceholder')}
                value={nomEntreprise}
                onChange={e => setNomEntreprise(e.target.value)}
              />
            )}
            {mode === 'register' && typeCompte === 'entreprise' && (
              <Field label={t('auth.siret')} placeholder={t('auth.siretPlaceholder')} value={siret} onChange={e => setSiret(e.target.value)} />
            )}
            {mode === 'register' && typeCompte === 'entreprise' && (
              <>
                <Field label={t('auth.address')} placeholder={t('auth.addressPlaceholder')} value={adresse} onChange={e => setAdresse(e.target.value)} required />
                <div style={{ display: 'flex', gap: SPACE.sm }}>
                  <Field label={t('auth.phone')} placeholder={t('auth.phonePlaceholder')} value={telephone} onChange={e => setTelephone(e.target.value)} required style={{ flex: 1 }} />
                  <Field label={t('auth.vatNumber')} placeholder={t('auth.vatNumberPlaceholder')} value={numeroTva} onChange={e => setNumeroTva(e.target.value)} required style={{ flex: 1 }} />
                </div>
                <Select label={t('auth.country')} value={pays} onChange={e => setPays(e.target.value)} required>
                  <option value="" disabled>{t('auth.countryPlaceholder')}</option>
                  {PAYS.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                </Select>
              </>
            )}
            {mode === 'register' && (
              <div style={{ display: 'flex', gap: SPACE.sm }}>
                <Select label={t('auth.currency')} value={devise} onChange={e => setDevise(e.target.value)} style={{ flex: 1 }}>
                  {DEVISES.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
                </Select>
                <Select label={t('auth.locale')} value={locale} onChange={e => setLocale(e.target.value)} style={{ flex: 1 }}>
                  {LOCALES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </Select>
              </div>
            )}
            {error && (
              <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                <AlertTriangle size={14} /> {error}
              </div>
            )}
            <Button type="submit" variant="green" style={{ justifyContent: 'center', marginTop: SPACE.sm }} disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : <Lock size={14} />} {mode === 'login' ? t('auth.submitLogin') : t('auth.submitRegister')}
            </Button>
          </form>
          <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginTop: SPACE.lg, textAlign: 'center' }}>
            {mode === 'login' ? (
              <>{t('auth.noAccount')} <button type="button" onClick={() => { setMode('register'); setError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.green, fontWeight: 600, fontSize: TEXT.base }}>{t('auth.submitRegister')}</button></>
            ) : (
              <>{t('auth.hasAccount')} <button type="button" onClick={() => { setMode('login'); setError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.green, fontWeight: 600, fontSize: TEXT.base }}>{t('auth.submitLogin')}</button></>
            )}
          </div>
          <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft, marginTop: SPACE.sm, textAlign: 'center' }}>
            {t('auth.footer')}
          </div>
        </Card>
      </div>
    </div>
  );
}

function OptionCard({ icon: Icon, title, description, features, price, active, onToggle, accent }) {
  const { t } = useTranslation();
  const accentColor = accent === 'green' ? COLORS.green : COLORS.ochre;
  const accentSoft = accent === 'green' ? COLORS.greenSoft : COLORS.ochreSoft;
  return (
    <Card style={{
      border: active ? `2px solid ${accentColor}` : `1px solid ${COLORS.border}`,
      display: 'flex', flexDirection: 'column', gap: SPACE.md
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ width: 42, height: 42, borderRadius: RADIUS.card, background: accentSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={21} color={accentColor} />
        </div>
        {active && <Badge tone={accent}>{t('optionCard.active')}</Badge>}
      </div>
      <div>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, lineHeight: 1.5 }}>{description}</div>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
        {features.map((f, i) => (
          <li key={i} style={{ display: 'flex', gap: SPACE.sm, fontSize: TEXT.base, color: COLORS.ink }}>
            <Check size={15} color={accentColor} style={{ flexShrink: 0, marginTop: 1 }} /> {f}
          </li>
        ))}
      </ul>
      <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: SPACE.md, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{price}</span>
        <Button variant={active ? 'outline' : accent} onClick={onToggle}>
          {active ? t('optionCard.deactivate') : t('optionCard.activate')}
        </Button>
      </div>
    </Card>
  );
}

function AgriculturalCalendarModule({ farmId }) {
  const { t } = useTranslation();
  const { fmtDate } = useLocale();
  const typeLabel = (ty) => t(`calendar.type.${ty}`, { defaultValue: ty });
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [useRemote, setUseRemote] = useState(true);
  const [error, setError] = useState('');
  const [viewMonth, setViewMonth] = useState(new Date());
  const [form, setForm] = useState({ date: '', type: 'irrigation', title: '', description: '' });
  const key = `agri-calendar-${farmId}`;

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ date: '', type: 'irrigation', title: '', description: '' });
  const [editSubmitting, setEditSubmitting] = useState(false);

  const buildIsoDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const defaultEvents = useMemo(() => {
    const today = new Date();
    return [
      { id: 1, date: buildIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)), type: 'irrigation', title: 'Irrigation parcelle A', description: 'Arrosage matin' },
      { id: 2, date: buildIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3)), type: 'traitement', title: 'Traitement phytosanitaire', description: 'Pulvérisation de prévention' },
      { id: 3, date: buildIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5)), type: 'recolte', title: 'Récolte maïs', description: 'Collecte du lot principal' },
    ];
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const data = await getCalendarEvents();
      if (!data || !Array.isArray(data.events)) {
        throw new Error('Aucune donnée reçue du serveur.');
      }
      setEvents(data.events.map(ev => ({ ...ev, date: String(ev.date).slice(0, 10) })));
      setUseRemote(true);
    } catch (err) {
      console.error('[AgriculturalCalendarModule remote load]', err);
      setUseRemote(false);
      const stored = await storageGet(key, defaultEvents);
      setEvents(stored);
    } finally {
      setForm(prev => ({ ...prev, date: prev.date || buildIsoDate(new Date()) }));
      setLoaded(true);
    }
  }, [key, defaultEvents]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    if (!loaded || useRemote) return;
    storageSet(key, events);
  }, [events, loaded, useRemote, key]);

  const addEvent = async (e) => {
    e.preventDefault();
    if (!form.date || !form.title) return;

    if (useRemote) {
      try {
        await createCalendarEvent(form);
        await loadEvents();
        setForm({ date: form.date, type: 'irrigation', title: '', description: '' });
      } catch (err) {
        setError(err.message || t('calendar.addError'));
      }
      return;
    }

    const entry = {
      id: Date.now(),
      date: form.date,
      type: form.type,
      title: form.title,
      description: form.description,
    };
    setEvents(prev => [...prev, entry].sort((a, b) => a.date.localeCompare(b.date)));
    setForm({ date: form.date, type: 'irrigation', title: '', description: '' });
  };

  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const monthEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
  const firstDayOffset = (monthStart.getDay() + 6) % 7;
  const daysInMonth = monthEnd.getDate();
  const today = buildIsoDate(new Date());

  const eventsByDay = useMemo(() => events.reduce((acc, event) => {
    acc[event.date] = acc[event.date] || [];
    acc[event.date].push(event);
    return acc;
  }, {}), [events]);

  // Tous les événements (passés et à venir), pour pouvoir corriger une erreur de saisie
  // sur n'importe quel événement, pas seulement les prochains.
  const allEventsSorted = useMemo(() => [...events].sort((a, b) => a.date.localeCompare(b.date)), [events]);

  const startEditEvent = (event) => {
    setEditingId(event.id);
    setEditForm({ date: event.date, type: event.type, title: event.title, description: event.description || '' });
  };
  const cancelEditEvent = () => {
    setEditingId(null);
    setEditForm({ date: '', type: 'irrigation', title: '', description: '' });
  };
  const saveEditEvent = async (e) => {
    e.preventDefault();
    if (!editForm.date || !editForm.title) return;
    setEditSubmitting(true);
    try {
      if (useRemote) {
        await updateCalendarEvent(editingId, editForm);
        await loadEvents();
      } else {
        setEvents(prev => prev.map(ev => ev.id === editingId ? { ...ev, ...editForm } : ev).sort((a, b) => a.date.localeCompare(b.date)));
      }
      notifySuccess(t('calendar.updated'));
      cancelEditEvent();
    } catch (err) {
      console.error('[AgriculturalCalendarModule saveEditEvent]', err);
      notifyError(err, t('calendar.updateError'));
    } finally {
      setEditSubmitting(false);
    }
  };

  const activityMeta = {
    irrigation: { tone: 'blue' },
    traitement: { tone: 'green' },
    recolte: { tone: 'ochre' },
    vaccination: { tone: 'red' },
    livraison: { tone: 'blue' },
  };

  if (!loaded) {
    return <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}>{t('calendar.loading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('calendar.planTitle')}</div>
        {error && <div style={{ color: COLORS.red, marginBottom: SPACE.sm }}>{error}</div>}
        <form onSubmit={addEvent} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Field label={t("common.date")} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Select label={t("common.type")} value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="irrigation">{typeLabel("irrigation")}</option>
            <option value="traitement">{typeLabel("traitement")}</option>
            <option value="recolte">{typeLabel("recolte")}</option>
            <option value="vaccination">{typeLabel("vaccination")}</option>
            <option value="livraison">{typeLabel("livraison")}</option>
          </Select>
          <Field label={t("calendar.titre")} placeholder={t("calendar.titrePlaceholder")} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <Field label={t("calendar.description")} placeholder={t("calendar.descriptionPlaceholder")} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          <Button variant="green" type="submit"><Plus size={15} /> {t("common.add")}</Button>
        </form>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: SPACE.lg, alignItems: 'start' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.sm }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('calendar.calendarTitle')}</div>
            <div style={{ display: 'flex', gap: SPACE.sm }}>
              <Button small variant="outline" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>←</Button>
              <Button small variant="outline" onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>→</Button>
            </div>
          </div>
          <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.sm }}>
            {fmtDate(viewMonth, { month: 'long', year: 'numeric' })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: SPACE.sm }}>
            {t('common.daysShort', { returnObjects: true }).map((day, idx) => (
              <div key={`day-${idx}`} style={{ textAlign: 'center', fontSize: TEXT.xs, fontWeight: 700, color: COLORS.inkSoft, paddingBottom: SPACE.xs }}>{day}</div>
            ))}
            {Array.from({ length: firstDayOffset }).map((_, idx) => (
              <div key={`empty-${idx}`} style={{ minHeight: 78, borderRadius: RADIUS.card, border: `1px dashed ${COLORS.border}` }} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const dayNumber = idx + 1;
              const cellDate = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), dayNumber);
              const cellIso = buildIsoDate(cellDate);
              const dayEvents = eventsByDay[cellIso] || [];
              const isToday = cellIso === today;
              return (
                <div key={cellIso} style={{ minHeight: 78, borderRadius: RADIUS.card, border: `1px solid ${COLORS.border}`, padding: SPACE.sm, background: isToday ? COLORS.greenSoft : COLORS.surfaceAlt }}>
                  <div style={{ fontSize: TEXT.sm, fontWeight: 700, marginBottom: SPACE.xs, color: isToday ? COLORS.green : COLORS.ink }}>{dayNumber}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
                    {dayEvents.slice(0, 2).map(event => {
                      const meta = activityMeta[event.type] || { tone: 'green' };
                      return <div key={event.id} style={{ fontSize: TEXT.xs, padding: '3px 5px', borderRadius: RADIUS.control, background: meta.tone === 'blue' ? COLORS.blueSoft : meta.tone === 'green' ? COLORS.greenSoft : meta.tone === 'red' ? COLORS.redSoft : COLORS.ochreSoft, color: meta.tone === 'blue' ? COLORS.blue : meta.tone === 'green' ? COLORS.green : meta.tone === 'red' ? COLORS.red : COLORS.ochre }}>
                        {typeLabel(event.type)}
                      </div>;
                    })}
                    {dayEvents.length > 2 && <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft }}>+{dayEvents.length - 2}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <Card>
            <div style={{ fontWeight: 600, marginBottom: SPACE.sm }}>{t('calendar.typesTitle')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              {Object.entries(activityMeta).map(([key, meta]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: TEXT.base, color: COLORS.inkSoft }}>
                  <span>{typeLabel(key)}</span>
                  <Badge tone={meta.tone}>{typeLabel(key)}</Badge>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div style={{ fontWeight: 600, marginBottom: SPACE.sm }}>{t('calendar.allEvents')}</div>
            <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft, marginBottom: SPACE.sm }}>{t('calendar.allEventsHint')}</div>
            {allEventsSorted.length === 0 ? (
              <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('calendar.empty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, maxHeight: 320, overflowY: 'auto' }}>
                {allEventsSorted.map(event => (
                  <div key={event.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: SPACE.sm, borderBottom: `1px solid ${COLORS.border}`, paddingBottom: SPACE.sm }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: TEXT.base }}>{event.title}</div>
                      <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, marginTop: 3 }}>{fmtDate(event.date)} • {typeLabel(event.type)}</div>
                    </div>
                    <button onClick={() => startEditEvent(event)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue, display: 'flex', flexShrink: 0 }}>
                      <Settings2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
      {editingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={cancelEditEvent}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: RADIUS.card, width: '90%', maxWidth: 500, padding: SPACE.xl }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('calendar.editTitle')}</div>
              <button onClick={cancelEditEvent} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, fontSize: TEXT.lg }}>×</button>
            </div>
            <form onSubmit={saveEditEvent} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
              <Field label={t("common.date")} type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} required />
              <Select label={t("common.type")} value={editForm.type} onChange={e => setEditForm({ ...editForm, type: e.target.value })}>
                <option value="irrigation">{typeLabel("irrigation")}</option>
                <option value="traitement">{typeLabel("traitement")}</option>
                <option value="recolte">{typeLabel("recolte")}</option>
                <option value="vaccination">{typeLabel("vaccination")}</option>
                <option value="livraison">{typeLabel("livraison")}</option>
              </Select>
              <Field label={t("calendar.titre")} placeholder={t("calendar.titrePlaceholder")} value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} required />
              <Field label={t("calendar.description")} placeholder={t("calendar.descriptionPlaceholder")} value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
              <div style={{ display: 'flex', gap: SPACE.sm }}>
                <Button type="submit" variant="green" disabled={editSubmitting}>
                  {editSubmitting ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {t("common.save")}
                </Button>
                <Button type="button" onClick={cancelEditEvent}>{t("common.cancel")}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function HarvestsModule({ farmId }) {
  const { t } = useTranslation();
  const { fmtDate, fmtNumber } = useLocale();
  const qualiteLabel = (q) => t(`harvests.qualiteLabels.${q}`, { defaultValue: q });
  const todayValue = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const [harvests, setHarvests] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [useRemote, setUseRemote] = useState(true);
  const [error, setError] = useState('');
  const [parcelles, setParcelles] = useState([]);
  const [form, setForm] = useState({
    date: todayValue(),
    parcelleId: '',
    parcelleNom: '',
    culture: '',
    quantite: '',
    qualite: 'Bonne',
    destination: '',
  });
  const key = `agri-recoltes-${farmId}`;

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ date: '', parcelleId: '', parcelleNom: '', culture: '', quantite: '', qualite: 'Bonne', destination: '' });
  const [editSubmitting, setEditSubmitting] = useState(false);

  const nomFinalDe = (f) => f.parcelleId === '__autre__'
    ? f.parcelleNom
    : parcelles.find(p => String(p.id) === String(f.parcelleId))?.nom || '';

  const parcelleNomFinal = nomFinalDe(form);

  useEffect(() => {
    (async () => {
      try {
        const { parcelles } = await getParcelles();
        setParcelles(parcelles || []);
      } catch (err) {
        console.error('[HarvestsModule parcelles]', err);
      }
    })();
  }, []);

  const loadHarvests = useCallback(async () => {
    try {
      const data = await getRecoltes();
      if (!data || !Array.isArray(data.recoltes)) {
        throw new Error('Aucune donnée reçue du serveur.');
      }
      setHarvests(data.recoltes.map(r => ({ ...r, date: String(r.date).slice(0, 10) })));
      setUseRemote(true);
    } catch (err) {
      console.error('[HarvestsModule remote load]', err);
      setUseRemote(false);
      const stored = await storageGet(key, []);
      setHarvests(Array.isArray(stored) ? stored : []);
    } finally {
      setLoaded(true);
    }
  }, [key]);

  useEffect(() => {
    loadHarvests();
  }, [loadHarvests]);

  useEffect(() => {
    if (!loaded || useRemote) return;
    storageSet(key, harvests);
  }, [harvests, loaded, useRemote, key]);

  const addHarvest = async (e) => {
    e.preventDefault();
    if (!form.date || !parcelleNomFinal || !form.culture || form.quantite === '' || !form.destination) return;

    const resetForm = () => setForm({ date: todayValue(), parcelleId: '', parcelleNom: '', culture: '', quantite: '', qualite: 'Bonne', destination: '' });

    if (useRemote) {
      try {
        await createRecolte({
          date: form.date,
          parcelle: parcelleNomFinal,
          parcelleId: form.parcelleId === '__autre__' ? null : (Number(form.parcelleId) || null),
          culture: form.culture,
          quantite: form.quantite,
          qualite: form.qualite,
          destination: form.destination,
        });
        await loadHarvests();
        resetForm();
      } catch (err) {
        setError(err.message || t('harvests.addError'));
      }
      return;
    }

    const entry = {
      id: Date.now(),
      date: form.date,
      parcelle: parcelleNomFinal,
      culture: form.culture,
      quantite: Number(form.quantite),
      qualite: form.qualite,
      destination: form.destination,
    };
    setHarvests(prev => [entry, ...prev]);
    resetForm();
  };

  const startEdit = (item) => {
    // Reconstitue la valeur du <select> parcelle : l'id si la parcelle existe encore,
    // sinon "__autre__" avec le nom libre.
    const parcelleConnue = item.parcelleId && parcelles.some(p => String(p.id) === String(item.parcelleId));
    setEditingId(item.id);
    setEditForm({
      date: String(item.date).slice(0, 10),
      parcelleId: parcelleConnue ? String(item.parcelleId) : '__autre__',
      parcelleNom: parcelleConnue ? '' : (item.parcelle || ''),
      culture: item.culture || '',
      quantite: item.quantite ?? '',
      qualite: item.qualite || 'Bonne',
      destination: item.destination || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ date: '', parcelleId: '', parcelleNom: '', culture: '', quantite: '', qualite: 'Bonne', destination: '' });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    const nomFinal = nomFinalDe(editForm);
    if (!editForm.date || !nomFinal || !editForm.culture || editForm.quantite === '' || !editForm.destination) return;
    setEditSubmitting(true);
    try {
      if (useRemote) {
        await updateRecolte(editingId, {
          date: editForm.date,
          parcelle: nomFinal,
          parcelleId: editForm.parcelleId === '__autre__' ? null : (Number(editForm.parcelleId) || null),
          culture: editForm.culture,
          quantite: editForm.quantite,
          qualite: editForm.qualite,
          destination: editForm.destination,
        });
        await loadHarvests();
      } else {
        setHarvests(prev => prev.map(h => h.id === editingId
          ? { ...h, date: editForm.date, parcelle: nomFinal, culture: editForm.culture, quantite: Number(editForm.quantite), qualite: editForm.qualite, destination: editForm.destination }
          : h));
      }
      notifySuccess(t('harvests.updated'));
      cancelEdit();
    } catch (err) {
      notifyError(err, t('harvests.updateError'));
    } finally {
      setEditSubmitting(false);
    }
  };

  const removeHarvest = async (id) => {
    if (!window.confirm(t('harvests.deleteConfirm'))) return;
    try {
      if (useRemote) {
        await deleteRecolte(id);
        await loadHarvests();
      } else {
        setHarvests(prev => prev.filter(h => h.id !== id));
      }
      notifySuccess(t('harvests.deleted'));
    } catch (err) {
      notifyError(err, t('harvests.deleteError'));
    }
  };

  const totalQuantite = harvests.reduce((sum, item) => sum + (Number(item.quantite) || 0), 0);

  if (!loaded) {
    return <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}>{t('harvests.loading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('harvests.recordTitle')}</div>
        {error && <div style={{ color: COLORS.red, marginBottom: SPACE.sm }}>{error}</div>}
        <form onSubmit={addHarvest} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
          <Field label={t("common.date")} type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <Select label={t("harvests.parcelle")} value={form.parcelleId} onChange={e => setForm({ ...form, parcelleId: e.target.value, parcelleNom: '' })}>
            <option value="">{t("harvests.selectParcelle")}</option>
            {parcelles.map(p => (
              <option key={p.id} value={p.id}>{p.nom}</option>
            ))}
            <option value="__autre__">{t("harvests.autreParcelle")}</option>
          </Select>
          {form.parcelleId === '__autre__' && (
            <Field label={t("harvests.parcelleNom")} placeholder={t("harvests.parcelleNomPlaceholder")} value={form.parcelleNom} onChange={e => setForm({ ...form, parcelleNom: e.target.value })} />
          )}
          <Field label={t("harvests.culture")} placeholder={t("harvests.culturePlaceholder")} value={form.culture} onChange={e => setForm({ ...form, culture: e.target.value })} />
          <Field label={t("harvests.quantite")} type="number" placeholder="0" value={form.quantite} onChange={e => setForm({ ...form, quantite: e.target.value })} />
          <Select label={t("harvests.qualite")} value={form.qualite} onChange={e => setForm({ ...form, qualite: e.target.value })}>
            <option value="Bonne">{qualiteLabel("Bonne")}</option>
            <option value="Moyenne">{qualiteLabel("Moyenne")}</option>
            <option value="Faible">{qualiteLabel("Faible")}</option>
          </Select>
          <Field label={t("harvests.destination")} placeholder={t("harvests.destinationPlaceholder")} value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} />
          <Button variant="green" type="submit"><Plus size={15} /> {t("common.add")}</Button>
        </form>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.md }}>
        <Card style={{ background: COLORS.greenSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600, marginBottom: SPACE.xs }}>{t('harvests.totalQuantite')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.green }}>{fmtNumber(totalQuantite)} kg</div>
        </Card>
        <Card style={{ background: COLORS.blueSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.blue, fontWeight: 600, marginBottom: SPACE.xs }}>{t('harvests.nbEnregistrements')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.blue }}>{harvests.length}</div>
        </Card>
      </div>

      <Card style={{ padding: 0 }}>
        <DataTable>
          <thead>
            <tr style={{ textAlign: 'left', color: COLORS.inkSoft }}>
              <th>{t('common.date')}</th>
              <th>{t('harvests.colParcelle')}</th>
              <th>{t('harvests.colCulture')}</th>
              <th>{t('harvests.colQuantite')}</th>
              <th>{t('harvests.colQualite')}</th>
              <th>{t('harvests.colDestination')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {harvests.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ color: COLORS.inkSoft }}>{t("harvests.emptyTable")}</td>
              </tr>
            ) : harvests.map(item => (
              <tr key={item.id}>
                <td>{fmtDate(item.date)}</td>
                <td>{item.parcelle}</td>
                <td>{item.culture}</td>
                <td>{fmtNumber(item.quantite)} kg</td>
                <td><Badge tone={item.qualite === 'Bonne' ? 'green' : item.qualite === 'Moyenne' ? 'ochre' : 'red'}>{qualiteLabel(item.qualite)}</Badge></td>
                <td>{item.destination}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => startEdit(item)} title={t('common.edit')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue }}><Settings2 size={15} /></button>
                  <button onClick={() => removeHarvest(item.id)} title={t('common.delete')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, marginLeft: SPACE.sm }}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>

      {editingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: SPACE.lg }} onClick={cancelEdit}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: RADIUS.card, width: '100%', maxWidth: 560, padding: SPACE.xl }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('harvests.editTitle')}</div>
              <button onClick={cancelEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, fontSize: TEXT.lg }}>×</button>
            </div>
            <form onSubmit={saveEdit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
              <Field label={t("common.date")} type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} />
              <Select label={t("harvests.parcelle")} value={editForm.parcelleId} onChange={e => setEditForm({ ...editForm, parcelleId: e.target.value, parcelleNom: '' })}>
                <option value="">{t("harvests.selectParcelle")}</option>
                {parcelles.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
                <option value="__autre__">{t("harvests.autreParcelle")}</option>
              </Select>
              {editForm.parcelleId === '__autre__' && (
                <Field label={t("harvests.parcelleNom")} placeholder={t("harvests.parcelleNomPlaceholder")} value={editForm.parcelleNom} onChange={e => setEditForm({ ...editForm, parcelleNom: e.target.value })} />
              )}
              <Field label={t("harvests.culture")} placeholder={t("harvests.culturePlaceholder")} value={editForm.culture} onChange={e => setEditForm({ ...editForm, culture: e.target.value })} />
              <Field label={t("harvests.quantite")} type="number" placeholder="0" value={editForm.quantite} onChange={e => setEditForm({ ...editForm, quantite: e.target.value })} />
              <Select label={t("harvests.qualite")} value={editForm.qualite} onChange={e => setEditForm({ ...editForm, qualite: e.target.value })}>
                <option value="Bonne">{qualiteLabel("Bonne")}</option>
                <option value="Moyenne">{qualiteLabel("Moyenne")}</option>
                <option value="Faible">{qualiteLabel("Faible")}</option>
              </Select>
              <Field label={t("harvests.destination")} placeholder={t("harvests.destinationPlaceholder")} value={editForm.destination} onChange={e => setEditForm({ ...editForm, destination: e.target.value })} />
              <div style={{ display: 'flex', gap: SPACE.sm }}>
                <Button type="submit" variant="green" disabled={editSubmitting}>
                  {editSubmitting ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {t("common.save")}
                </Button>
                <Button type="button" onClick={cancelEdit}>{t("common.cancel")}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AIAssistantModule({ farmId, activated }) {
  const { t } = useTranslation();
  const { fmtMoney, fmtDate } = useLocale();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(() => t('assistant.initialAnswer'));
  const [facts, setFacts] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const monthLabel = fmtDate(new Date(), { month: 'long', year: 'numeric' });
      try {
        const [parcellesData, stocksData, ventesData, financesData] = await Promise.all([
          activated.cultures ? getParcelles() : Promise.resolve({ parcelles: [] }),
          activated.poulailler ? getProduits('Poulailler') : Promise.resolve({ stocks: [] }),
          getVentesLedger(),
          getFinances(),
        ]);

        const parcelles = parcellesData.parcelles || [];
        const stocks = stocksData.stocks || [];
        const ventes = ventesData.mouvements || [];
        const financeEntries = financesData.finances || [];

        // Même convention que finances.jsx : une entrée est une dépense si sa catégorie
        // l'indique explicitement (saisie manuelle) OU si son montant est négatif (achat auto-synchronisé).
        const CATEGORIES_DEPENSES = ['Depenses diverses', 'Carburant', 'Salaire', 'Entretien'];
        const isDepenseEntry = (e) => CATEGORIES_DEPENSES.includes(e.categorie) || Number(e.montant) < 0;

        const now = new Date();
        const currentMonthEntries = financeEntries.filter(entry => {
          const d = parseDate(entry.date);
          if (!d) return true;
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });

        const revenues = currentMonthEntries.filter(e => !isDepenseEntry(e)).reduce((sum, e) => sum + Math.abs(Number(e.montant) || 0), 0);
        const expenses = currentMonthEntries.filter(isDepenseEntry).reduce((sum, e) => sum + Math.abs(Number(e.montant) || 0), 0);
        const benefit = revenues - expenses;
        // Les catégories sont configurables par entreprise depuis la fusion du catalogue :
        // une égalité stricte sur « Aliment » (le libellé semé par défaut) renvoyait 0 dès
        // que la catégorie était renommée, sans que rien ne le signale. On reconnaît donc
        // toute catégorie dont le nom commence par « aliment », casse et espaces ignorés.
        const estAliment = (c) => String(c || "").trim().toLowerCase().startsWith("aliment");
        const foodStock = stocks.filter((item) => estAliment(item.categorie))
          .reduce((sum, item) => sum + (Number(item.quantite) || 0), 0);
        const parcelsToWater = parcelles.filter(p => Number(p.humidite) < Number(p.seuil || 0));

        const spendByClient = new Map();
        ventes.forEach(v => {
          const nom = v.partenaire || 'Client';
          const total = montantLigneEntreprise(v);
          spendByClient.set(nom, (spendByClient.get(nom) || 0) + total);
        });
        const bestClient = [...spendByClient.entries()]
          .map(([nom, total]) => ({ nom, total }))
          .sort((a, b) => b.total - a.total)[0] || null;

        setFacts({ benefit, revenues, expenses, foodStock, parcelsToWater, bestClient, monthLabel });
      } catch (err) {
        console.error('[AIAssistantModule]', err);
        setFacts({ benefit: 0, revenues: 0, expenses: 0, foodStock: 0, parcelsToWater: [], bestClient: null, monthLabel });
      }
      setLoaded(true);
    })();
  }, [farmId, activated]);

  const askAssistant = (e) => {
    e.preventDefault();
    const q = question.trim().toLowerCase();
    if (!facts) {
      setAnswer(t('assistant.loadingAnswer'));
      return;
    }

    // Ce test passe AVANT les mots-clés, et c'est tout son intérêt. « Pourquoi mon stock n'a pas
    // bougé ? » contient « stock » : sans ce garde-fou, la recherche par mots-clés répondait
    // « vous avez N sacs d'aliment » — une réponse fausse, donnée avec assurance, qui n'atteignait
    // jamais le repli prévu pour les questions inconnues.
    //
    // Cet assistant répond sur les DONNÉES de l'exploitation, pas sur le fonctionnement du
    // logiciel. Un mot interrogatif de ce type signale la seconde famille : on renvoie alors vers
    // l'Aide au lieu de deviner. « Combien » est délibérément absent — c'est une question de
    // données (« combien de sacs me reste-t-il ? »).
    if (/pourquoi|comment|à quoi sert|a quoi sert|c'est quoi|que veut dire|je n'arrive pas|je narrive pas|impossible de|\bwhy\b|\bhow do\b|\bwhat does\b/.test(q)) {
      setAnswer(t('assistant.answerFonctionnement'));
      return;
    }

    if (/b[ée]n[ée]fice|profit|gains?/.test(q)) {
      setAnswer(t('assistant.answerBenefice', { month: facts.monthLabel, benefit: fmtMoney(facts.benefit), revenues: fmtMoney(facts.revenues), expenses: fmtMoney(facts.expenses) }));
      return;
    }

    if (/sacs?|aliment|feed|bags?|stock/.test(q)) {
      setAnswer(t('assistant.answerStock', { count: facts.foodStock }));
      return;
    }

    if (/arros|parcelle|plot|eau|water/.test(q)) {
      if (facts.parcelsToWater.length === 0) {
        setAnswer(t('assistant.answerNoWater'));
      } else {
        setAnswer(t('assistant.answerWater', { names: facts.parcelsToWater.map(p => p.nom).join(', ') }));
      }
      return;
    }

    if (/client|customer|ach[eè]te|achats|buy|plus|most/.test(q)) {
      if (facts.bestClient) {
        setAnswer(t('assistant.answerBestClient', { name: facts.bestClient.nom, total: fmtMoney(facts.bestClient.total) }));
      } else {
        setAnswer(t('assistant.answerNoClient'));
      }
      return;
    }

    if (/pr[ée]vo|pr[ée]vision|forecast|d[ée]penses?|expense|mois prochain|next month|prochain/.test(q)) {
      setAnswer(t('assistant.answerForecast', { amount: fmtMoney(Math.max(0, facts.expenses * 1.08)) }));
      return;
    }

    setAnswer(t('assistant.answerFallback'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('assistant.title')}</div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.md }}>
          {t('assistant.hint')}
        </div>
        <form onSubmit={askAssistant} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
          <Field label={t("assistant.questionLabel")} placeholder={t("assistant.questionPlaceholder")} value={question} onChange={e => setQuestion(e.target.value)} />
          <Button variant="green" type="submit" disabled={!loaded}><Search size={15} /> {t('assistant.ask')}</Button>
        </form>
      </Card>
      <Card>
        <div style={{ fontWeight: 600, marginBottom: SPACE.sm }}>{t('assistant.answerTitle')}</div>
        <div style={{ fontSize: TEXT.base, color: COLORS.ink, lineHeight: 1.6 }}>{answer}</div>
      </Card>
      <Card>
        <div style={{ fontWeight: 600, marginBottom: SPACE.sm }}>{t('assistant.examplesTitle')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, fontSize: TEXT.base, color: COLORS.inkSoft }}>
          <div>• {t('assistant.example1')}</div>
          <div>• {t('assistant.example2')}</div>
          <div>• {t('assistant.example3')}</div>
          <div>• {t('assistant.example4')}</div>
          <div>• {t('assistant.example5')}</div>
        </div>
      </Card>
    </div>
  );
}

function ForecastingModule({ farmId, activated }) {
  const { t } = useTranslation();
  const { fmtMoney, fmtNumber } = useLocale();
  const [forecast, setForecast] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [parcellesData, harvestsData, stocksData, ventesData, financesData] = await Promise.all([
          activated.cultures ? getParcelles() : Promise.resolve({ parcelles: [] }),
          getRecoltes(),
          activated.poulailler ? getProduits('Poulailler') : Promise.resolve({ stocks: [] }),
          getVentesLedger(),
          getFinances(),
        ]);

        const parcelles = parcellesData.parcelles || [];
        const harvests = harvestsData.recoltes || [];
        const stocks = stocksData.stocks || [];
        const ventes = ventesData.mouvements || [];
        const financeEntries = financesData.finances || [];

        // Même convention que finances.jsx : une entrée est une dépense si sa catégorie
        // l'indique explicitement (saisie manuelle) OU si son montant est négatif (achat auto-synchronisé).
        const CATEGORIES_DEPENSES = ['Depenses diverses', 'Carburant', 'Salaire', 'Entretien'];
        const isDepenseEntry = (e) => CATEGORIES_DEPENSES.includes(e.categorie) || Number(e.montant) < 0;

        // Projection assise sur les mois RÉVOLUS réellement enregistrés, et non sur le mois
        // en cours multiplié par un coefficient figé (×1,08 / ×1,05 / ×1,1) comme avant : le
        // module annonçait « basées sur les tendances récentes » sans calculer la moindre
        // tendance. Le mois courant est exclu de la base parce qu il est incomplet — l inclure
        // tirerait mécaniquement la moyenne vers le bas selon le jour du mois.
        const MOIS_BASE = 3;
        const cleMois = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, 0)}`;
        const maintenant = new Date();
        const clesBase = [];
        for (let k = 1; k <= MOIS_BASE; k++) {
          clesBase.push(cleMois(new Date(maintenant.getFullYear(), maintenant.getMonth() - k, 1)));
        }

        const financeParMois = new Map();
        financeEntries.forEach((e) => {
          const d = parseDate(e.date);
          if (!d) return;
          const cle = cleMois(d);
          if (!financeParMois.has(cle)) financeParMois.set(cle, { revenus: 0, depenses: 0 });
          const seau = financeParMois.get(cle);
          const montant = Math.abs(Number(e.montant) || 0);
          if (isDepenseEntry(e)) seau.depenses += montant;
          else seau.revenus += montant;
        });

        const recoltesParMois = new Map();
        harvests.forEach((h) => {
          const d = parseDate(h.date);
          if (!d) return;
          const cle = cleMois(d);
          recoltesParMois.set(cle, (recoltesParMois.get(cle) || 0) + (Number(h.quantite) || 0));
        });

        // On ne moyenne que sur les mois qui portent effectivement des données : trois mois
        // dont deux vides donneraient une projection deux fois trop basse.
        const moisFinance = clesBase.filter((c) => financeParMois.has(c));
        const moisRecoltes = clesBase.filter((c) => recoltesParMois.has(c));
        const moyenneFinance = (champ) => (moisFinance.length
          ? moisFinance.reduce((s, c) => s + financeParMois.get(c)[champ], 0) / moisFinance.length
          : 0);
        const moyenneRecoltes = moisRecoltes.length
          ? moisRecoltes.reduce((s, c) => s + recoltesParMois.get(c), 0) / moisRecoltes.length
          : 0;

        const nextSales = moyenneFinance("revenus");
        const nextExpenses = moyenneFinance("depenses");
        const nextProfit = nextSales - nextExpenses;

        // Contexte affiché tel quel : ce sont des faits, pas des entrées du calcul. La note
        // précédente prétendait qu ils « servent à ajuster la projection », ce qui était faux.
        const clientSpend = ventes.reduce((sum, v) => sum + montantLigneEntreprise(v), 0);
        const avgParcelleHumidity = parcelles.length > 0
          ? parcelles.reduce((sum, p) => sum + (Number(p.humidite) || 0), 0) / parcelles.length
          : 0;

        setForecast({
          moisFinance: moisFinance.length,
          moisRecoltes: moisRecoltes.length,
          nextSales,
          nextExpenses,
          nextProfit,
          nextHarvests: moyenneRecoltes,
          avgParcelleHumidity,
          clientSpend,
          aDesParcelles: parcelles.length > 0,
        });
      } catch (err) {
        console.error('[ForecastingModule]', err);
        setForecast({ moisFinance: 0, moisRecoltes: 0, nextSales: 0, nextExpenses: 0, nextProfit: 0, nextHarvests: 0, avgParcelleHumidity: 0, clientSpend: 0, aDesParcelles: false });
      }
      setLoaded(true);
    })();
  }, [farmId, activated]);

  if (!loaded || !forecast) {
    return <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}>{t('forecast.loading')}</div>;
  }

  // Aucune projection tant qu aucun mois révolu ne porte de données : mieux vaut le dire
  // que d afficher des zéros qui passeraient pour une prévision.
  const assezDeDonnees = forecast.moisFinance > 0;
  const items = [
    { label: t('forecast.nextSales'), value: fmtMoney(forecast.nextSales), tone: 'green' },
    { label: t('forecast.nextExpenses'), value: fmtMoney(forecast.nextExpenses), tone: 'red' },
    { label: t('forecast.nextProfit'), value: fmtMoney(forecast.nextProfit), tone: forecast.nextProfit >= 0 ? 'green' : 'red' },
  ];
  if (forecast.moisRecoltes > 0) {
    items.push({ label: t('forecast.nextHarvests'), value: `${fmtNumber(forecast.nextHarvests)} kg`, tone: 'ochre' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('forecast.title')}</div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>
          {assezDeDonnees
            ? t('forecast.subtitle', { count: forecast.moisFinance })
            : t('forecast.pasAssezDeDonnees')}
        </div>
      </Card>
      {assezDeDonnees && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.md }}>
        {items.map(item => {
          const accent = item.tone === 'green' ? COLORS.green : item.tone === 'red' ? COLORS.red : item.tone === 'blue' ? COLORS.blue : COLORS.ochre;
          const soft = item.tone === 'green' ? COLORS.greenSoft : item.tone === 'red' ? COLORS.redSoft : item.tone === 'blue' ? COLORS.blueSoft : COLORS.ochreSoft;
          return (
            <Card key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 600 }}>{item.label}</span>
                <div style={{ width: 36, height: 36, borderRadius: RADIUS.card, background: soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <TrendingUp size={18} color={accent} />
                </div>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.lg, fontWeight: 700, color: COLORS.ink }}>{item.value}</div>
            </Card>
          );
        })}
      </div>
      )}
      <Card>
        <div style={{ fontWeight: 600, marginBottom: SPACE.sm }}>{t('forecast.noteTitle')}</div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, lineHeight: 1.6 }}>
          {forecast.aDesParcelles
            ? t('forecast.note', { humidity: forecast.avgParcelleHumidity.toFixed(0), clientSpend: fmtMoney(forecast.clientSpend) })
            : t('forecast.noteSansParcelle', { clientSpend: fmtMoney(forecast.clientSpend) })}
        </div>
      </Card>
    </div>
  );
}

const REPORT_PERIODS = ['jour', 'semaine', 'mois', 'annee'];

function ReportsModule({ farmId, activated }) {
  const { t } = useTranslation();
  const { fmtMoney, fmtNumber, fmtDate } = useLocale();
  const periodLabel = (p) => t(`reports.period.${p}`, { defaultValue: p });
  const [period, setPeriod] = useState('jour');
  const [raw, setRaw] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [culturesAchats, poulaillerAchats, ventes, recoltesData] = await Promise.all([
          activated.cultures ? getAchatsLedger('Cultures') : Promise.resolve({ mouvements: [] }),
          activated.poulailler ? getAchatsLedger('Poulailler') : Promise.resolve({ mouvements: [] }),
          getVentesLedger(),
          getRecoltes(),
        ]);
        setRaw({
          ventes: ventes.mouvements || [],
          achats: [...(culturesAchats.mouvements || []), ...(poulaillerAchats.mouvements || [])],
          harvests: recoltesData.recoltes || [],
        });
      } catch (err) {
        console.error('[ReportsModule]', err);
        setRaw({ ventes: [], achats: [], harvests: [] });
      }
      setLoaded(true);
    })();
  }, [farmId, activated]);

  const filtered = useMemo(() => {
    if (!raw) return null;
    const f = (arr) => arr.filter(r => matchesPeriod(r.date, period));
    return {
      ventes: f(raw.ventes),
      achats: f(raw.achats),
      recoltes: f(raw.harvests),
    };
  }, [raw, period]);

  if (!loaded || !filtered) {
    return <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}>{t('reports.loading')}</div>;
  }

  const totalVentes = filtered.ventes.reduce((s, r) => s + montantLigneEntreprise(r), 0);
  const totalAchats = filtered.achats.reduce((s, r) => s + r.quantite * r.prixUnitaire, 0);
  const totalRecoltes = filtered.recoltes.reduce((s, r) => s + (Number(r.quantite) || 0), 0);
  const benefice = totalVentes - totalAchats;

  const generatePdf = () => {
    // Les couleurs de cette feuille de style restent littérales, et c est voulu : ce document
    // part à l imprimante, sur papier blanc — la palette de l application, pensée pour un fond
    // beige à l écran, n a pas cours ici.
    const printWindow = window.open('', '_blank', 'width=900,height=1000');
    if (!printWindow) return;
    // escapeHtml : noms de clients/produits/parcelles saisis par les utilisateurs, injectés dans
    // une fenêtre de même origine que l'application (voir src/lib/securite.js).
    const row = (cols) => `<tr>${cols.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`;
    const rowsVentes = filtered.ventes.map(r => row([fmtDate(r.date), r.partenaire, r.produit, r.quantite, fmtMoney(montantLigneEntreprise(r))])).join('') || `<tr><td colspan="5">${t('reports.noVente')}</td></tr>`;
    const rowsAchats = filtered.achats.map(r => row([fmtDate(r.date), r.partenaire, r.produit, r.quantite, fmtMoney(r.quantite * r.prixUnitaire)])).join('') || `<tr><td colspan="5">${t('reports.noAchat')}</td></tr>`;
    const rowsRecoltes = filtered.recoltes.map(r => row([fmtDate(r.date), r.parcelle, r.culture, `${r.quantite} kg`])).join('') || `<tr><td colspan="4">${t('reports.noRecolte')}</td></tr>`;
    printWindow.document.write(`<!doctype html><html><head><title>${t('reports.pdfTitle', { period: periodLabel(period) })}</title>
      <style>
        body{font-family:Arial,sans-serif;padding:28px;color:#1f2937}
        h1{margin-bottom:4px} h2{margin-top:26px;font-size:16px}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{padding:7px 9px;border:1px solid #ddd;text-align:left;font-size:12.5px}
        .summary{display:flex;gap:14px;margin-top:16px;flex-wrap:wrap}
        .card{border:1px solid #ddd;border-radius:8px;padding:10px 14px;min-width:140px}
        .card span{display:block;font-size:11px;color:#6b7280;margin-bottom:3px}
      </style></head><body>
      <h1>${t('reports.pdfHeading', { period: periodLabel(period) })}</h1>
      <div style="font-size:12.5px;color:#6b7280">${t('reports.pdfGeneratedAt', { date: fmtDate(new Date(), { dateStyle: 'medium', timeStyle: 'short' }) })}</div>
      <div class="summary">
        <div class="card"><span>${t('reports.cardVentes')}</span><strong>${fmtMoney(totalVentes)}</strong></div>
        <div class="card"><span>${t('reports.cardAchats')}</span><strong>${fmtMoney(totalAchats)}</strong></div>
        <div class="card"><span>${t('reports.cardBenefice')}</span><strong>${fmtMoney(benefice)}</strong></div>
        <div class="card"><span>${t('reports.cardRecoltes')}</span><strong>${totalRecoltes.toLocaleString()} kg</strong></div>
      </div>
      <h2>${t('reports.pdfSectionVentes')}</h2><table><thead><tr><th>${t('common.date')}</th><th>${t('reports.colClient')}</th><th>${t('reports.colProduit')}</th><th>${t('devis.colQte')}</th><th>${t('common.total')}</th></tr></thead><tbody>${rowsVentes}</tbody></table>
      <h2>${t('reports.pdfSectionAchats')}</h2><table><thead><tr><th>${t('common.date')}</th><th>${t('reports.colFournisseur')}</th><th>${t('reports.colProduit')}</th><th>${t('devis.colQte')}</th><th>${t('common.total')}</th></tr></thead><tbody>${rowsAchats}</tbody></table>
      <h2>${t('reports.pdfSectionRecoltes')}</h2><table><thead><tr><th>${t('common.date')}</th><th>${t('reports.colParcelle')}</th><th>${t('reports.colCulture')}</th><th>${t('reports.colQuantite')}</th></tr></thead><tbody>${rowsRecoltes}</tbody></table>
      </body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
  };

  const exportToExcel = () => {
    const rows = [
      [t('reports.csvType'), t('common.date'), t('reports.csvPartenaire'), t('reports.colProduit'), t('reports.colQuantite'), t('common.amount')],
      ...filtered.ventes.map(r => [t('reports.csvRowVente'), r.date, r.partenaire, r.produit, Number(r.quantite) || 0, montantLigneEntreprise(r)]),
      ...filtered.achats.map(r => [t('reports.csvRowAchat'), r.date, r.partenaire, r.produit, Number(r.quantite) || 0, Number(r.quantite) * Number(r.prixUnitaire) || 0]),
      ...filtered.recoltes.map(r => [t('reports.csvRowRecolte'), r.date, r.parcelle, r.culture, Number(r.quantite) || 0, '']),
    ];

    const csv = rows.map(row => row.map(celluleCsv).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${t('reports.csvFilename')}-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('reports.title')}</div>
        <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
          {REPORT_PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{
              padding: '8px 14px', borderRadius: RADIUS.pill, border: `1px solid ${period === p ? COLORS.green : COLORS.border}`,
              background: period === p ? COLORS.greenSoft : COLORS.surfaceAlt, color: period === p ? COLORS.green : COLORS.inkSoft,
              fontWeight: 600, cursor: 'pointer', fontSize: TEXT.base
            }}>
              {periodLabel(p)}
            </button>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: SPACE.md }}>
        <Card style={{ background: COLORS.greenSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600, marginBottom: SPACE.xs }}>{t('reports.cardVentes')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.green }}>{fmtMoney(totalVentes)}</div>
        </Card>
        <Card style={{ background: COLORS.redSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.red, fontWeight: 600, marginBottom: SPACE.xs }}>{t('reports.cardAchats')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.red }}>{fmtMoney(totalAchats)}</div>
        </Card>
        <Card style={{ background: benefice >= 0 ? COLORS.blueSoft : COLORS.redSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: benefice >= 0 ? COLORS.blue : COLORS.red, fontWeight: 600, marginBottom: SPACE.xs }}>{t('reports.cardBenefice')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: benefice >= 0 ? COLORS.blue : COLORS.red }}>{fmtMoney(benefice)}</div>
        </Card>
        <Card style={{ background: COLORS.ochreSoft, border: 'none' }}>
          <div style={{ fontSize: TEXT.sm, color: COLORS.ochre, fontWeight: 600, marginBottom: SPACE.xs }}>{t('reports.cardRecoltes')}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xl, fontWeight: 700, color: COLORS.ochre }}>{fmtNumber(totalRecoltes)} kg</div>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
        <Button variant="green" onClick={generatePdf}><Download size={15} /> {t('reports.downloadPdf', { period: periodLabel(period).toLowerCase() })}</Button>
        <Button variant="blue" onClick={exportToExcel}><Download size={15} /> {t('reports.exportCsv')}</Button>
      </div>
    </div>
  );
}

// Modules activables/désactivables affichés en tuile sur la grille d'accueil, même liste que
// ModulesScreen (icônes alignées sur celles d'availableTabs plutôt que sur ModulesScreen, pour
// rester visuellement cohérent avec les dropdowns de la navbar) — contrairement à availableTabs,
// ces entrées existent même quand le module est désactivé (dimmed + badge « à activer »),
// puisqu'availableTabs omet purement et simplement un module désactivé.
const HOME_MODULE_TILES = [
  { key: 'cultures', labelKey: 'nav.cultures', icon: Sprout, category: 'operations' },
  { key: 'poulailler', labelKey: 'nav.poulailler', icon: Egg, category: 'operations' },
  { key: 'pisciculture', labelKey: 'nav.pisciculture', icon: Fish, category: 'operations' },
  { key: 'clients', labelKey: 'nav.clients', icon: Users, category: 'commercial' },
  { key: 'fournisseurs', labelKey: 'nav.fournisseurs', icon: Truck, category: 'commercial' },
  { key: 'employees', labelKey: 'nav.employees', icon: Briefcase, category: 'rh' },
  { key: 'finances', labelKey: 'nav.finances', icon: Landmark, category: 'finance' },
  { key: 'notifications', labelKey: 'nav.notifications', icon: Bell, category: 'operations' },
];

// Une tuile de la grille d'accueil — module désactivé : cliquer l'active (onToggle, même
// fonction que ModulesScreen) puis navigue directement, plutôt que d'exiger un aller-retour
// par « Gérer les options ». Module toujours actif / destination sans notion d'activation :
// clic = navigation directe.
function HomeGridTile({ label, icon: Icon, inactive, onClick }) {
  const { t } = useTranslation();
  return (
    <button onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: SPACE.sm,
      minHeight: 116, borderRadius: RADIUS.control, border: `1px solid ${COLORS.border}`,
      background: inactive ? COLORS.surfaceAlt : COLORS.surface, cursor: 'pointer',
      opacity: inactive ? 0.6 : 1, position: 'relative', padding: SPACE.md,
    }}>
      {inactive && (
        <span style={{ position: 'absolute', top: 8, right: 8, fontSize: TEXT.xs, fontWeight: 700, padding: '2px 6px', borderRadius: RADIUS.pill, background: COLORS.ochreSoft, color: COLORS.ochre }}>
          {t('home.activer')}
        </span>
      )}
      <div style={{ width: 46, height: 46, borderRadius: RADIUS.card, background: inactive ? COLORS.border : COLORS.greenSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={22} color={inactive ? COLORS.inkSoft : COLORS.green} />
      </div>
      <span style={{ fontSize: TEXT.base, fontWeight: 600, color: COLORS.ink, textAlign: 'center', lineHeight: 1.25 }}>{label}</span>
    </button>
  );
}

// Page d'accueil façon grille de lancement (inspirée du Home Menu d'anciennes versions d'un ERP
// de référence, plein écran d'icônes carrées) — remplace l'ancien HomeOverview comme contenu de
// l'onglet 'accueil' ; HomeOverview reste accessible via sa propre tuile (onglet 'tableaubord').
// Combine deux sources : HOME_MODULE_TILES (modules activables, toujours affichés qu'ils soient
// actifs ou non) + le reste d'availableTabs par catégorie (destinations sans notion
// d'activation) — les deux fusionnées pour ne jamais afficher un module en double.
function HomeGrid({ tabs, activated, onToggle, onSelect }) {
  const { t } = useTranslation();
  const restrictions = useRestrictions();
  const moduleKeys = new Set(HOME_MODULE_TILES.map(m => m.key));
  const pinned = tabs.filter(tb => !tb.category && tb.id !== 'accueil');
  // Même règle que la navbar : une tuile dont l'écran n'est pas consultable par le rôle
  // n'apparaît pas (la clé de tuile est l'id d'onglet correspondant).
  const moduleTiles = HOME_MODULE_TILES.filter(m => ongletVisible({ id: m.key }, restrictions));
  const categories = NAV_CATEGORIES
    .map(cat => ({
      ...cat,
      modules: moduleTiles.filter(m => m.category === cat.id),
      items: tabs.filter(tb => tb.category === cat.id && !moduleKeys.has(tb.id)),
    }))
    .filter(cat => cat.modules.length > 0 || cat.items.length > 0);

  const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: SPACE.md };
  const sectionLabelStyle = { display: 'flex', alignItems: 'center', gap: SPACE.sm, marginBottom: SPACE.sm, fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xs, letterSpacing: '0.07em', textTransform: 'uppercase', color: COLORS.inkSoft };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xxl }}>
      {pinned.length > 0 && (
        <div>
          <div style={sectionLabelStyle}>{t('home.general')}</div>
          <div style={gridStyle}>
            {pinned.map(tb => (
              <HomeGridTile key={tb.id} label={tb.label} icon={tb.icon} onClick={() => onSelect(tb.id)} />
            ))}
          </div>
        </div>
      )}
      {categories.map(cat => (
        <div key={cat.id}>
          <div style={sectionLabelStyle}>
            <span style={{ width: 8, height: 8, borderRadius: 2.5, background: cat.color }} />
            {t(cat.labelKey)}
          </div>
          <div style={gridStyle}>
            {cat.modules.map(m => (
              <HomeGridTile
                key={m.key} label={t(m.labelKey)} icon={m.icon} inactive={!activated[m.key]}
                onClick={() => { if (!activated[m.key]) onToggle(m.key); onSelect(m.key); }}
              />
            ))}
            {cat.items.map(tb => (
              <HomeGridTile key={tb.id} label={tb.label} icon={tb.icon} onClick={() => onSelect(tb.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HomeOverview({ farmId, activated }) {
  const { t } = useTranslation();
  const { fmtMoney } = useLocale();
  const navigate = useNavigate();
  const { peutLire } = useRestrictions();
  const [stats, setStats] = useState({
    chiffreAffaires: 0,
    depenses: 0,
    benefice: 0,
    ventes: 0,
    livraisons: 0,
    parcelles: 0,
    oeufs: 0,
    alertes: [],
  });

 useEffect(() => {
  (async () => {
    try {
      // Charge en parallèle : parcelles, livraisons, stocks, et les transactions financières
      // (source unique de vérité pour les chiffres, alignée sur l'onglet Finances)
      // Chaque source n'est interrogée que si le rôle peut la consulter : un seul refus 403
      // faisait échouer tout le Promise.all, et le tableau de bord restait vide.
      const [culturesParcelles, poulaillerLivraisons, stokages, financesData, culturesVentes, poulaillerVentes] = await Promise.all([
        activated.cultures && peutLire('parcelles') ? getParcelles() : Promise.resolve({ parcelles: [] }),
        activated.poulailler && peutLire('poulailler') ? getPoulaillerLivraisons() : Promise.resolve({ livraisons: [] }),
        activated.poulailler && peutLire('produits') ? getProduits('Poulailler') : Promise.resolve({ stocks: [] }),
        peutLire('finances') ? getFinances() : Promise.resolve({ finances: [] }),
        activated.cultures && peutLire('cultures_mouvements') ? getCulturesMouvements('vente') : Promise.resolve({ mouvements: [] }),
        activated.poulailler && peutLire('poulailler') ? getPoulaillerMouvements('vente') : Promise.resolve({ mouvements: [] }),
      ]);

      const culturesParcellesList = culturesParcelles.parcelles || [];
      const livraisons = poulaillerLivraisons.livraisons || [];
      const stocksList = stokages.stocks || [];
      const ventes = [...(culturesVentes.mouvements || []), ...(poulaillerVentes.mouvements || [])];

      // Catégories de dépenses "pures" saisies manuellement dans Finances
      const CATEGORIES_DEPENSES = ['Depenses diverses', 'Carburant', 'Salaire', 'Entretien'];

      // Ne garde que les transactions du mois en cours
      const now = new Date();
      const entriesThisMonth = (financesData.finances || []).filter(e => {
        if (!e.date) return false;
        const d = new Date(e.date);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      });

      // Chiffre d'affaires : toutes les entrées positives (ventes), hors dépenses
      const chiffreAffaires = entriesThisMonth
        .filter(e => Number(e.montant) > 0 && !CATEGORIES_DEPENSES.includes(e.categorie))
        .reduce((sum, e) => sum + Number(e.montant), 0);

      // Dépenses : achats (montants négatifs) + dépenses pures (Salaire, Carburant, etc.)
      const depenses = entriesThisMonth
        .filter(e => Number(e.montant) < 0 || CATEGORIES_DEPENSES.includes(e.categorie))
        .reduce((sum, e) => sum + Math.abs(Number(e.montant)), 0);

      const benefice = chiffreAffaires - depenses;
      const parcellesAArroser = culturesParcellesList.filter(p => p.humidite < p.seuil).length;
      const oeufsDisponibles = stocksList.filter(item => item.categorie === 'Œufs').reduce((sum, item) => sum + item.quantite, 0);
      const livraisonsEnAttente = livraisons.filter(l => l.statut === 'En attente').length;

      const alertes = [];
      if (parcellesAArroser > 0) alertes.push(t('home.alertPlotsToWater', { count: parcellesAArroser }));
      // Stock non consultable : aucune alerte « stock bas » déduite d'une liste vide.
      if (peutLire('produits') && oeufsDisponibles < 100) alertes.push(t('home.alertLowEggStock', { count: oeufsDisponibles }));
      if (livraisonsEnAttente > 0) alertes.push(t('home.alertPendingDeliveries', { count: livraisonsEnAttente }));
      if (benefice < 0) alertes.push(t('home.alertNegativeProfit', { amount: fmtMoney(benefice) }));

      setStats({
        chiffreAffaires,
        depenses,
        benefice,
        ventes: ventes.length,
        livraisons: livraisonsEnAttente,
        parcelles: parcellesAArroser,
        oeufs: oeufsDisponibles,
        alertes,
      });
    } catch (err) {
      console.error('[Dashboard stats]', err);
    }
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activated, t, peutLire]);
  // Une carte dont la source n'est pas consultable par le rôle est masquée plutôt qu'affichée
  // à 0 (un chiffre d'affaires « 0 » serait une fausse information, pas une absence d'accès).
  const finances = peutLire('finances');
  const cards = [
    finances && { label: t('home.cardRevenue'), value: fmtMoney(stats.chiffreAffaires), icon: Wallet, tone: 'green' },
    finances && { label: t('home.cardExpenses'), value: fmtMoney(stats.depenses), icon: ShoppingCart, tone: 'red' },
    finances && { label: t('home.cardProfit'), value: fmtMoney(stats.benefice), icon: TrendingUp, tone: stats.benefice >= 0 ? 'green' : 'red' },
    (peutLire('cultures_mouvements') || peutLire('poulailler')) && { label: t('home.cardSales'), value: stats.ventes, icon: Package, tone: 'blue' },
    peutLire('poulailler') && { label: t('home.cardPendingDeliveries'), value: stats.livraisons, icon: Truck, tone: 'ochre' },
    peutLire('parcelles') && { label: t('home.cardPlotsToWater'), value: stats.parcelles, icon: Droplet, tone: 'blue' },
    peutLire('produits') && { label: t('home.cardEggs'), value: stats.oeufs, icon: Egg, tone: 'ochre' },
    { label: t('home.cardAlerts'), value: stats.alertes.length, icon: AlertTriangle, tone: stats.alertes.length > 0 ? 'red' : 'green' },
  ].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.md }}>
        {cards.map(card => {
          const Icon = card.icon;
          const accent = card.tone === 'green' ? COLORS.green : card.tone === 'red' ? COLORS.red : card.tone === 'blue' ? COLORS.blue : COLORS.ochre;
          const soft = card.tone === 'green' ? COLORS.greenSoft : card.tone === 'red' ? COLORS.redSoft : card.tone === 'blue' ? COLORS.blueSoft : COLORS.ochreSoft;
          return (
            <Card key={card.label} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 600 }}>{card.label}</span>
                <div style={{ width: 36, height: 36, borderRadius: RADIUS.card, background: soft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={18} color={accent} />
                </div>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.lg, fontWeight: 700, color: COLORS.ink }}>{card.value}</div>
            </Card>
          );
        })}
      </div>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('home.alertsTitle')}</div>
        {stats.alertes.length === 0 ? (
          <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('home.noAlerts')}</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: SPACE.lg, display: 'flex', flexDirection: 'column', gap: SPACE.sm, color: COLORS.ink }}>
            {stats.alertes.map(alert => <li key={alert} style={{ fontSize: TEXT.base }}>{alert}</li>)}
          </ul>
        )}
      </Card>
      <MeteoWidget onOuvrirMeteo={() => navigate('/app/meteo')} />
    </div>
  );
}

const JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function EmployeesModule({ farmId }) {
  const { t } = useTranslation();
  const { devise } = useLocale();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rhEmployee, setRhEmployee] = useState(null);
  const [postes, setPostes] = useState([]);
  const [departements, setDepartements] = useState([]);
  const [filterDept, setFilterDept] = useState('');

  // Les outils partagés par-dessus le filtre par département, qui reste CÔTÉ SERVEUR (il
  // pilote getSalaries). Les deux modes d'affichage — trombinoscope et liste — sont conservés :
  // leurs grilles sont déjà responsives, il ne leur manquait que la recherche et le tri.
  const outilsRh = useListeOutils(employees, useMemo(() => ({
    rechercheChamps: (e) => [e.prenom, e.nom, e.posteNom, e.poste, e.departementNom, e.telephone, e.email],
    filtres: [
      { id: 'avecCompte', labelKey: 'rh.filtreAvecCompte', test: (e) => Boolean(e.userId) },
      { id: 'sansPoste', labelKey: 'rh.filtreSansPoste', test: (e) => !e.posteNom && !e.poste },
    ],
    groupes: [
      { id: 'departement', labelKey: 'rh.fieldDepartement', valeur: (e) => e.departementNom || '—' },
      { id: 'poste', labelKey: 'rh.fieldPoste', valeur: (e) => e.posteNom || e.poste || '—' },
    ],
    colonnes: {
      nom: (e) => `${e.nom || ''} ${e.prenom || ''}`.trim(),
      poste: (e) => e.posteNom || e.poste,
      departement: (e) => e.departementNom,
    },
    triParDefaut: { colonne: 'nom', sens: 'asc' },
  }), []));
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid' (trombinoscope)
  const [showMoreAdd, setShowMoreAdd] = useState(false);
  // Boutons de gestion RH : visibles pour qui peut modifier les salariés (le serveur vérifie
  // ensuite chaque action, contrats, avances, référentiels… selon sa propre ressource).
  const canManageRh = useRestrictions().peut('salaries', 'modifier');

  const emptyForm = {
    nom: '', prenom: '', posteId: '', departementId: '', managerId: '',
    dateEmbauche: '', salaire: '', email: '', telephone: '', adresse: '',
    photo: '', dateNaissance: '', contactUrgenceNom: '', contactUrgenceTel: '', numPieceIdentite: '',
    coutHoraire: '', heuresHebdo: '', joursTravailles: '',
    createAccount: false, compteEmail: '', roleId: '', password: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const emptyEditForm = {
    nom: '', prenom: '', posteId: '', departementId: '', managerId: '',
    dateEmbauche: '', salaire: '', email: '', telephone: '', adresse: '',
    photo: '', dateNaissance: '', contactUrgenceNom: '', contactUrgenceTel: '', numPieceIdentite: '',
    coutHoraire: '', heuresHebdo: '', joursTravailles: '',
    dateDepart: '', motifDepart: '', statut: 'Actif',
    linkAccount: false, compteEmail: '', password: '',
  };
  const [editingEmp, setEditingEmp] = useState(null);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState('');
  const editingId = editingEmp?.id ?? null;

  const loadRefs = async () => {
    try {
      const [p, d] = await Promise.all([getPostes(), getDepartements()]);
      setPostes(p.postes || []); setDepartements(d.departements || []);
    } catch { /* non bloquant */ }
  };

  const loadEmployees = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSalaries(filterDept || undefined);
      setEmployees(data.salaries || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRefs(); }, [farmId]);
  useEffect(() => { loadEmployees(); /* eslint-disable-next-line */ }, [farmId, filterDept]);

  const toNumOrNull = (v) => (v === '' || v == null ? null : Number(v));
  const commonPayload = (f) => ({
    nom: f.nom, prenom: f.prenom,
    posteId: f.posteId || null, departementId: f.departementId || null, managerId: f.managerId || null,
    dateEmbauche: f.dateEmbauche || null, salaire: Number(f.salaire) || 0,
    email: f.email || null, telephone: f.telephone || null, adresse: f.adresse || null,
    photo: f.photo || null, dateNaissance: f.dateNaissance || null,
    contactUrgenceNom: f.contactUrgenceNom || null, contactUrgenceTel: f.contactUrgenceTel || null,
    numPieceIdentite: f.numPieceIdentite || null,
    coutHoraire: toNumOrNull(f.coutHoraire), heuresHebdo: toNumOrNull(f.heuresHebdo),
    joursTravailles: f.joursTravailles || null,
  });

  // Les rôles de l'entreprise, pour le sélecteur du formulaire. Chargés ici plutôt que passés
  // en prop : le panneau et le formulaire en ont besoin au même endroit, et la liste est courte.
  const [rolesEntreprise, setRolesEntreprise] = useState([]);
  useEffect(() => {
    getRoles().then(({ roles }) => setRolesEntreprise(roles)).catch(() => setRolesEntreprise([]));
  }, []);

  const addEmployee = async (e) => {
    e.preventDefault();
    if (!form.nom || !form.prenom) return;
    if (form.createAccount && (!form.compteEmail || !form.password)) {
      setFormError(t('rh.errAccountFields'));
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      await createSalarie({
        ...commonPayload(form),
        createAccount: form.createAccount,
        compteEmail: form.createAccount ? form.compteEmail : undefined,
        password: form.createAccount ? form.password : undefined,
        // Plus de « niveau d'accès » imposé : seul compte le rôle défini par l'entreprise,
        // et son absence signifie « aucune restriction ».
        roleId: form.createAccount && form.roleId ? Number(form.roleId) : undefined,
      });
      setForm(emptyForm);
      setShowMoreAdd(false);
      await loadEmployees();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const removeEmployee = async (id) => {
    try {
      await deleteSalarie(id);
      await loadEmployees();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEditEmployee = (emp) => {
    setEditingEmp(emp);
    setEditError('');
    setEditForm({
      nom: emp.nom || '', prenom: emp.prenom || '',
      posteId: emp.posteId ?? '', departementId: emp.departementId ?? '', managerId: emp.managerId ?? '',
      dateEmbauche: emp.dateEmbauche ? String(emp.dateEmbauche).slice(0, 10) : '',
      salaire: emp.salaire ?? '',
      email: emp.email || '', telephone: emp.telephone || '', adresse: emp.adresse || '',
      photo: emp.photo || '',
      dateNaissance: emp.dateNaissance ? String(emp.dateNaissance).slice(0, 10) : '',
      contactUrgenceNom: emp.contactUrgenceNom || '', contactUrgenceTel: emp.contactUrgenceTel || '',
      numPieceIdentite: emp.numPieceIdentite || '',
      coutHoraire: emp.coutHoraire ?? '', heuresHebdo: emp.heuresHebdo ?? '',
      joursTravailles: emp.joursTravailles || '',
      dateDepart: emp.dateDepart ? String(emp.dateDepart).slice(0, 10) : '',
      motifDepart: emp.motifDepart || '', statut: emp.statut || 'Actif',
      linkAccount: false, compteEmail: '', password: '',
    });
  };

  const cancelEditEmployee = () => {
    setEditingEmp(null);
    setEditForm(emptyEditForm);
    setEditError('');
  };

  const saveEditEmployee = async (e) => {
    e.preventDefault();
    if (!editForm.nom || !editForm.prenom) return;
    if (editForm.linkAccount && (!editForm.compteEmail || !editForm.password)) {
      setEditError(t('rh.errLinkAccountFields'));
      return;
    }
    setEditSubmitting(true);
    setEditError('');
    try {
      await updateSalarie(editingId, {
        ...commonPayload(editForm),
        dateDepart: editForm.dateDepart || null,
        motifDepart: editForm.motifDepart || null,
        statut: editForm.statut || null,
        linkAccount: editForm.linkAccount || undefined,
        compteEmail: editForm.linkAccount ? editForm.compteEmail : undefined,
        password: editForm.linkAccount ? editForm.password : undefined,
        // Plus de niveau d'accès imposé : voir le commentaire du formulaire de création.
      });
      cancelEditEmployee();
      await loadEmployees();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setEditSubmitting(false);
    }
  };

  const toggleJour = (setF, f, j) => {
    const cur = f.joursTravailles ? f.joursTravailles.split(',').map(s => s.trim()).filter(Boolean) : [];
    const next = cur.includes(j) ? cur.filter(x => x !== j) : [...cur, j];
    setF({ ...f, joursTravailles: JOURS_SEMAINE.filter(x => next.includes(x)).join(',') });
  };

  // Bloc "informations complémentaires" partagé par le formulaire d'ajout et la modale d'édition.
  const renderInfosPlus = (f, setF) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
      <Field label={t('rh.fieldDateNaissance')} type="date" value={f.dateNaissance} onChange={e => setF({ ...f, dateNaissance: e.target.value })} />
      <Field label={t('rh.fieldContactUrgenceNom')} value={f.contactUrgenceNom} onChange={e => setF({ ...f, contactUrgenceNom: e.target.value })} />
      <Field label={t('rh.fieldContactUrgenceTel')} value={f.contactUrgenceTel} onChange={e => setF({ ...f, contactUrgenceTel: e.target.value })} />
      <Field label={t('rh.fieldNumPiece')} value={f.numPieceIdentite} onChange={e => setF({ ...f, numPieceIdentite: e.target.value })} />
      <Field label={t('rh.fieldCoutHoraire', { devise })} type="number" value={f.coutHoraire} onChange={e => setF({ ...f, coutHoraire: e.target.value })} />
      <Field label={t('rh.fieldHeuresHebdo')} type="number" value={f.heuresHebdo} onChange={e => setF({ ...f, heuresHebdo: e.target.value })} />
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, fontWeight: 500, marginBottom: SPACE.xs }}>{t('rh.joursTravailles')}</div>
        <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
          {JOURS_SEMAINE.map(j => {
            const on = (f.joursTravailles || '').split(',').map(s => s.trim()).includes(j);
            return (
              <button key={j} type="button" onClick={() => toggleJour(setF, f, j)} style={{
                background: on ? COLORS.green : 'transparent', color: on ? '#fff' : COLORS.inkSoft,
                border: `1px solid ${on ? COLORS.green : COLORS.border}`, borderRadius: RADIUS.control, padding: '4px 10px', fontSize: TEXT.sm, cursor: 'pointer',
              }}>{t(`rh.jours.${j}`, { defaultValue: j })}</button>
            );
          })}
        </div>
      </div>
    </div>
  );

  const managerOptions = (excludeId) => employees.filter(e => e.id !== excludeId);
  const renderIdentite = (f, setF, excludeManagerId) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
      <Field label={t('rh.fieldNom')} placeholder={t('rh.fieldNom')} value={f.nom} onChange={e => setF({ ...f, nom: e.target.value })} required />
      <Field label={t('rh.fieldPrenom')} placeholder={t('rh.fieldPrenom')} value={f.prenom} onChange={e => setF({ ...f, prenom: e.target.value })} required />
      <Select label={t('rh.fieldPoste')} value={f.posteId} onChange={e => setF({ ...f, posteId: e.target.value })}>
        <option value="">{t('common.none')}</option>
        {postes.map(p => <option key={p.id} value={p.id}>{p.intitule}</option>)}
      </Select>
      <Select label={t('rh.fieldDepartement')} value={f.departementId} onChange={e => setF({ ...f, departementId: e.target.value })}>
        <option value="">{t('common.none')}</option>
        {departements.map(d => <option key={d.id} value={d.id}>{d.nom}</option>)}
      </Select>
      <Select label={t('rh.fieldManager')} value={f.managerId} onChange={e => setF({ ...f, managerId: e.target.value })}>
        <option value="">{t('common.none')}</option>
        {managerOptions(excludeManagerId).map(m => <option key={m.id} value={m.id}>{m.prenom} {m.nom}</option>)}
      </Select>
      <Field label={t('rh.fieldDateEmbauche')} type="date" value={f.dateEmbauche} onChange={e => setF({ ...f, dateEmbauche: e.target.value })} />
      <Field label={t('rh.fieldSalaire')} type="number" placeholder={t('rh.fieldSalaire')} value={f.salaire} onChange={e => setF({ ...f, salaire: e.target.value })} />
      <Field label={t('rh.fieldEmailPerso')} type="email" placeholder="email@exemple.com" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
      <Field label={t('rh.fieldTelephone')} type="tel" placeholder={t('rh.fieldTelephone')} value={f.telephone} onChange={e => setF({ ...f, telephone: e.target.value })} />
      <Field label={t('rh.fieldAdresse')} placeholder={t('rh.fieldAdresse')} value={f.adresse} onChange={e => setF({ ...f, adresse: e.target.value })} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      <Suspense fallback={null}>
        <RolesPanel />
      </Suspense>
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>{t('rh.addEmployeeTitle')}</div>

        {formError && (
          <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, marginBottom: SPACE.md }}>
            {formError}
          </div>
        )}

        <form onSubmit={addEmployee} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <div style={{ display: 'flex', gap: SPACE.lg, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <ContactAvatar photo={form.photo} nom={form.nom} prenom={form.prenom} isCompany={false} size={72} onChange={(b64) => setForm({ ...form, photo: b64 })} />
            <div style={{ flex: 1, minWidth: 260 }}>{renderIdentite(form, setForm)}</div>
          </div>

          <button type="button" onClick={() => setShowMoreAdd(v => !v)} style={{ background: 'none', border: 'none', color: COLORS.blue, cursor: 'pointer', fontSize: TEXT.base, alignSelf: 'flex-start', padding: 0 }}>
            {showMoreAdd ? t('rh.hideMore') : t('rh.showMore')}
          </button>
          {showMoreAdd && renderInfosPlus(form, setForm)}

          <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.base, fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.createAccount} onChange={e => setForm({ ...form, createAccount: e.target.checked })} />
            {t('rh.createLogin')}
          </label>

          {form.createAccount && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end', padding: SPACE.md, borderRadius: RADIUS.card, background: COLORS.surfaceSoft || COLORS.surfaceAlt }}>
              <Field label={t('rh.loginEmail')} type="email" placeholder="email@exemple.com" value={form.compteEmail} onChange={e => setForm({ ...form, compteEmail: e.target.value })} required={form.createAccount} />
              {/* Le rôle défini par l'entreprise : il ne donne rien, il retire. Sans rôle, la
                  personne n'a aucune restriction — c'est le défaut du produit. */}
              <Select label="Rôle (restrictions)" value={form.roleId}
                onChange={e => setForm({ ...form, roleId: e.target.value })}>
                <option value="">Aucun rôle — aucune restriction</option>
                {rolesEntreprise.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.nom}{r.restrictions?.length ? ' (' + r.restrictions.length + ' retrait' + (r.restrictions.length > 1 ? 's' : '') + ')' : ' — tout ouvert'}
                  </option>
                ))}
              </Select>
              <Field label={t('rh.tempPassword')} type="text" placeholder={t('rh.tempPassword')} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required={form.createAccount} />
            </div>
          )}

          <Button type="submit" variant="green" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
            {submitting ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} {t('common.add')}
          </Button>
        </form>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.sm }}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('rh.employeesTitle')}</div>
          <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'center' }}>
            <select className="flat-input" value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ background: '#fff', color: COLORS.ink, fontSize: TEXT.sm }}>
              <option value="">{t('rh.allDepartments')}</option>
              {departements.map(d => <option key={d.id} value={d.id}>{d.nom}</option>)}
            </select>
            <button type="button" onClick={() => setViewMode(v => v === 'list' ? 'grid' : 'list')} style={{ background: 'none', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.control, padding: '5px 10px', fontSize: TEXT.sm, color: COLORS.inkSoft, cursor: 'pointer' }}>
              {viewMode === 'list' ? t('rh.trombinoscope') : t('rh.list')}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, marginBottom: SPACE.md }}>{error}</div>
        )}

        <BarreOutilsListe etat={outilsRh} placeholderRecherche={t('rh.rechercher')} />

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.base, color: COLORS.inkSoft }}>
            <Loader2 size={15} className="spin" /> {t('common.loading')}
          </div>
        ) : outilsRh.nbFiltrees === 0 ? (
          <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>
            {outilsRh.actif ? t('listes.aucunResultat') : (filterDept ? t('rh.noEmployeeInDept') : t('rh.noEmployee'))}
          </div>
        ) : viewMode === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: SPACE.md }}>
            {outilsRh.lignesAffichees.map(emp => (
              <div key={emp.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: SPACE.md, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: SPACE.sm, textAlign: 'center' }}>
                {emp.photo
                  ? <img src={emp.photo} alt="" style={{ width: 64, height: 64, borderRadius: RADIUS.card, objectFit: 'cover' }} />
                  : <div style={{ width: 64, height: 64, borderRadius: RADIUS.card, background: COLORS.greenSoft, color: COLORS.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{(emp.prenom?.[0] || '') + (emp.nom?.[0] || '')}</div>}
                <div style={{ fontWeight: 600, fontSize: TEXT.base }}>{emp.prenom} {emp.nom}</div>
                <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft }}>{emp.posteNom || emp.poste || '—'}{emp.departementNom ? ` · ${emp.departementNom}` : ''}</div>
                <div style={{ display: 'flex', gap: SPACE.sm, marginTop: SPACE.xs }}>
                  <button onClick={() => setRhEmployee(emp)} title={t('rh.ficheRh')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, display: 'flex' }}><ClipboardList size={15} /></button>
                  {canManageRh && <button onClick={() => startEditEmployee(emp)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue, display: 'flex' }}><Settings2 size={15} /></button>}
                  {canManageRh && <button onClick={() => removeEmployee(emp.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.red, display: 'flex' }}><Trash2 size={15} /></button>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            {outilsRh.lignesAffichees.map(emp => (
              <div key={emp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: RADIUS.card, border: `1px solid ${COLORS.border}` }}>
                <div style={{ display: 'flex', gap: SPACE.sm, alignItems: 'center' }}>
                  {emp.photo
                    ? <img src={emp.photo} alt="" style={{ width: 38, height: 38, borderRadius: RADIUS.card, objectFit: 'cover' }} />
                    : <div style={{ width: 38, height: 38, borderRadius: RADIUS.card, background: COLORS.greenSoft, color: COLORS.green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: TEXT.base }}>{(emp.prenom?.[0] || '') + (emp.nom?.[0] || '')}</div>}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: TEXT.base }}>{emp.prenom} {emp.nom}</div>
                    <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>
                      {emp.posteNom || emp.poste || t('rh.posteNonRenseigne')}
                      {emp.departementNom && ` · ${emp.departementNom}`}
                      {emp.managerNom && ` · ${t('rh.managerPrefix', { name: emp.managerNom })}`}
                      {emp.telephone && ` · ${emp.telephone}`}
                      {emp.compteEmail && ` · ${t('rh.loginPrefix', { email: emp.compteEmail })}`}
                      {emp.roleNom && ` · ${emp.roleNom}`}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                  <button onClick={() => setRhEmployee(emp)} title={t('rh.ficheRh')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, display: 'flex' }}>
                    <ClipboardList size={15} />
                  </button>
                  {canManageRh && (
                    <button onClick={() => startEditEmployee(emp)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue, display: 'flex' }}>
                      <Settings2 size={15} />
                    </button>
                  )}
                  {canManageRh && (
                    <button onClick={() => removeEmployee(emp.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.red, display: 'flex' }}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <PiedListe etat={outilsRh} />
      </Card>

      <RhReferentiels canManage={canManageRh} onChanged={() => { loadRefs(); loadEmployees(); }} />

      {editingEmp && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: SPACE.lg }} onClick={cancelEditEmployee}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: RADIUS.card, width: '100%', maxWidth: 800, maxHeight: '85vh', overflowY: 'auto', padding: SPACE.xl }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('rh.editEmployeeTitle')}</div>
              <button onClick={cancelEditEmployee} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, fontSize: TEXT.lg }}>×</button>
            </div>

            {editError && (
              <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, marginBottom: SPACE.md }}>{editError}</div>
            )}

            <form onSubmit={saveEditEmployee} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
              <div style={{ display: 'flex', gap: SPACE.lg, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <ContactAvatar photo={editForm.photo} nom={editForm.nom} prenom={editForm.prenom} isCompany={false} size={72} onChange={(b64) => setEditForm({ ...editForm, photo: b64 })} />
                <div style={{ flex: 1, minWidth: 260 }}>{renderIdentite(editForm, setEditForm, editingId)}</div>
              </div>

              {renderInfosPlus(editForm, setEditForm)}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
                <Select label={t('rh.fieldStatut')} value={editForm.statut} onChange={e => setEditForm({ ...editForm, statut: e.target.value })}>
                  <option value="Actif">{t('rh.statutActif')}</option>
                  <option value="Inactif">{t('rh.statutInactif')}</option>
                </Select>
                <Field label={t('rh.fieldDateDepart')} type="date" value={editForm.dateDepart} onChange={e => setEditForm({ ...editForm, dateDepart: e.target.value })} />
                <Field label={t('rh.fieldMotifDepart')} value={editForm.motifDepart} onChange={e => setEditForm({ ...editForm, motifDepart: e.target.value })} />
              </div>

              {!editingEmp.compteEmail && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.base, fontWeight: 600, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.linkAccount} onChange={e => setEditForm({ ...editForm, linkAccount: e.target.checked })} />
                    {t('rh.createLogin')}
                  </label>
                  {editForm.linkAccount && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end', padding: SPACE.md, borderRadius: RADIUS.card, background: COLORS.surfaceSoft || COLORS.surfaceAlt }}>
                      <Field label={t('rh.loginEmail')} type="email" value={editForm.compteEmail} onChange={e => setEditForm({ ...editForm, compteEmail: e.target.value })} required />
                      <Field label={t('rh.tempPassword')} type="text" value={editForm.password} onChange={e => setEditForm({ ...editForm, password: e.target.value })} required />
                    </div>
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: SPACE.sm }}>
                <Button type="submit" variant="green" disabled={editSubmitting}>
                  {editSubmitting ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {t('common.save')}
                </Button>
                <Button type="button" onClick={cancelEditEmployee}>{t('common.cancel')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {rhEmployee && (
        <EmployeeRhModal employee={rhEmployee} canManage={canManageRh} onClose={() => setRhEmployee(null)} />
      )}
    </div>
  );
}

function NotificationsModule({ farmId, activated }) {
  const { t } = useTranslation();
  const { fmtMoney } = useLocale();
  const [notifications, setNotifications] = useState([]);
  const { peutLire } = useRestrictions();

  useEffect(() => {
    (async () => {
      try {
        // Même principe que HomeOverview : on n'interroge que ce que le rôle peut consulter,
        // sinon un seul 403 vidait toutes les notifications.
        const [parcellesData, stocksData, livraisonsData, devisData] = await Promise.all([
          activated?.cultures && peutLire('parcelles') ? getParcelles() : Promise.resolve({ parcelles: [] }),
          activated?.poulailler && peutLire('produits') ? getProduits('Poulailler') : Promise.resolve({ stocks: [] }),
          activated?.poulailler && peutLire('poulailler') ? getPoulaillerLivraisons() : Promise.resolve({ livraisons: [] }),
          peutLire('devis') ? getDevisListe() : Promise.resolve({ devis: [] }),
        ]);

        const parcelles = parcellesData.parcelles || [];
        const stocks = stocksData.stocks || [];
        const livraisons = livraisonsData.livraisons || [];
        const devisListe = devisData.devis || [];

        const items = [];
        stocks.filter(item => item.quantite <= (item.seuil || 0)).forEach(item => {
          items.push({ id: `stock-${item.id}`, icon: '🔴', title: t('notifications.lowStockTitle'), message: t('notifications.lowStockMsg', { name: item.nom, qty: item.quantite, unit: item.unite || '' }) });
        });

        parcelles.filter(p => p.temperature > 33).forEach(p => {
          items.push({ id: `temp-${p.id}`, icon: '⚠️', title: t('notifications.highTempTitle'), message: t('notifications.highTempMsg', { name: p.nom, temp: p.temperature }) });
        });

        parcelles.filter(p => p.humidite < p.seuil).forEach(p => {
          items.push({ id: `soil-${p.id}`, icon: '💧', title: t('notifications.drySoilTitle'), message: t('notifications.drySoilMsg', { name: p.nom }) });
        });

        livraisons.filter(l => l.statut === 'En attente').forEach(l => {
          items.push({ id: `delivery-${l.id}`, icon: '🚚', title: t('notifications.deliveryTitle'), message: t('notifications.deliveryMsg', { product: l.produit, customer: l.client }) });
        });

        devisListe.filter(d => ['Non payé', 'Payé partiellement'].includes(d.statut)).forEach(d => {
          const nomClient = [d.clientPrenom, d.clientNom].filter(Boolean).join(' ') || t('notifications.defaultCustomer');
          items.push({ id: `client-${d.id}`, icon: '💰', title: t('notifications.unpaidTitle'), message: t('notifications.unpaidMsg', { customer: nomClient, number: d.numero, amount: fmtMoney(d.total), status: d.statut }) });
        });

        setNotifications(items);
      } catch (err) {
        console.error('[NotificationsModule]', err);
        setNotifications([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmId, activated, t, peutLire]);

  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{t('notifications.title')}</div>
      {notifications.length === 0 ? (
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('notifications.empty')}</div>
      ) : (
        notifications.map(item => (
          <div key={item.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: '10px 12px', display: 'flex', gap: SPACE.sm, alignItems: 'flex-start' }}>
            <div style={{ fontSize: TEXT.lg }}>{item.icon}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: TEXT.base }}>{item.title}</div>
              <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, marginTop: 3 }}>{item.message}</div>
            </div>
          </div>
        ))
      )}
    </Card>
  );
}



// Gère les listes de prix nommées et réutilisables de l'entreprise (remplace
// ClientPrixSection, 2026-08-18) — contrairement à l'ancien prix négocié client+article
// (une ligne = un override non réutilisable), une liste peut être assignée à plusieurs
// contacts à la fois (via le sélecteur "Liste de prix" dans ContactsTab). Ne dépend
// d'aucun contact sélectionné : gère toutes les listes de l'entreprise d'un coup, même
// esprit que "Gérer les catégories" dans StocksTab (panneau repliable).
function ListesPrixManager() {
  const { t } = useTranslation();
  const { fmtMoney, devise } = useLocale();
  const [listes, setListes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newNom, setNewNom] = useState('');
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [lignesParListe, setLignesParListe] = useState({});
  const [catalogItems, setCatalogItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const emptyLigneForm = {
    appliedOn: 'variante', produit: '', stockId: null, templateId: '', categorieId: '',
    computePrice: 'fixe', prix: '', pourcentage: '', quantiteMin: '', dateDebut: '', dateFin: '',
  };
  const [ligneForm, setLigneForm] = useState(emptyLigneForm);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const datalistId = 'listes-prix-catalog';

  const loadListes = useCallback(async () => {
    setLoading(true);
    try {
      const { listes: loaded } = await getListesPrix();
      setListes(loaded || []);
    } catch (err) {
      console.error('[ListesPrixManager load]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadListes(); }, [loadListes]);

  useEffect(() => {
    (async () => {
      try {
        const { stocks } = await getProduits();
        setCatalogItems(stocks || []);
      } catch (err) {
        console.error('[ListesPrixManager catalog]', err);
      }
    })();
    (async () => {
      try {
        const [{ templates: tCultures }, { templates: tPoulailler }] = await Promise.all([
          getProduitTemplates('Cultures'), getProduitTemplates('Poulailler'),
        ]);
        setTemplates([...(tCultures || []), ...(tPoulailler || [])]);
      } catch (err) {
        console.error('[ListesPrixManager templates]', err);
      }
    })();
    (async () => {
      try {
        const { categories: cats } = await getProduitCategories();
        setCategories(cats || []);
      } catch (err) {
        console.error('[ListesPrixManager categories]', err);
      }
    })();
  }, []);

  const createListe = async (e) => {
    e.preventDefault();
    if (!newNom.trim()) return;
    setCreating(true);
    try {
      await createListePrix({ nom: newNom.trim() });
      setNewNom('');
      notifySuccess(t('contacts.listes.created'));
      await loadListes();
    } catch (err) {
      notifyError(err, t('contacts.listes.createError'));
    } finally {
      setCreating(false);
    }
  };

  const removeListe = async (id, nom) => {
    if (!window.confirm(t('contacts.listes.confirmDelete', { nom }))) return;
    try {
      await deleteListePrix(id);
      setListes(l => l.filter(x => x.id !== id));
      if (expandedId === id) setExpandedId(null);
      notifySuccess(t('contacts.listes.deleted'));
    } catch (err) {
      notifyError(err, t('contacts.listes.deleteError'));
    }
  };

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!lignesParListe[id]) {
      try {
        const { lignes } = await getListePrixLignes(id);
        setLignesParListe(m => ({ ...m, [id]: lignes || [] }));
      } catch (err) {
        console.error('[ListesPrixManager lignes]', err);
      }
    }
  };

  const addLigne = async (e, listeId) => {
    e.preventDefault();
    const { appliedOn, stockId, templateId, categorieId, computePrice, prix, pourcentage, quantiteMin, dateDebut, dateFin } = ligneForm;
    if (appliedOn === 'variante' && !stockId) { notifyError(null, t('contacts.listes.ligneError')); return; }
    if (appliedOn === 'gabarit' && !templateId) { notifyError(null, t('contacts.listes.ligneError')); return; }
    if (appliedOn === 'categorie' && !categorieId) { notifyError(null, t('contacts.listes.ligneError')); return; }
    if (computePrice === 'fixe' && prix === '') { notifyError(null, t('contacts.listes.ligneError')); return; }
    if (computePrice !== 'fixe' && pourcentage === '') { notifyError(null, t('contacts.listes.ligneError')); return; }
    try {
      await createListePrixLigne(listeId, {
        appliedOn,
        stockId: appliedOn === 'variante' ? stockId : undefined,
        templateId: appliedOn === 'gabarit' ? Number(templateId) : undefined,
        categorieId: appliedOn === 'categorie' ? Number(categorieId) : undefined,
        computePrice,
        prix: computePrice === 'fixe' ? Number(prix) : undefined,
        pourcentage: computePrice !== 'fixe' ? Number(pourcentage) : undefined,
        quantiteMin: quantiteMin === '' ? 0 : Number(quantiteMin),
        dateDebut: dateDebut || undefined,
        dateFin: dateFin || undefined,
      });
      const { lignes } = await getListePrixLignes(listeId);
      setLignesParListe(m => ({ ...m, [listeId]: lignes || [] }));
      setListes(l => l.map(x => x.id === listeId ? { ...x, nombreLignes: lignes.length } : x));
      setLigneForm(emptyLigneForm);
      setAdvancedOpen(false);
    } catch (err) {
      notifyError(err, t('contacts.listes.ligneSaveError'));
    }
  };

  const removeLigne = async (ligneId, listeId) => {
    if (!window.confirm(t('contacts.listes.confirmDeleteLigne'))) return;
    try {
      await deleteListePrixLigne(ligneId);
      setLignesParListe(m => ({ ...m, [listeId]: (m[listeId] || []).filter(l => l.id !== ligneId) }));
      setListes(l => l.map(x => x.id === listeId ? { ...x, nombreLignes: Math.max(0, x.nombreLignes - 1) } : x));
    } catch (err) {
      notifyError(err, t('contacts.listes.ligneDeleteError'));
    }
  };

  // Libellé de cible affiché pour une règle déjà créée, selon son niveau de spécificité.
  const cibleDeLigne = (l) => {
    if (l.appliedOn === 'variante') return l.stockNom;
    if (l.appliedOn === 'gabarit') return l.templateNom;
    if (l.appliedOn === 'categorie') return l.categorieNom;
    return t('contacts.listes.appliedOnGlobal');
  };
  const modeDeLigne = (l) => l.computePrice === 'fixe' ? fmtMoney(l.prix) : `${l.pourcentage > 0 ? '+' : ''}${l.pourcentage}%`;

  return (
    <Card>
      <datalist id={datalistId}>
        {catalogItems.map(item => <option key={`${item.module}-${item.id}`} value={item.nom} />)}
      </datalist>
      <button type="button" onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue, fontSize: TEXT.base, padding: 0, fontWeight: 600 }}>
        {open ? t('contacts.listes.toggleHide') : t('contacts.listes.toggleShow')}
      </button>
      {open && (
        <div style={{ marginTop: SPACE.md, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
          <form onSubmit={createListe} style={{ display: 'flex', gap: SPACE.sm }}>
            <Field placeholder={t("contacts.listes.newPlaceholder")} value={newNom} onChange={e => setNewNom(e.target.value)} />
            <Button type="submit" variant="ochre" disabled={creating} style={{ whiteSpace: 'nowrap' }}>
              {creating ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {t("contacts.listes.create")}
            </Button>
          </form>
          {loading ? (
            <div style={{ color: COLORS.inkSoft, fontSize: TEXT.base }}>{t("common.loading")}</div>
          ) : listes.length === 0 ? (
            <div style={{ color: COLORS.inkSoft, fontSize: TEXT.base }}>{t("contacts.listes.empty")}</div>
          ) : listes.map(liste => (
            <div key={liste.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, padding: SPACE.sm }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggleExpand(liste.id)}>
                <div>
                  <span style={{ fontWeight: 700 }}>{liste.nom}</span>
                  <span style={{ color: COLORS.inkSoft, fontSize: TEXT.sm, marginLeft: SPACE.sm }}>{t('contacts.listes.articleCount', { count: liste.nombreLignes })}</span>
                </div>
                <button onClick={(ev) => { ev.stopPropagation(); removeListe(liste.id, liste.nom); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, display: 'flex' }}>
                  <Trash2 size={14} />
                </button>
              </div>
              {expandedId === liste.id && (
                <div style={{ marginTop: SPACE.sm, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                  <form onSubmit={(e) => addLigne(e, liste.id)} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, padding: SPACE.sm, background: COLORS.paper, borderRadius: RADIUS.card }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm, alignItems: 'end' }}>
                      <Select label={t("contacts.listes.appliedOn")} value={ligneForm.appliedOn} onChange={e => setLigneForm({ ...emptyLigneForm, appliedOn: e.target.value })}>
                        <option value="variante">{t('contacts.listes.appliedOnVariante')}</option>
                        <option value="gabarit">{t('contacts.listes.appliedOnGabarit')}</option>
                        <option value="categorie">{t('contacts.listes.appliedOnCategorie')}</option>
                        <option value="global">{t('contacts.listes.appliedOnGlobal')}</option>
                      </Select>
                      {ligneForm.appliedOn === 'variante' && (
                        <Field label={t("contacts.listes.cible")} placeholder={t("contacts.listes.articlePlaceholder")} list={datalistId} value={ligneForm.produit} onChange={e => {
                          const value = e.target.value;
                          const match = catalogItems.find(item => item.nom.toLowerCase() === value.toLowerCase());
                          setLigneForm({ ...ligneForm, produit: value, stockId: match ? match.id : null });
                        }} />
                      )}
                      {ligneForm.appliedOn === 'gabarit' && (
                        <Select label={t("contacts.listes.cible")} value={ligneForm.templateId} onChange={e => setLigneForm({ ...ligneForm, templateId: e.target.value })}>
                          <option value="">{t('contacts.listes.cibleChoose')}</option>
                          {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.nom}</option>)}
                        </Select>
                      )}
                      {ligneForm.appliedOn === 'categorie' && (
                        <Select label={t("contacts.listes.cible")} value={ligneForm.categorieId} onChange={e => setLigneForm({ ...ligneForm, categorieId: e.target.value })}>
                          <option value="">{t('contacts.listes.cibleChoose')}</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.completeName || c.nom}</option>)}
                        </Select>
                      )}
                      <Select label={t("contacts.listes.computePrice")} value={ligneForm.computePrice} onChange={e => setLigneForm({ ...ligneForm, computePrice: e.target.value })}>
                        <option value="fixe">{t('contacts.listes.computePriceFixe')}</option>
                        <option value="pourcentage">{t('contacts.listes.computePricePourcentage')}</option>
                      </Select>
                      {ligneForm.computePrice === 'fixe' ? (
                        <Field label={t("contacts.listes.prix", { devise })} type="number" placeholder="0" value={ligneForm.prix} onChange={e => setLigneForm({ ...ligneForm, prix: e.target.value })} />
                      ) : (
                        <Field label={t("contacts.listes.pourcentage")} type="number" placeholder={t("contacts.listes.pourcentagePlaceholder")} value={ligneForm.pourcentage} onChange={e => setLigneForm({ ...ligneForm, pourcentage: e.target.value })} />
                      )}
                      <Button type="submit" small><Plus size={14} /> {t("common.add")}</Button>
                    </div>
                    <button type="button" onClick={() => setAdvancedOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue, fontSize: TEXT.sm, padding: 0, textAlign: 'left', width: 'fit-content' }}>
                      {t('contacts.listes.advanced')}
                    </button>
                    {advancedOpen && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: SPACE.sm }}>
                        <Field label={t("contacts.listes.quantiteMin")} type="number" placeholder="0" value={ligneForm.quantiteMin} onChange={e => setLigneForm({ ...ligneForm, quantiteMin: e.target.value })} />
                        <Field label={t("contacts.listes.dateDebut")} type="date" value={ligneForm.dateDebut} onChange={e => setLigneForm({ ...ligneForm, dateDebut: e.target.value })} />
                        <Field label={t("contacts.listes.dateFin")} type="date" value={ligneForm.dateFin} onChange={e => setLigneForm({ ...ligneForm, dateFin: e.target.value })} />
                      </div>
                    )}
                  </form>
                  {(lignesParListe[liste.id] || []).length === 0 ? (
                    <div style={{ color: COLORS.inkSoft, fontSize: TEXT.sm }}>{t("contacts.listes.emptyLignes")}</div>
                  ) : (lignesParListe[liste.id] || []).map(l => (
                    <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, fontSize: TEXT.base }}>
                      <span>
                        {l.quantiteMin > 0
                          ? t('contacts.listes.ligneResume', { cible: cibleDeLigne(l), mode: modeDeLigne(l), qte: l.quantiteMin })
                          : `${cibleDeLigne(l)} · ${modeDeLigne(l)}`}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                        <button onClick={() => removeLigne(l.id, liste.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.red, display: 'flex' }}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Config par type pour ContactsTab — un même contact réel peut être client ET
// fournisseur (est_client/est_fournisseur indépendants côté backend, voir contacts.js) ;
// ce composant unifie ce qui était ClientsModule/FournisseursModule (quasi identiques
// octet pour octet avant cette fusion), même principe que StocksTab({ moduleType }).
// Les libellés (client/fournisseur, singulier/pluriel/capitalisé) sont dans i18n
// (contacts.type.* / typeCap.* / typePlural.*) ; ici seuls l'accent couleur et la clé
// du rôle "autre" restent, car ils pilotent de la logique/du style, pas de l'affichage.
const CONTACT_TYPE_CONFIG = {
  client: { accent: COLORS.green, autreKey: 'fournisseur' },
  fournisseur: { accent: COLORS.ochre, autreKey: 'client' },
};

// Redimensionne une image choisie par l'utilisateur en un carré `maxSize`px avant de
// l'encoder en base64 (un widget image standard fait la même chose côté serveur ; ici
// tout se passe côté client puisqu'il n'existe aucune infrastructure de stockage de
// fichiers dans cette app — le base64 part directement dans la colonne contacts.photo).
function resizeImageToBase64(file, maxSize = 128) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier impossible.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image invalide.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Avatar façon fiche d'un ERP de référence (un widget image standard, 130px, coins arrondis) — retombe sur des initiales
// si aucune photo n'est renseignée plutôt que sur une icône générique, pour rester lisible
// même sans upload. `onChange` absent = lecture seule (utilisé dans le panneau de détail).
function ContactAvatar({ photo, nom, prenom, isCompany, onChange, size = 130 }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const initials = isCompany
    ? (nom || '?').trim().slice(0, 2).toUpperCase()
    : (`${(prenom || '').charAt(0)}${(nom || '').charAt(0)}`.toUpperCase() || '?');
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {photo ? (
        <img src={photo} alt={t("contacts.avatarAlt")} style={{ width: size, height: size, borderRadius: RADIUS.card, objectFit: 'cover', border: `1px solid ${COLORS.border}`, display: 'block' }} />
      ) : (
        <div style={{ width: size, height: size, borderRadius: RADIUS.card, border: `1px solid ${COLORS.border}`, background: COLORS.surfaceAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size / 3, fontWeight: 700, color: COLORS.inkSoft }}>
          {initials}
        </div>
      )}
      {onChange && (
        <>
          <button
            type="button"
            title={t("contacts.avatarChange")}
            onClick={() => inputRef.current?.click()}
            style={{ position: 'absolute', bottom: -6, right: -6, width: 28, height: 28, borderRadius: RADIUS.control, border: `1px solid ${COLORS.border}`, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.inkSoft, padding: 0 }}
          >
            <Camera size={14} />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const base64 = await resizeImageToBase64(file, 128);
                onChange(base64);
              } catch (err) {
                notifyError(err, t('contacts.avatarLoadError'));
              }
            }}
          />
        </>
      )}
    </div>
  );
}

// Gestionnaire de tags de contact (un widget de tags standard côté ERP de référence) — panneau repliable, même
// esprit que ListesPrixManager/"Gérer les catégories" de StocksTab : une ressource CRUD
// par entreprise, pas une liste figée.
function ContactTagsManager({ tags, onChange }) {
  const { t: tr } = useTranslation();
  const [open, setOpen] = useState(false);
  const [nom, setNom] = useState('');
  const [couleur, setCouleur] = useState(COLORS.ochre);
  const [creating, setCreating] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    if (!nom.trim()) return;
    setCreating(true);
    try {
      await createContactTag({ nom: nom.trim(), couleur });
      setNom('');
      notifySuccess(tr('contacts.tags.created'));
      onChange();
    } catch (err) {
      notifyError(err, tr('contacts.tags.createError'));
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id, tagNom) => {
    if (!window.confirm(tr('contacts.tags.confirmDelete', { nom: tagNom }))) return;
    try {
      await deleteContactTag(id);
      notifySuccess(tr('contacts.tags.deleted'));
      onChange();
    } catch (err) {
      notifyError(err, tr('contacts.tags.deleteError'));
    }
  };

  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', color: COLORS.blue, cursor: 'pointer', fontSize: TEXT.sm, fontWeight: 600, padding: 0 }}>
        {tr('contacts.tags.toggle')} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div style={{ marginTop: SPACE.sm, padding: SPACE.md, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
            {tags.map(t => (
              <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.xs, background: t.couleur + '22', color: t.couleur, border: `1px solid ${t.couleur}55`, borderRadius: RADIUS.pill, padding: '3px 8px', fontSize: TEXT.sm }}>
                {t.nom}
                <button type="button" onClick={() => remove(t.id, t.nom)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex' }}>
                  <Trash2 size={11} />
                </button>
              </span>
            ))}
            {tags.length === 0 && <span style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{tr("contacts.tags.empty")}</span>}
          </div>
          <form onSubmit={create} style={{ display: 'flex', gap: SPACE.sm, alignItems: 'center' }}>
            <input className="flat-input" value={nom} onChange={e => setNom(e.target.value)} placeholder={tr("contacts.tags.placeholder")} style={{ flex: 1 }} />
            <input type="color" value={couleur} onChange={e => setCouleur(e.target.value)} style={{ width: 32, height: 30, padding: 0, border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.control, cursor: 'pointer' }} />
            <Button small type="submit" variant="outline" disabled={creating}>{creating ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}</Button>
          </form>
        </div>
      )}
    </div>
  );
}

function ContactsTab({ type, highlightId }) {
  const { t: tr } = useTranslation();
  const { fmtMoney, fmtDate } = useLocale();
  const cfg = CONTACT_TYPE_CONFIG[type];
  // Libellés dépendant du type (client/fournisseur), résolus une fois.
  const L = {
    s: tr(`contacts.type.${type}`),
    sCap: tr(`contacts.typeCap.${type}`),
    pl: tr(`contacts.typePlural.${type}`),
    autre: tr(`contacts.type.${cfg.autreKey}`),
    nomPh: tr(`contacts.nomPlaceholder.${type}`),
    prenomPh: tr(`contacts.prenomPlaceholder.${type}`),
  };
  const [contacts, setContacts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [apiError, setApiError] = useState('');
  const emptyForm = {
    nom: '', prenom: '', telephone: '', adresse: '', email: '', siret: '', estAutre: false, listePrixId: null,
    adresseRue: '', adresseRue2: '', adresseVille: '', adresseCodePostal: '', adresseRegion: '', adressePays: '',
    isCompany: false, photo: null, fonction: '', notes: '', parentId: null, tagIds: [], deviseFacturation: null,
  };
  const [form, setForm]         = useState(emptyForm);

  const [editingId, setEditingId] = useState(null); // null = fenêtre de modification fermée, sinon id du contact en cours d'édition
  const [editForm, setEditForm] = useState(emptyForm);
  const [editSaving, setEditSaving] = useState(false);

  const [listesPrix, setListesPrix] = useState([]);
  useEffect(() => {
    if (type !== 'client') return;
    (async () => {
      try {
        const { listes } = await getListesPrix();
        setListesPrix(listes || []);
      } catch (err) {
        console.error('[ContactsTab listesPrix]', err);
      }
    })();
  }, [type]);

  // Tags colorés (un widget de tags standard), chargés une fois pour toute l'entreprise — voir
  // ContactTagsManager pour la gestion CRUD (création/suppression).
  const [contactTags, setContactTags] = useState([]);
  const loadTags = useCallback(async () => {
    try {
      const { tags } = await getContactTags();
      setContactTags(tags || []);
    } catch (err) {
      console.error('[ContactsTab tags]', err);
    }
  }, []);
  useEffect(() => { loadTags(); }, [loadTags]);

  // Sous-contacts (personnes rattachées à une société) — façon ERP (page "Contacts" du
  // formulaire fiche), mais en section repliable plutôt qu'un vrai onglet séparé : ne
  // concerne que l'édition d'un contact déjà marqué Société (une nouvelle fiche n'a pas
  // encore d'id pour y rattacher qui que ce soit).
  const [subContacts, setSubContacts] = useState([]);
  const [subContactsLoading, setSubContactsLoading] = useState(false);
  const emptySubForm = { nom: '', prenom: '', telephone: '', email: '', fonction: '' };
  const [subForm, setSubForm] = useState(emptySubForm);
  const [subSaving, setSubSaving] = useState(false);

  const loadSubContacts = useCallback(async (parentId) => {
    if (!parentId) { setSubContacts([]); return; }
    setSubContactsLoading(true);
    try {
      const { contacts: children } = await getContacts(type, parentId);
      setSubContacts(children || []);
    } catch (err) {
      console.error('[ContactsTab subContacts]', err);
    } finally {
      setSubContactsLoading(false);
    }
  }, [type]);

  const submitSubContact = async (e) => {
    e.preventDefault();
    if (!subForm.nom || !editingId) return;
    setSubSaving(true);
    try {
      const { contact } = await createContact({
        nom: subForm.nom, prenom: subForm.prenom, telephone: subForm.telephone, email: subForm.email, fonction: subForm.fonction,
        estClient: type === 'client', estFournisseur: type === 'fournisseur', parentId: editingId, isCompany: false,
      });
      setSubContacts(prev => [contact, ...prev]);
      setSubForm(emptySubForm);
      notifySuccess(tr('contacts.subContactAdded'));
    } catch (err) {
      notifyError(err, tr('contacts.subContactAddError'));
    } finally {
      setSubSaving(false);
    }
  };

  const removeSubContact = async (id, nom) => {
    if (!window.confirm(tr('contacts.subContactConfirmDelete', { nom }))) return;
    try {
      await deleteContact(id);
      setSubContacts(prev => prev.filter(c => c.id !== id));
      notifySuccess(tr('contacts.subContactDeleted'));
    } catch (err) {
      notifyError(err, tr('contacts.subContactDeleteError'));
    }
  };

  const selectedContact = contacts.find(c => c.id === selectedId) || null;

  // Bouton intelligent façon ERP ("Devis (3)" / "Achats (2)" sur une fiche) :
  // charge la liste liée au contact sélectionné (devis pour un client, achats
  // pour un fournisseur — un contact double-rôle n'a qu'une seule des deux vues
  // active à la fois, selon la valeur de `type` sur cet onglet), affiche le
  // compte tout de suite, et déplie une liste inline au clic plutôt que de
  // naviguer ailleurs (DevisModule/AchatModule n'ont pas de filtre par contact).
  const [relatedList, setRelatedList] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);

  useEffect(() => {
    setRelatedOpen(false);
    if (!selectedId) {
      setRelatedList([]);
      return;
    }
    setRelatedLoading(true);
    (async () => {
      try {
        if (type === 'client') {
          const { devis } = await getDevisListe(selectedId);
          setRelatedList(devis || []);
        } else {
          const { documents } = await getAchatsParFournisseur(selectedId);
          setRelatedList(documents || []);
        }
      } catch (err) {
        console.error('[ContactsTab related]', err);
        setRelatedList([]);
      } finally {
        setRelatedLoading(false);
      }
    })();
  }, [selectedId, type]);
  const autreFlagKey = type === 'client' ? 'estFournisseur' : 'estClient';

  const buildPayload = (f) => ({
    nom: f.nom, prenom: f.prenom, telephone: f.telephone, adresse: f.adresse, email: f.email, siret: f.siret,
    adresseRue: f.adresseRue, adresseRue2: f.adresseRue2, adresseVille: f.adresseVille,
    adresseCodePostal: f.adresseCodePostal, adresseRegion: f.adresseRegion, adressePays: f.adressePays,
    isCompany: f.isCompany, photo: f.photo, fonction: f.fonction, notes: f.notes,
    parentId: f.parentId, tagIds: f.tagIds,
    estClient: type === 'client' ? true : f.estAutre,
    estFournisseur: type === 'fournisseur' ? true : f.estAutre,
    ...(type === 'client' ? { listePrixId: f.listePrixId, deviseFacturation: f.deviseFacturation } : {}),
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { contacts: loaded } = await getContacts(type);
        setContacts(loaded || []);
        if (loaded && loaded.length > 0) {
          const wantedId = highlightId && loaded.some(c => c.id === highlightId) ? highlightId : loaded[0].id;
          setSelectedId(wantedId);
        }
      } catch (err) {
        setApiError(err.message || tr('contacts.loadError', { typePlural: L.pl }));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Si l'onglet était déjà monté (l'utilisateur y était déjà) au moment d'un
  // clic sur un résultat de recherche global, le montage ci-dessus ne se
  // redéclenche pas — cet effet séparé rattrape ce cas en réagissant
  // directement à highlightId sans refaire d'appel réseau.
  useEffect(() => {
    if (highlightId && contacts.some(c => c.id === highlightId)) {
      setSelectedId(highlightId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId]);

  // Soumet le formulaire d'ajout d'un nouveau contact
  const submitForm = async (e) => {
    e.preventDefault();
    if (!form.nom) return;
    setSaving(true);
    setApiError('');
    try {
      const { contact } = await createContact(buildPayload(form));
      setContacts(prev => [contact, ...prev]);
      setSelectedId(contact.id);
      setForm(emptyForm);
    } catch (err) {
      setApiError(err.message || tr('contacts.saveError'));
    } finally {
      setSaving(false);
    }
  };

  // Ouvre la fenêtre de modification d'un contact existant
  const startEdit = (contact) => {
    setEditingId(contact.id);
    setEditForm({
      nom: contact.nom || '',
      prenom: contact.prenom || '',
      telephone: contact.telephone || '',
      adresse: contact.adresse || '',
      email: contact.email || '',
      siret: contact.siret || '',
      estAutre: Boolean(contact[autreFlagKey]),
      listePrixId: contact.listePrixId ?? null,
      deviseFacturation: contact.deviseFacturation ?? null,
      adresseRue: contact.adresseRue || '',
      adresseRue2: contact.adresseRue2 || '',
      adresseVille: contact.adresseVille || '',
      adresseCodePostal: contact.adresseCodePostal || '',
      adresseRegion: contact.adresseRegion || '',
      adressePays: contact.adressePays || '',
      isCompany: Boolean(contact.isCompany),
      photo: contact.photo || null,
      fonction: contact.fonction || '',
      notes: contact.notes || '',
      parentId: contact.parentId ?? null,
      tagIds: (contact.tags || []).map(t => t.id),
    });
    setSubForm(emptySubForm);
    if (contact.isCompany) loadSubContacts(contact.id); else setSubContacts([]);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
    setSubContacts([]);
  };

  const submitEditForm = async (e) => {
    e.preventDefault();
    if (!editForm.nom) return;
    setEditSaving(true);
    setApiError('');
    try {
      const { contact } = await updateContact(editingId, buildPayload(editForm));
      setContacts(prev => prev.map(c => c.id === editingId ? contact : c));
      notifySuccess(tr('contacts.updated', { typeCap: L.sCap }));
      cancelEdit();
    } catch (err) {
      setApiError(err.message || tr('contacts.saveError'));
    } finally {
      setEditSaving(false);
    }
  };

  const removeContact = async (id, nom) => {
    if (!window.confirm(tr('contacts.confirmDelete', { type: L.s, nom }))) return;
    setApiError('');
    try {
      await deleteContact(id);
      setContacts(prev => prev.filter(c => c.id !== id));
      if (selectedId === id) setSelectedId(null);
      notifySuccess(tr('contacts.deleted', { typeCap: L.sCap }));
    } catch (err) {
      setApiError(err.message || tr('contacts.deleteError'));
    }
  };

  // Les outils partagés, mais PAS TableauListe : cet écran est une liste-détail, pas un
  // tableau. Le hook apporte ce qui manquait — filtres, tri, regroupement, pagination — et le
  // rendu en cartes reste celui qui convient ici.
  const etroitContacts = useAffichageEtroit();
  const outilsContacts = useListeOutils(contacts, useMemo(() => ({
    rechercheChamps: (c) => [c.nom, c.prenom, c.telephone, c.adresse, c.email, c.fonction],
    filtres: [
      { id: 'societes', labelKey: 'contacts.filtreSocietes', test: (c) => c.isCompany },
      { id: 'particuliers', labelKey: 'contacts.filtreParticuliers', test: (c) => !c.isCompany },
      { id: 'sansTelephone', labelKey: 'contacts.filtreSansTelephone', test: (c) => !c.telephone },
    ],
    groupes: [
      { id: 'societe', labelKey: 'contacts.filtreSocietes', valeur: (c) => (c.isCompany ? c.nom : (c.parentNom || '—')) },
    ],
    colonnes: {
      nom: (c) => `${c.nom} ${c.prenom || ''}`.trim(),
      telephone: (c) => c.telephone,
    },
    triParDefaut: { colonne: 'nom', sens: 'asc' },
  }), []));
  const filtered = outilsContacts.lignesAffichees;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, color: COLORS.inkSoft, padding: SPACE.huge }}>
      <Loader2 size={18} className="spin" /> {tr("contacts.loading", { typePlural: L.pl })}
    </div>
  );

  // Reproduit la structure de la fiche contact d'un ERP de référence (structure des vues contact,
  // voir project_erp_contact_architecture) :
  // avatar + bascule Particulier/Société + gros nom + email/téléphone à icônes en
  // en-tête, puis un groupe deux colonnes (société+adresse à gauche, détails+tags à
  // droite). L'adresse reprend les proportions CSS exactes mesurées côté ERP de référence
  // (.o_address_format : ville 38% / région 33% / code postal 25%).
  const renderFields = (f, setF, excludeCompanyId) => {
    const companies = contacts.filter(c => c.isCompany && c.id !== excludeCompanyId);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
        <div style={{ display: 'flex', gap: SPACE.lg, flexDirection: etroitContacts ? 'column' : 'row' }}>
          <ContactAvatar photo={f.photo} nom={f.nom} prenom={f.prenom} isCompany={f.isCompany} onChange={photo => setF({ ...f, photo })} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: SPACE.lg }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs, fontSize: TEXT.base, color: COLORS.inkSoft, cursor: 'pointer' }}>
                <input type="radio" checked={!f.isCompany} onChange={() => setF({ ...f, isCompany: false })} /> <UserIcon size={13} /> {tr("contacts.particulier")}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs, fontSize: TEXT.base, color: COLORS.inkSoft, cursor: 'pointer' }}>
                <input type="radio" checked={f.isCompany} onChange={() => setF({ ...f, isCompany: true })} /> <Building2 size={13} /> {tr("contacts.societe")}
              </label>
            </div>
            <div style={{ display: 'flex', gap: SPACE.sm }}>
              <input
                placeholder={f.isCompany ? tr("contacts.companyNamePlaceholder") : L.nomPh}
                value={f.nom} onChange={e => setF({ ...f, nom: e.target.value })} required
                style={{ fontSize: TEXT.xl, fontWeight: 700, border: 'none', borderBottom: `1px solid ${COLORS.border}`, outline: 'none', background: 'transparent', color: COLORS.ink, padding: '4px 2px', flex: 1, minWidth: 0 }}
              />
              {!f.isCompany && (
                <input
                  placeholder={L.prenomPh} value={f.prenom} onChange={e => setF({ ...f, prenom: e.target.value })}
                  style={{ fontSize: TEXT.xl, fontWeight: 700, border: 'none', borderBottom: `1px solid ${COLORS.border}`, outline: 'none', background: 'transparent', color: COLORS.ink, padding: '4px 2px', flex: 1, minWidth: 0 }}
                />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
              <Mail size={14} color={COLORS.blue} />
              <input type="email" placeholder={tr("contacts.emailPlaceholder")} value={f.email} onChange={e => setF({ ...f, email: e.target.value })}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: TEXT.base, color: COLORS.ink, borderBottom: `1px solid ${COLORS.border}`, padding: '3px 2px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
              <PhoneIcon size={14} color={COLORS.blue} />
              <input placeholder={tr("contacts.telephonePlaceholder")} value={f.telephone} onChange={e => setF({ ...f, telephone: e.target.value })}
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: TEXT.base, color: COLORS.ink, borderBottom: `1px solid ${COLORS.border}`, padding: '3px 2px' }} />
            </div>
          </div>
        </div>

        {/* Groupe étiquette/valeur façon ERP (un groupe étiquette/valeur de référence) : plus de champ encadré
            individuellement — juste une bordure discrète au survol/focus (classe
            .flat-input, voir App.css) et une étiquette à gauche sur la même ligne
            que la valeur, comme dans la fiche contact d'un ERP de référence. */}
        <div style={{ display: 'grid', gridTemplateColumns: etroitContacts ? '1fr' : '1fr 1fr', gap: SPACE.xxl }}>
          <div className="field-group">
            {!f.isCompany && (
              <>
                <div className="field-group-label">{tr("contacts.labelSociete")}</div>
                <select className="flat-input" value={f.parentId ?? ''} onChange={e => setF({ ...f, parentId: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">{tr("contacts.aucune")}</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </>
            )}
            <div className="field-group-label">{tr("contacts.labelAdresse")}</div>
            <div>
              <input className="flat-input" placeholder={tr("contacts.rue")} value={f.adresseRue} onChange={e => setF({ ...f, adresseRue: e.target.value })} />
              <input className="flat-input" placeholder={tr("contacts.rue2")} value={f.adresseRue2} onChange={e => setF({ ...f, adresseRue2: e.target.value })} />
              <div style={{ display: 'flex' }}>
                <input className="flat-input" style={{ flex: '0 0 38%' }} placeholder={tr("contacts.ville")} value={f.adresseVille} onChange={e => setF({ ...f, adresseVille: e.target.value })} />
                <input className="flat-input" style={{ flex: '0 0 33%' }} placeholder={tr("contacts.region")} value={f.adresseRegion} onChange={e => setF({ ...f, adresseRegion: e.target.value })} />
                <input className="flat-input" style={{ flex: '0 0 25%' }} placeholder={tr("contacts.codePostal")} value={f.adresseCodePostal} onChange={e => setF({ ...f, adresseCodePostal: e.target.value })} />
              </div>
              <input className="flat-input" placeholder={tr("contacts.pays")} value={f.adressePays} onChange={e => setF({ ...f, adressePays: e.target.value })} />
            </div>
            <div className="field-group-label">{tr("contacts.labelAutreAdresse")}</div>
            <input className="flat-input" placeholder={tr("contacts.adresseLibre")} value={f.adresse} onChange={e => setF({ ...f, adresse: e.target.value })} />
          </div>
          <div className="field-group">
            {!f.isCompany && (
              <>
                <div className="field-group-label">{tr("contacts.labelFonction")}</div>
                <input className="flat-input" placeholder={tr("contacts.fonctionPlaceholder")} value={f.fonction} onChange={e => setF({ ...f, fonction: e.target.value })} />
              </>
            )}
            <div className="field-group-label">{tr("contacts.labelSiret")}</div>
            <input className="flat-input" placeholder={tr("contacts.siretPlaceholder")} value={f.siret} onChange={e => setF({ ...f, siret: e.target.value })} />
            {type === 'client' && (
              <>
                <div className="field-group-label">{tr("contacts.labelListePrix")}</div>
                <select className="flat-input" value={f.listePrixId ?? ''} onChange={e => setF({ ...f, listePrixId: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">{tr("contacts.aucune")}</option>
                  {listesPrix.map(l => <option key={l.id} value={l.id}>{l.nom}</option>)}
                </select>
                <div className="field-group-label">{tr("contacts.labelDeviseFacturation")}</div>
                <select className="flat-input" value={f.deviseFacturation ?? ''} onChange={e => setF({ ...f, deviseFacturation: e.target.value === '' ? null : e.target.value })}>
                  <option value="">{tr("contacts.deviseFacturationEntreprise")}</option>
                  {DEVISES.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
                </select>
              </>
            )}
            <div className="field-group-label">{tr("contacts.labelTags")}</div>
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
                {contactTags.map(t => {
                  const active = f.tagIds.includes(t.id);
                  return (
                    <button key={t.id} type="button"
                      onClick={() => setF({ ...f, tagIds: active ? f.tagIds.filter(id => id !== t.id) : [...f.tagIds, t.id] })}
                      style={{ background: active ? t.couleur : 'transparent', color: active ? '#fff' : t.couleur, border: `1px solid ${t.couleur}`, borderRadius: RADIUS.pill, padding: '3px 10px', fontSize: TEXT.sm, cursor: 'pointer' }}
                    >
                      {t.nom}
                    </button>
                  );
                })}
                {contactTags.length === 0 && <span style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{tr("contacts.noTagAvailable")}</span>}
              </div>
              <ContactTagsManager tags={contactTags} onChange={loadTags} />
            </div>
            <div />
            <label style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, fontSize: TEXT.base, color: COLORS.inkSoft }}>
              <input type="checkbox" checked={f.estAutre} onChange={e => setF({ ...f, estAutre: e.target.checked })} />
              {tr("contacts.estAussi", { autre: L.autre })}
            </label>
          </div>
        </div>

        <div className="field-group">
          <div className="field-group-label">{tr("contacts.labelNotes")}</div>
          <textarea className="flat-input" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder={tr("contacts.notesPlaceholder")} rows={2} style={{ resize: 'vertical' }} />
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
      {apiError && (
        <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '11px 16px', fontSize: TEXT.base, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <AlertTriangle size={15} /> {apiError}
          <button onClick={() => setApiError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: COLORS.red, cursor: 'pointer', fontWeight: 700 }}>x</button>
        </div>
      )}
      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
          {tr("contacts.addTitle", { type: L.s })}
        </div>
        <form onSubmit={submitForm} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          {renderFields(form, setForm, null)}
          <div style={{ display: 'flex', gap: SPACE.sm }}>
            <Button type="submit" variant={type === 'client' ? 'green' : 'ochre'} disabled={saving}>
              {saving ? <Loader2 size={14} className="spin" /> : <Plus size={15} />} {tr("common.add")}
            </Button>
          </div>
        </form>
      </Card>
      {type === 'client' && <ListesPrixManager />}
      <BarreOutilsListe etat={outilsContacts} placeholderRecherche={tr("contacts.searchPlaceholder", { type: L.s })} />
      {filtered.length === 0 ? (
        <Card><div style={{ color: COLORS.inkSoft, fontSize: TEXT.base }}>{tr("contacts.noneFound", { type: L.s })}</div></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: etroitContacts ? '1fr' : '1.1fr 0.9fr', gap: SPACE.lg, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            {filtered.map(contact => (
              <Card
                key={contact.id}
                style={{ border: selectedContact && selectedContact.id === contact.id ? `2px solid ${cfg.accent}` : `1px solid ${COLORS.border}`, cursor: 'pointer', padding: '14px 16px' }}
                onClick={() => setSelectedId(contact.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                    <ContactAvatar photo={contact.photo} nom={contact.nom} prenom={contact.prenom} isCompany={contact.isCompany} size={36} />
                    <div>
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                        {contact.isCompany ? contact.nom : `${contact.prenom || ''} ${contact.nom}`}
                        {contact.isCompany && <Building2 size={12} color={COLORS.inkSoft} />}
                      </div>
                      <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>
                        {contact.fonction ? `${contact.fonction} · ` : ''}{contact.telephone || tr('contacts.noTelephone')}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: SPACE.sm }}>
                    <button onClick={(ev) => { ev.stopPropagation(); startEdit(contact); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.blue }}>
                      <Settings2 size={14} />
                    </button>
                    <button onClick={(ev) => { ev.stopPropagation(); removeContact(contact.id, contact.nom); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, marginTop: SPACE.sm }}>{contact.adresse || tr("contacts.noAdresse")}</div>
                {contact.tags && contact.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.sm }}>
                    {contact.tags.map(t => (
                      <span key={t.id} style={{ background: t.couleur + '22', color: t.couleur, borderRadius: RADIUS.pill, padding: '2px 7px', fontSize: TEXT.xs }}>{t.nom}</span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
          {selectedContact && (
            <Card style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
                <ContactAvatar photo={selectedContact.photo} nom={selectedContact.nom} prenom={selectedContact.prenom} isCompany={selectedContact.isCompany} size={56} />
                <div>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                    {selectedContact.isCompany ? selectedContact.nom : `${selectedContact.prenom || ''} ${selectedContact.nom}`}
                    {selectedContact.isCompany && <Building2 size={14} color={COLORS.inkSoft} />}
                  </div>
                  {selectedContact.fonction && <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{selectedContact.fonction}{selectedContact.parentNom ? ` · ${selectedContact.parentNom}` : ''}</div>}
                  {!selectedContact.fonction && selectedContact.parentNom && <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{selectedContact.parentNom}</div>}
                </div>
              </div>
              {selectedContact.tags && selectedContact.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>
                  {selectedContact.tags.map(t => (
                    <span key={t.id} style={{ background: t.couleur + '22', color: t.couleur, borderRadius: RADIUS.pill, padding: '2px 8px', fontSize: TEXT.xs }}>{t.nom}</span>
                  ))}
                </div>
              )}
              <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
                <span>{tr("contacts.detailTel", { value: selectedContact.telephone || tr("contacts.nonRenseigne") })}</span>
                <span>{tr("contacts.detailEmail", { value: selectedContact.email || tr("contacts.nonRenseigne") })}</span>
                <span>{tr("contacts.detailAdresse", { value: selectedContact.adresse || tr("contacts.nonRenseignee") })}</span>
                {selectedContact.siret && <span>{tr("contacts.detailSiret", { value: selectedContact.siret })}</span>}
                {selectedContact[autreFlagKey] && <span style={{ color: cfg.accent, fontWeight: 600 }}>{tr("contacts.estAussi", { autre: L.autre })}</span>}
                {type === 'client' && (
                  <span>{tr("contacts.detailListePrix", { value: listesPrix.find(l => l.id === selectedContact.listePrixId)?.nom || tr("contacts.aucune") })}</span>
                )}
                {type === 'client' && selectedContact.deviseFacturation && (
                  <span>{tr("contacts.detailDeviseFacturation", { value: selectedContact.deviseFacturation })}</span>
                )}
                <span style={{ fontSize: TEXT.xs, color: COLORS.border }}>{tr("contacts.detailId", { value: selectedContact.id })}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: etroitContacts ? '1fr' : 'repeat(2, 1fr)', gap: SPACE.sm }}>
                <Card style={{ background: COLORS.greenSoft, border: 'none' }}>
                  <div style={{ fontSize: TEXT.sm, color: COLORS.green, fontWeight: 600 }}>{tr("contacts.enregistreLe")}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.base, fontWeight: 700, color: COLORS.green }}>
                    {selectedContact.createdAt ? fmtDate(selectedContact.createdAt) : '-'}
                  </div>
                </Card>
                <Card style={{ background: COLORS.blueSoft, border: 'none' }}>
                  <div style={{ fontSize: TEXT.sm, color: COLORS.blue, fontWeight: 600 }}>{tr("contacts.totalLabel", { typePlural: L.pl })}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.lg, fontWeight: 700, color: COLORS.blue }}>{contacts.length}</div>
                </Card>
              </div>
              <div>
                <button
                  onClick={() => setRelatedOpen(o => !o)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: SPACE.sm, background: COLORS.ochreSoft, color: COLORS.ochre,
                    border: 'none', borderRadius: RADIUS.pill, padding: '6px 12px', fontSize: TEXT.sm, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {type === 'client' ? tr('contacts.relatedDevis') : tr('contacts.relatedAchats')} ({relatedLoading ? '…' : relatedList.length})
                  <ChevronRight size={14} style={{ transform: relatedOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }} />
                </button>
                {relatedOpen && (
                  <div style={{ marginTop: SPACE.sm, display: 'flex', flexDirection: 'column', gap: SPACE.sm, maxHeight: 220, overflowY: 'auto' }}>
                    {relatedList.length === 0 && !relatedLoading && (
                      <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{type === 'client' ? tr('contacts.noRelatedDevis') : tr('contacts.noRelatedAchats')}</div>
                    )}
                    {type === 'client' && relatedList.map(d => (
                      <div key={d.id} style={{ fontSize: TEXT.sm, display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: COLORS.bg, borderRadius: RADIUS.card }}>
                        <span>{d.numero} — {tr(`devis.statut.${d.statut}`, { defaultValue: d.statut })}</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmtMoney(d.total)}</span>
                      </div>
                    ))}
                    {type === 'fournisseur' && relatedList.map(a => (
                      <div key={a.id} style={{ fontSize: TEXT.sm, display: 'flex', justifyContent: 'space-between', padding: '6px 8px', background: COLORS.bg, borderRadius: RADIUS.card }}>
                        <span>{a.module} — {fmtDate(a.date)} ({tr(`achats.statut.${a.statut}`, { defaultValue: a.statut })})</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{fmtMoney(a.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: SPACE.sm }}>
                <ActivitesSection ressourceType="contact" ressourceId={selectedContact.id} />
              </div>
            </Card>
          )}
        </div>
      )}
      {editingId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={cancelEdit}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: RADIUS.card, width: '90%', maxWidth: 800, maxHeight: '90vh', overflowY: 'auto', padding: SPACE.xl }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACE.lg }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md }}>{tr("contacts.editTitle", { type: L.s })}</div>
              <button onClick={cancelEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, fontSize: TEXT.lg }}>×</button>
            </div>
            <form onSubmit={submitEditForm} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
              {renderFields(editForm, setEditForm, editingId)}
              <div style={{ display: 'flex', gap: SPACE.sm }}>
                <Button type="submit" variant="green" disabled={editSaving}>
                  {editSaving ? <Loader2 size={14} className="spin" /> : <Check size={15} />} {tr("common.save")}
                </Button>
                <Button type="button" variant="ghost" onClick={cancelEdit}>{tr("common.cancel")}</Button>
              </div>
            </form>

            {/* Sous-contacts (page "Contacts" de la fiche d'un ERP de référence) — uniquement pour une
                Société déjà enregistrée : une nouvelle fiche n'a pas encore d'id auquel
                rattacher qui que ce soit. */}
            {editForm.isCompany && (
              <div style={{ marginTop: SPACE.lg, borderTop: `1px solid ${COLORS.border}`, paddingTop: SPACE.md }}>
                <div style={{ fontWeight: 600, fontSize: TEXT.base, marginBottom: SPACE.sm }}>{tr("contacts.subContactsTitle")}</div>
                <form onSubmit={submitSubContact} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: SPACE.xs, alignItems: 'end', marginBottom: SPACE.md }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: TEXT.sm, color: COLORS.inkSoft }}>{tr("contacts.subNom")}
                    <input className="flat-input" value={subForm.nom} onChange={e => setSubForm({ ...subForm, nom: e.target.value })} required />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: TEXT.sm, color: COLORS.inkSoft }}>{tr("contacts.subPrenom")}
                    <input className="flat-input" value={subForm.prenom} onChange={e => setSubForm({ ...subForm, prenom: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: TEXT.sm, color: COLORS.inkSoft }}>{tr("contacts.subFonction")}
                    <input className="flat-input" value={subForm.fonction} onChange={e => setSubForm({ ...subForm, fonction: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: TEXT.sm, color: COLORS.inkSoft }}>{tr("contacts.subTelephone")}
                    <input className="flat-input" value={subForm.telephone} onChange={e => setSubForm({ ...subForm, telephone: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: TEXT.sm, color: COLORS.inkSoft }}>{tr("contacts.subEmail")}
                    <input className="flat-input" type="email" value={subForm.email} onChange={e => setSubForm({ ...subForm, email: e.target.value })} />
                  </label>
                  <Button small type="submit" variant="outline" disabled={subSaving}>
                    {subSaving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} {tr("common.add")}
                  </Button>
                </form>
                {subContactsLoading ? (
                  <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, display: 'flex', alignItems: 'center', gap: SPACE.sm }}><Loader2 size={13} className="spin" /> {tr("common.loading")}</div>
                ) : subContacts.length === 0 ? (
                  <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{tr("contacts.noSubContact")}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
                    {subContacts.map(sc => (
                      <div key={sc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                          <ContactAvatar photo={sc.photo} nom={sc.nom} prenom={sc.prenom} isCompany={false} size={28} />
                          <div>
                            <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>{sc.prenom} {sc.nom}</div>
                            <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft }}>{sc.fonction || ''}{sc.fonction && (sc.telephone || sc.email) ? ' · ' : ''}{sc.telephone || sc.email || ''}</div>
                          </div>
                        </div>
                        <button onClick={() => removeSubContact(sc.id, sc.nom)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Les 3 modules « activités agricoles » sont facturés à l'unité (voir
// server/src/utils/tarificationModules.js:MODULES_TARIFES, même liste) ; les 5 autres restent
// inclus gratuitement dès qu'un module facturé est actif — décision explicite de l'utilisateur.
const MODULES_TARIFES_FRONT = ['cultures', 'poulailler', 'pisciculture'];

function ModulesScreen({ activated, onToggle, onContinue }) {
  const { t } = useTranslation();
  const { fmtMoney } = useLocale();
  const anyActive = activated.cultures || activated.poulailler || activated.clients;
  const feats = (k) => t(`modulesScreen.${k}.features`, { returnObjects: true });
  const [tarifs, setTarifs] = useState(null);
  useEffect(() => { getTarifsModules().then(setTarifs).catch(() => {}); }, []);

  const prixModule = (key) => {
    if (!MODULES_TARIFES_FRONT.includes(key)) return t('modulesScreen.included');
    if (!tarifs) return t('common.loading');
    return t('modulesScreen.pricePerMonth', { amount: fmtMoney(tarifs.prixParModule.montant) });
  };

  const MODULES = [
    { key: 'cultures', icon: Leaf, accent: 'green' },
    { key: 'poulailler', icon: Bird, accent: 'ochre' },
    { key: 'pisciculture', icon: Fish, accent: 'blue' },
    { key: 'clients', icon: Users, accent: 'blue' },
    { key: 'employees', icon: Briefcase, accent: 'ochre' },
    { key: 'fournisseurs', icon: Truck, accent: 'ochre' },
    { key: 'finances', icon: Landmark, accent: 'blue' },
    { key: 'notifications', icon: Bell, accent: 'red' },
  ];
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '36px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: SPACE.xxl }}>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: TEXT.title, marginBottom: SPACE.sm }}>{t('modulesScreen.title')}</div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>{t('modulesScreen.subtitle')}</div>
        {tarifs && (
          <div style={{ fontSize: TEXT.base, color: COLORS.green, marginTop: SPACE.sm, fontWeight: 600 }}>
            {t('modulesScreen.bundleHint', { amount: fmtMoney(tarifs.prixBundle.montant) })}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: SPACE.lg }}>
        {MODULES.map(m => (
          <OptionCard
            key={m.key}
            icon={m.icon} accent={m.accent} active={activated[m.key]}
            title={t(`modulesScreen.${m.key}.title`)}
            description={t(`modulesScreen.${m.key}.desc`)}
            features={feats(m.key)}
            price={prixModule(m.key)}
            onToggle={() => onToggle(m.key)}
          />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: SPACE.xxl }}>
        <Button variant="default" disabled={!anyActive} onClick={onContinue} style={{ padding: '11px 22px' }}>
          {t('modulesScreen.continue')} <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}

// Navigation de premier niveau — remplace l'ancienne sidebar gauche persistante par le vrai
// modèle Odoo (voir docs/journal.md, refonte navigation) : barre du haut fixe (46px, radius 0,
// pas d'ombre) + un Dropdown par NAV_CATEGORIES (1er clic ouvre, survoler un autre déclencheur
// pendant qu'un dropdown est ouvert bascule directement dessus, aucune animation d'ouverture —
// mêmes comportements que dropdown.js d'un ERP de référence), items épinglés (category: null)
// en liens directs sans dropdown. Couleurs de l'app conservées (vert de marque au lieu du
// violet Odoo) — seule la structure est reprise à l'identique.
function TopNavbar({
  tabs, activeTab, onSelect, screen, user, roleLabel, showManageOptions,
  onManageOptions, onSearch, onLogout, isOnline, pendingSyncCount, lastSync,
}) {
  const { t } = useTranslation();
  const { fmtDate } = useLocale();
  const [openCategory, setOpenCategory] = useState(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef(null);

  const pinned = tabs.filter(tb => !tb.category);
  const categories = NAV_CATEGORIES
    .map(cat => ({ ...cat, items: tabs.filter(tb => tb.category === cat.id) }))
    .filter(cat => cat.items.length > 0);

  useEffect(() => {
    if (!openCategory && !avatarOpen) return;
    const onDocClick = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) { setOpenCategory(null); setAvatarOpen(false); }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openCategory, avatarOpen]);

  const activeCategory = categories.find(cat => cat.items.some(it => it.id === activeTab));
  const activeTabObj = tabs.find(tb => tb.id === activeTab);

  const navBtnStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: SPACE.sm, height: 46, padding: '0 .63em',
    background: active ? 'rgba(255,255,255,.18)' : 'transparent', border: 'none', borderRadius: 0,
    color: '#fff', fontSize: TEXT.base, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
  });

  const navUserMenuItemStyle = {
    display: 'block', width: '100%', textAlign: 'left', padding: '7px 16px', border: 'none',
    background: 'transparent', cursor: 'pointer', fontSize: TEXT.base, color: COLORS.ink, whiteSpace: 'nowrap',
  };

  return (
    <>
      <div ref={navRef} style={{ display: 'flex', alignItems: 'center', height: 46, padding: '0 16px', background: COLORS.green, borderBottom: `1px solid ${NAVBAR_BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, paddingRight: SPACE.md, flexShrink: 0 }}>
          <div style={{ width: 26, height: 26, borderRadius: RADIUS.control, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sprout size={15} color="#fff" />
          </div>
          <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: TEXT.md, color: '#fff', whiteSpace: 'nowrap' }}>{t('auth.brand')}</span>
        </div>

        {screen === 'dashboard' && (
          <button className="navbar-burger" onClick={() => setMobileOpen(true)} style={navBtnStyle(false)}>
            <Menu size={18} />
          </button>
        )}

        <div className="navbar-entries" style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          {screen === 'dashboard' && pinned.map(tb => {
            const Icon = tb.icon;
            return (
              <button key={tb.id} onClick={() => onSelect(tb.id)} style={navBtnStyle(activeTab === tb.id)}>
                <Icon size={14} /> {tb.label}
              </button>
            );
          })}
          {screen === 'dashboard' && categories.map(cat => (
            <div key={cat.id} style={{ position: 'relative', flexShrink: 0 }}
              onMouseEnter={() => { if (openCategory && openCategory !== cat.id) setOpenCategory(cat.id); }}>
              <button onClick={() => setOpenCategory(o => (o === cat.id ? null : cat.id))} style={navBtnStyle(activeCategory?.id === cat.id)}>
                {t(cat.labelKey)} <ChevronRight size={12} style={{ transform: openCategory === cat.id ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s ease' }} />
              </button>
              {openCategory === cat.id && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, background: COLORS.surface, borderRadius: RADIUS.control,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: `1px solid ${COLORS.border}`,
                  zIndex: 30, minWidth: 200, overflow: 'hidden', padding: '4px 0',
                }}>
                  {cat.items.map(it => {
                    const Icon = it.icon;
                    const active = activeTab === it.id;
                    return (
                      <button
                        key={it.id}
                        onClick={() => { onSelect(it.id); setOpenCategory(null); }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(0,0,0,.08)'; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: SPACE.sm, width: '100%', textAlign: 'left',
                          padding: '3px 20px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: TEXT.base,
                          background: active ? COLORS.greenSoft : 'transparent',
                          color: active ? COLORS.green : COLORS.ink, fontWeight: active ? 700 : 500,
                        }}
                      >
                        <Icon size={14} /> {it.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="navbar-actions-desktop" style={{ position: 'relative', flexShrink: 0, paddingLeft: SPACE.sm }}>
          <button
            onClick={() => setAvatarOpen(o => !o)}
            title={t('shell.userMenu')}
            style={{
              width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,.22)',
              border: 'none', cursor: 'pointer', color: '#fff', fontSize: TEXT.base, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {(user || '?').charAt(0).toUpperCase()}
          </button>
          {avatarOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: SPACE.sm, background: COLORS.surface, borderRadius: RADIUS.control,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)', border: `1px solid ${COLORS.border}`,
              zIndex: 30, minWidth: 220, overflow: 'hidden',
            }}>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: TEXT.base, fontWeight: 600, color: COLORS.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user}</div>
                <div style={{ fontSize: TEXT.xs, color: COLORS.inkSoft, marginTop: 2 }}>{roleLabel}</div>
              </div>
              <div style={{ padding: '4px 0' }}>
                {screen === 'dashboard' && showManageOptions && (
                  <button onClick={() => { setAvatarOpen(false); onManageOptions(); }} className="navbar-user-menu-item" style={navUserMenuItemStyle}>
                    {t('shell.manageOptions')}
                  </button>
                )}
                {screen === 'dashboard' && (
                  <button onClick={() => { setAvatarOpen(false); onSearch(); }} className="navbar-user-menu-item" style={navUserMenuItemStyle}>
                    {t('shell.globalSearch')}
                  </button>
                )}
                <button onClick={onLogout} className="navbar-user-menu-item" style={navUserMenuItemStyle}>
                  {t('shell.logout')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '8px 16px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap', background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, fontSize: TEXT.sm }}>
        <span style={{ color: COLORS.inkSoft }}>
          {activeCategory && <>{t(activeCategory.labelKey)}<span style={{ padding: '0 8px' }}>/</span></>}
          <strong style={{ color: COLORS.ink }}>{activeTabObj?.label}</strong>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <span style={{ padding: '6px 10px', borderRadius: RADIUS.pill, background: isOnline ? COLORS.greenSoft : COLORS.ochreSoft, color: isOnline ? COLORS.green : COLORS.ochre, fontWeight: 600 }}>
            {isOnline ? t('shell.online') : t('shell.offline')}
          </span>
          <span style={{ color: COLORS.inkSoft }}>
            {pendingSyncCount > 0
              ? t('shell.pendingSync', { count: pendingSyncCount })
              : lastSync
                ? t('shell.lastSync', { date: fmtDate(lastSync, { dateStyle: 'short', timeStyle: 'short' }) })
                : t('shell.noSync')}
          </span>
        </span>
      </div>

      {mobileOpen && (
        <MobileNavPanel
          pinned={pinned} categories={categories} activeTab={activeTab} user={user} roleLabel={roleLabel}
          onSelect={(id) => { onSelect(id); setMobileOpen(false); }} onLogout={onLogout} onClose={() => setMobileOpen(false)}
        />
      )}
    </>
  );
}

// Panneau glissant mobile (< 760px) — remplace la sidebar desktop dans ce cas de figure,
// mêmes valeurs qu'un ERP de référence pour son propre panneau mobile équivalent :
// width: min(360px, 80vw), transform translateX, transition .2s ease.
function MobileNavPanel({ pinned, categories, activeTab, user, roleLabel, onSelect, onLogout, onClose }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState({});
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 200); };

  const itemStyle = (active, indent) => ({
    display: 'flex', alignItems: 'center', gap: SPACE.sm, width: '100%',
    padding: `7px 10px 7px ${indent}px`, borderRadius: RADIUS.control,
    fontSize: TEXT.base, fontWeight: active ? 700 : 500, textAlign: 'left',
    border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
    background: active ? COLORS.greenSoft : 'transparent',
    color: active ? COLORS.green : COLORS.inkSoft,
  });

  return (
    <>
      <div onClick={handleClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 40 }} />
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(360px, 80vw)', background: COLORS.surface,
        zIndex: 41, boxShadow: '2px 0 16px rgba(0,0,0,.15)', overflowY: 'auto', padding: '16px 10px',
        display: 'flex', flexDirection: 'column', gap: 2,
        transform: visible ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .2s ease',
      }}>
        <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, marginBottom: SPACE.sm, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
          <X size={16} /> {t('common.close')}
        </button>
        {pinned.map(tb => {
          const Icon = tb.icon;
          const active = activeTab === tb.id;
          return (
            <button key={tb.id} onClick={() => onSelect(tb.id)} style={itemStyle(active, 10)}>
              <Icon size={15} /> {tb.label}
            </button>
          );
        })}
        {categories.map(cat => {
          const isCollapsed = !!collapsed[cat.id];
          return (
            <div key={cat.id} style={{ marginTop: SPACE.xs }}>
              <button onClick={() => setCollapsed(c => ({ ...c, [cat.id]: !c[cat.id] }))} style={{
                display: 'flex', alignItems: 'center', gap: SPACE.sm, width: '100%', background: 'none', border: 'none',
                padding: '6px 10px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 2.5, background: cat.color, flexShrink: 0 }} />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: TEXT.xs, letterSpacing: '0.07em', textTransform: 'uppercase', color: COLORS.inkSoft, flex: 1 }}>
                  {t(cat.labelKey)}
                </span>
                <ChevronRight size={12} style={{ color: COLORS.inkSoft, transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 0.15s ease' }} />
              </button>
              {!isCollapsed && cat.items.map(tb => {
                const Icon = tb.icon;
                const active = activeTab === tb.id;
                return (
                  <button key={tb.id} onClick={() => onSelect(tb.id)} style={itemStyle(active, 26)}>
                    <Icon size={14} /> {tb.label}
                  </button>
                );
              })}
            </div>
          );
        })}
        <div style={{ marginTop: 'auto', paddingTop: SPACE.md, borderTop: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
          <span style={{ fontSize: TEXT.sm, color: COLORS.inkSoft }}>{user} — {roleLabel}</span>
          <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, background: 'none', border: 'none', cursor: 'pointer', color: COLORS.inkSoft, fontSize: TEXT.base, padding: '7px 10px' }}>
            <LogOut size={15} /> {t('shell.logout')}
          </button>
        </div>
      </div>
    </>
  );
}

// Route un nom d'écran interne vers un vrai chemin d'URL — Phase 1 du routage
// (voir la mémoire project_erp_ux_alignment) : seuls l'écran principal et
// l'onglet de premier niveau sont dans l'URL pour l'instant. Les sous-onglets
// (Cultures > Stocks) et la fiche sélectionnée (Clients/:id) restent en state
// local, pas encore dans l'URL — Phase 2 potentielle, pas ce chantier-ci.
function screenToPath(screenName, tabId) {
  switch (screenName) {
    case 'modules': return '/modules';
    case 'onboarding-choice': return '/onboarding-choice';
    case 'onboarding-banques': return '/onboarding-banques';
    case 'onboarding-salaries': return '/onboarding-salaries';
    case 'dashboard': return `/app/${tabId || 'accueil'}`;
    default: return '/login';
  }
}

function pathnameToScreen(pathname) {
  if (pathname.startsWith('/app')) return 'dashboard';
  if (pathname === '/modules') return 'modules';
  if (pathname === '/onboarding-choice') return 'onboarding-choice';
  if (pathname === '/onboarding-banques') return 'onboarding-banques';
  if (pathname === '/onboarding-salaries') return 'onboarding-salaries';
  return 'login';
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  // screen/tab dérivés de l'URL plutôt que stockés en state : navigate(...)
  // remplace tous les anciens setScreen/setTab de premier niveau — le bouton
  // retour du navigateur, le rechargement de page et les liens partagés
  // fonctionnent alors naturellement, sans logique supplémentaire à écrire.
  const screen = pathnameToScreen(location.pathname);
  const urlTab = location.pathname.startsWith('/app/') ? location.pathname.slice(5) : null;
  // Repli par URL du même mécanisme highlightContactId que la recherche globale — le
  // "smart button" Client de la popup de détail d'un devis (DevisModule, imbriqué sous
  // Ventes) n'a pas de moyen direct d'appeler setHighlightContactId (pas de contexte
  // partagé), donc il navigue vers /app/clients?highlight=<id> et ce repli prend le relais.
  const highlightFromUrl = (urlTab === 'clients' || urlTab === 'fournisseurs')
    ? Number(new URLSearchParams(location.search).get('highlight')) || null
    : null;
  const goToScreen = (screenName, tabId) => navigate(screenToPath(screenName, tabId));
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [user, setUser] = useState(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  // Abonnement Phase 1 (2026-09-04) : { status, mode, daysLeft, ... } | null tant que non
  // chargé. `mode` pilote l'affichage (trial/readonly/locked/active) — voir GET /billing/status.
  const [billing, setBilling] = useState(null);
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);
  const [activated, setActivated] = useState({ cultures: false, poulailler: false, pisciculture: false, clients: false, employees: false, finances: false, notifications: false, fournisseurs: false });
  const tab = screen === 'dashboard' ? (urlTab || 'accueil') : null;
  const [initLoaded, setInitLoaded] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? navigator.onLine : true);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [lastSync, setLastSync] = useState(typeof window !== 'undefined' ? localStorage.getItem('agri-last-sync') : null);

  // Recherche globale (Ctrl+K) — voir GlobalSearch.jsx. highlightContactId/
  // highlightProduit ne servent qu'à faire atterrir l'utilisateur sur le bon
  // élément après un clic sur un résultat ; ContactsTab/CulturesModule/
  // PoulaillerModule/StocksTab les consomment puis les oublient (pas d'état
  // persistant au-delà de la navigation qui suit le clic).
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightContactId, setHighlightContactId] = useState(null);
  const [highlightProduit, setHighlightProduit] = useState(null);

  useEffect(() => {
    if (screen !== 'dashboard') return;
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screen]);

  const handleSearchSelect = ({ kind, item }) => {
    setSearchOpen(false);
    if (kind === 'contact') {
      navigate(`/app/${item.estClient ? 'clients' : 'fournisseurs'}`);
      setHighlightContactId(item.id);
    } else if (kind === 'produit') {
      const ongletParModule = { Cultures: 'cultures', Poulailler: 'poulailler', Pisciculture: 'pisciculture' };
      navigate(`/app/${ongletParModule[item.module] || 'cultures'}`);
      setHighlightProduit({ module: item.module, id: item.id });
    } else if (kind === 'devis') {
      // Un devis n'a pas d'écran dédié (voir DevisModule, imbriqué dans les
      // onglets Ventes de Cultures/Poulailler, sans notion de module propre) —
      // on atterrit sur le contact client associé plutôt que de dupliquer la
      // logique de sous-onglet/modale de VentesWithDevis pour ce premier passage.
      if (item.clientId) {
        navigate('/app/clients');
        setHighlightContactId(item.clientId);
      }
    }
  };

  useEffect(() => {
    (async () => {
      const saved = await storageGet('agriconnect-modules', { cultures: false, poulailler: false, pisciculture: false, clients: false, employees: false, finances: false, notifications: false, fournisseurs: false });
      setActivated(saved);
      setInitLoaded(true);
    })();
  }, []);

  useEffect(() => {
    const updateStatus = async () => {
      const online = typeof window !== 'undefined' ? navigator.onLine : true;
      setIsOnline(online);
      const queue = JSON.parse(localStorage.getItem('agri-offline-queue') || '[]');
      setPendingSyncCount(queue.length);
      setLastSync(localStorage.getItem('agri-last-sync'));
      if (online && queue.length > 0) {
        const result = await syncPendingChanges();
        setPendingSyncCount(result.pending ?? 0);
        setLastSync(localStorage.getItem('agri-last-sync'));
      }
    };

    const handleAuthExpired = () => {
      clearToken();
      navigate('/login');
      setUser(null);
    };

    // Abonnement Phase 1 : n'importe quel appel API bloqué par subscriptionGuard (402) émet
    // cet événement (voir lib/api.js) — on rafraîchit l'état complet (daysLeft inclus) plutôt
    // que de se contenter du { reason, mode } du detail, qui ne porte pas tout.
    const handleSubscriptionBlocked = () => {
      getBillingStatus().then(setBilling).catch(() => {});
    };

    updateStatus();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    window.addEventListener('agri-sync-status-changed', updateStatus);
    window.addEventListener('agri-auth-expired', handleAuthExpired);
    window.addEventListener('agri-subscription-blocked', handleSubscriptionBlocked);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
      window.removeEventListener('agri-sync-status-changed', updateStatus);
      window.removeEventListener('agri-auth-expired', handleAuthExpired);
      window.removeEventListener('agri-subscription-blocked', handleSubscriptionBlocked);
    };
  }, []);

  // Rafraîchit l'état d'abonnement après connexion/inscription et au montage (token existant) —
  // n'importe quel rôle peut le lire, la route est whitelistée par subscriptionGuard.
  const refreshBillingStatus = async () => {
    try {
      setBilling(await getBillingStatus());
    } catch (err) {
      console.error('[refreshBillingStatus]', err);
    }
  };

  // Seul le propriétaire du compte voit l'assistant "Configurer votre entreprise" (avant le
  // 2026-11-11 : les rôles texte admin/directeur — or tout compte récent porte le texte « admin »,
  // l'assistant s'ouvrait donc chez chaque salarié). L'état vient du serveur (pas de
  // localStorage) car c'est un fait qui appartient à l'entreprise, pas au navigateur.
  const checkOnboardingNeeded = async (estProprietaire) => {
    if (!estProprietaire) {
      setIsOnboarding(false);
      return;
    }
    try {
      const { banqueOk, salarieOk } = await getOnboardingStatus();
      setIsOnboarding(!(banqueOk && salarieOk));
    } catch (err) {
      console.error('[checkOnboardingNeeded]', err);
      setIsOnboarding(false);
    }
  };

  const { t } = useTranslation();
  const { setLocaleConfig } = useLocale();

  // Applique la devise + la locale de l'entreprise (formatage des montants/dates), et —
  // seulement si l'utilisateur n'a jamais choisi de langue explicitement — aligne la
  // langue de l'UI sur celle de la locale entreprise ('es-ES' -> 'es', etc.).
  const applyEntrepriseLocale = (entreprise) => {
    if (!entreprise) return;
    setLocaleConfig({ devise: entreprise.devise, locale: entreprise.locale, fuseau: entreprise.fuseau });
    if (!hasExplicitLanguage() && entreprise.locale) {
      const lang = String(entreprise.locale).split('-')[0];
      if (SUPPORTED_LANGS.some(l => l.code === lang)) setLanguage(lang, false);
    }
  };

  // Partagé entre une connexion normale et la fin du parcours de confirmation
  // d'inscription (voir handleConfirmerInscription) — les deux aboutissent au même état
  // "connecté".
  // Modules activés : le serveur (entreprises.modules_actifs, 2026-09-06) fait désormais foi
  // — le localStorage chargé au tout premier rendu n'est qu'un affichage immédiat le temps que
  // cet appel réponde. Appelée après CHAQUE authentification réussie (login, confirmation
  // d'inscription) et à la restauration de session sur rechargement — sans ça, un login
  // classique garde l'état localStorage périmé jusqu'au prochain rechargement de page.
  // Best-effort : une erreur ici ne doit jamais bloquer la connexion.
  const refreshModulesActifs = async () => {
    try {
      const { modules } = await getModulesActifs();
      const complet = { cultures: false, poulailler: false, pisciculture: false, clients: false, employees: false, finances: false, notifications: false, fournisseurs: false, ...modules };
      setActivated(complet);
      storageSet('agriconnect-modules', complet);
    } catch (err) {
      console.error('[modules_actifs]', err);
    }
  };

  // Restrictions du rôle d'entreprise de l'utilisateur connecté (GET /api/roles/mes-restrictions).
  // Depuis le 2026-11-11, c'est la SEULE source des droits côté interface (le rôle texte du
  // jeton n'est plus lu) : onglets visibles, boutons de gestion, écran « Gérer les options »,
  // assistant de configuration. Pur confort d'affichage — le serveur refuse de toute façon.
  // Lues à la connexion et à la restauration de session, puis relues au retour sur l'onglet du
  // navigateur et dès qu'un appel est refusé pour restriction (le rôle a pu changer).
  const [mesRestrictions, setMesRestrictions] = useState(null);
  // Vrai dès la première tentative de lecture terminée (succès OU échec : un échec laisse tout
  // affiché, le serveur restant la barrière — on ne bloque jamais l'interface là-dessus).
  const [restrictionsPretes, setRestrictionsPretes] = useState(false);
  // Renvoie les restrictions lues (ou null en cas d'échec), pour que la connexion puisse décider
  // de l'écran d'arrivée sans attendre un nouveau rendu.
  const rafraichirRestrictions = useCallback(async () => {
    if (!getToken()) { setMesRestrictions(null); return null; }
    try {
      const lues = await getMesRestrictions();
      // Même contenu → même objet : sinon chaque relecture (retour sur l'onglet, 403) recréait
      // le vérificateur et relançait les chargements de tous les écrans qui en dépendent.
      setMesRestrictions(prec => (JSON.stringify(prec) === JSON.stringify(lues) ? prec : lues));
      return lues;
    } catch (err) {
      console.error('[mes-restrictions]', err);
      return null;
    } finally {
      setRestrictionsPretes(true);
    }
  }, []);
  useEffect(() => {
    // Déconnexion : on oublie les restrictions (le chargement, lui, est fait explicitement par
    // finalizeAuth et la restauration de session).
    if (!user) { setMesRestrictions(null); setRestrictionsPretes(false); }
  }, [user]);
  useEffect(() => {
    const relire = () => { if (getToken()) rafraichirRestrictions(); };
    window.addEventListener('agri-restrictions-changed', relire);
    window.addEventListener('focus', relire);
    return () => {
      window.removeEventListener('agri-restrictions-changed', relire);
      window.removeEventListener('focus', relire);
    };
  }, [rafraichirRestrictions]);
  const verificateurRestrictions = useMemo(() => creerVerificateur(mesRestrictions), [mesRestrictions]);
  // Basé sur le jeton et non sur `user` : à la restauration de session (rechargement de page),
  // `user` reste null le temps de GET /auth/me alors que l'écran demandé s'affiche déjà.
  const enAttenteRestrictions = Boolean(getToken()) && !restrictionsPretes;
  // Libellé affiché dans le menu utilisateur : le rôle DÉFINI PAR L'ENTREPRISE (et non plus
  // l'ancien rôle texte, « Administrateur » sur tous les comptes récents).
  const libelleRole = mesRestrictions?.proprietaire
    ? t('role.proprietaire')
    : (mesRestrictions?.roleNom || t('role.sansRole'));

  // « Gérer les options » (écran des modules) : ouvert à qui peut modifier les modules activés.
  const peutGererModules = (restrictions) => creerVerificateur(restrictions).peut('modules_actifs', 'modifier');

  const finalizeAuth = async (authResult) => {
    setToken(authResult.token);
    const restrictions = await rafraichirRestrictions();
    setUser(authResult.user.email);
    setIsPlatformAdmin(authResult.user.isPlatformAdmin === true);
    applyEntrepriseLocale(authResult.entreprise);
    refreshBillingStatus();
    await checkOnboardingNeeded(restrictions?.proprietaire === true);
    await refreshModulesActifs();
    goToScreen(peutGererModules(restrictions) ? 'modules' : 'dashboard');
    return authResult;
  };

  const handleAuth = async (mode, email, password, extra, mfaCode, confirmationCode) => {
  const authResult = mode === 'login'
    ? await login(email, password, mfaCode, confirmationCode)
    : await register(email, password, extra);

  if (authResult?.mfaRequired || authResult?.confirmationRequired) {
    // On ne connecte pas encore : LoginScreen affiche l'étape suivante (code MFA ou
    // code de confirmation d'inscription).
    return authResult;
  }

  return finalizeAuth(authResult);
};

  // Deuxième étape de l'inscription (voir routes/auth.js:confirmer-inscription) : le code
  // reçu par email active le compte et renvoie le même payload qu'un login réussi.
  const handleConfirmerInscription = async (email, code) => {
    const authResult = await confirmerInscription(email, code);
    return finalizeAuth(authResult);
  };

  const handleRenvoyerCodeInscription = async (email) => {
    return renvoyerCodeInscription(email);
  };

  const toggleModule = (key) => {
    setActivated(prev => {
      const next = { ...prev, [key]: !prev[key] };
      storageSet('agriconnect-modules', next);
      // Persistance serveur best-effort (tarification par module, 2026-09-06) : réservée
      // admin/directeur côté backend (requireRole) — un autre rôle voit son choix appliqué
      // localement pour la session en cours, mais il sera écrasé par l'état serveur à la
      // prochaine connexion (voir l'effet getModulesActifs au montage). Compromis accepté
      // pour rester dans le périmètre "calcul de prix", sans redessiner les permissions.
      updateModulesActifs(next).catch(err => console.error('[modules_actifs]', err));
      return next;
    });
  };

  const goToDashboard = () => {
  goToScreen('dashboard', 'accueil');
  };

  // Après l'étape "modules", propose à l'utilisateur de configurer son entreprise
  // (banques, salariés) tout de suite, ou de le faire plus tard.
  const goToOnboardingChoice = () => {
  goToScreen('onboarding-choice');
  };

  // Passe à l'étape "banques" du wizard de configuration
  const goToOnboardingBanques = () => {
  goToScreen('onboarding-banques');
  };

  // Passe à l'étape "salariés" du wizard de configuration
  const goToOnboardingSalaries = () => {
  goToScreen('onboarding-salaries');
  };

  // Confirme explicitement (côté serveur) qu'une étape de l'assistant n'est pas nécessaire,
  // pour que l'assistant ne réapparaisse plus à la prochaine connexion sur ce point.
  const confirmerPasDeBanque = async () => {
    try {
      await updateOnboardingStatus({ banqueNonRequise: true });
    } catch (err) {
      console.error('[confirmerPasDeBanque]', err);
    }
    goToOnboardingSalaries();
  };

  const confirmerPasDeSalarie = async () => {
    try {
      await updateOnboardingStatus({ salarieNonRequis: true });
    } catch (err) {
      console.error('[confirmerPasDeSalarie]', err);
    }
    goToDashboard();
  };

  // Depuis le 2026-11-11, aucun filtre par rôle texte : un écran est visible si son module est
  // activé et si le rôle d'entreprise de l'utilisateur peut le consulter (filtre ongletVisible
  // ci-dessous, voir RESSOURCES_ONGLETS dans src/lib/restrictions.jsx).
  // `category` ne pilote encore aucun affichage (pas de sidebar/groupement pour l'instant) —
  // préparation de données pour une future navigation groupée, sans changement visuel aujourd'hui.
  const availableTabs = [
    { id: 'accueil', label: t('nav.accueil'), icon: Home, category: null },
    { id: 'calendar', label: t('nav.calendar'), icon: CalendarDays, category: 'operations' },
    { id: 'recoltes', label: t('nav.recoltes'), icon: Package, category: 'operations' },
    { id: 'assistant', label: t('nav.assistant'), icon: Search, category: 'analyse' },
    { id: 'forecasting', label: t('nav.forecasting'), icon: TrendingUp, category: 'analyse' },
    { id: 'reports', label: t('nav.reports'), icon: FileText, category: 'analyse' },
    { id: 'tableaubord', label: t('nav.tableaubord'), icon: BarChart3, category: 'analyse' },
    activated.cultures && { id: 'cultures', label: t('nav.cultures'), icon: Sprout, category: 'operations' },
    activated.poulailler && { id: 'poulailler', label: t('nav.poulailler'), icon: Egg, category: 'operations' },
    activated.pisciculture && { id: 'pisciculture', label: t('nav.pisciculture'), icon: Fish, category: 'operations' },
    activated.clients && { id: 'clients', label: t('nav.clients'), icon: Users, category: 'commercial' },
    activated.fournisseurs && { id: 'fournisseurs', label: t('nav.fournisseurs'), icon: Truck, category: 'commercial' },
    activated.employees && { id: 'employees', label: t('nav.employees'), icon: Briefcase, category: 'rh' },
    { id: 'monrh', label: t('nav.monrh'), icon: ClipboardList, category: 'rh' },
    activated.finances && { id: 'finances', label: t('nav.finances'), icon: Landmark, category: 'finance' },
    activated.finances && { id: 'factures', label: t('nav.factures'), icon: FileText, category: 'finance' },
    activated.notifications && { id: 'notifications', label: t('nav.notifications'), icon: Bell, category: 'operations' },
    { id: 'observations', label: t('nav.observations'), icon: ClipboardList, category: 'operations' },
    { id: 'meteo', label: t('nav.meteo'), icon: Cloud, category: 'operations' },
    { id: 'surveillance', label: t('nav.surveillance'), icon: Video, category: 'operations' },
    { id: 'equipements', label: t('nav.equipements'), icon: Wrench, category: 'operations' },
    { id: 'feedback', label: t('nav.feedback'), icon: MessageSquare, category: null },
    { id: 'aide', label: t('nav.aide'), icon: HelpCircle, category: null },
    // Outil interne : contrairement à Feedback (tab toujours visible, contenu conditionnel),
    // le tab lui-même n'a aucune raison d'apparaître pour un utilisateur normal.
    isPlatformAdmin && { id: 'billing', label: t('nav.billing'), icon: Landmark, category: null },
    { id: 'profil', label: t('nav.profil'), icon: Settings, category: null },
  ].filter(Boolean)
    // Écrans dont la lecture est retirée par le rôle (voir RESSOURCES_ONGLETS). L'effet
    // ci-dessous renvoie vers l'accueil si l'écran courant disparaît ainsi.
    .filter((onglet) => ongletVisible(onglet, verificateurRestrictions));

  useEffect(() => {
    // initLoaded : sans cette garde, le premier rendu a `activated` encore à ses
    // valeurs par défaut (false) avant la résolution de storageGet ci-dessus —
    // un onglet pourtant valide (ex: /app/clients rechargé) semblerait absent
    // de availableTabs le temps d'un rendu, et cet effet redirigerait à tort
    // vers Accueil avant même que le module concerné ait fini de se charger.
    if (screen === 'dashboard' && initLoaded && tab && !availableTabs.some(t => t.id === tab)) {
      navigate('/app/accueil', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, tab, availableTabs, initLoaded]);

  // Vérifie le token au montage (ex: après un rechargement de page). Corrige
  // l'URL uniquement si elle ne correspond à rien de valide pour ce rôle (ex:
  // encore sur /login alors qu'un token valide existe, ou /modules pour un
  // rôle qui n'a pas cette permission) — sinon on laisse l'utilisateur exactement
  // où il était avant le rechargement, au lieu de le renvoyer systématiquement
  // vers Accueil/Modules comme le faisait l'ancien code avec setScreen/setTab.
  useEffect(() => {
    (async () => {
      const token = getToken();
      if (!token) return;
      try {
        const { user, entreprise } = await getMe();
        const restrictions = await rafraichirRestrictions();
        setUser(user.email);
        setIsPlatformAdmin(user.isPlatformAdmin === true);
        applyEntrepriseLocale(entreprise);
        refreshBillingStatus();
        await checkOnboardingNeeded(restrictions?.proprietaire === true);
        await refreshModulesActifs();
        const hasModulesAccess = peutGererModules(restrictions);
        const currentScreen = pathnameToScreen(location.pathname);
        if (currentScreen === 'login') {
          goToScreen(hasModulesAccess ? 'modules' : 'dashboard', 'accueil');
        } else if (currentScreen === 'modules' && !hasModulesAccess) {
          goToScreen('dashboard', 'accueil');
        }
      } catch {
        clearToken();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RestrictionsContext.Provider value={verificateurRestrictions}>
    <div className="app-shell" style={{ fontFamily: "'Inter', sans-serif", background: COLORS.bg, minHeight: '100svh', color: COLORS.ink }}>
      <ToastContainer />
      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        /* Beaucoup de tableaux (.data-table) sont rendus sans conteneur de défilement propre
           (contrairement à celui du composant partagé DataTable de ui.jsx qui, lui, s'enveloppe
           correctement) — un tableau à beaucoup de colonnes poussait alors toute la page à
           s'élargir, faisant paraître la largeur de la page « instable » d'un onglet à l'autre.
           Fixé une bonne fois pour toutes ici plutôt que dans chaque fichier : .dashboard-shell
           absorbe tout débordement horizontal en interne (barre de défilement locale plutôt que
           données coupées), .app-shell est un filet de sécurité pour tout le reste (navbar,
           écrans d'authentification/onboarding) — le corps de la page ne doit jamais défiler
           horizontalement lui-même. */
        .app-shell { overflow-x: hidden; }
        .dashboard-shell { overflow-x: auto; }
        .navbar-user-menu-item:hover { background: rgba(0,0,0,.08); }
        .navbar-burger { display: none; }
        @media (max-width: 760px) {
          .navbar-entries { display: none !important; }
          .navbar-actions-desktop { display: none !important; }
          .navbar-burger { display: flex !important; }
        }
        /* Halo de focus pour les champs bruts, dont c'est le seul repère. Les .flat-input en
           sont exclus : ils portent désormais le soulignement de la référence, qui change de
           couleur au focus, et un halo autour d'un simple trait donnerait une auréole flottante. */
        input:focus:not(.flat-input), select:focus:not(.flat-input) { border-color: ${COLORS.green} !important; box-shadow: 0 0 0 3px ${COLORS.greenSoft}; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
      `}</style>

      {screen !== 'login' && (
        <div style={{ position: 'sticky', top: 0, zIndex: 20, background: COLORS.bg }}>
          <TopNavbar
            tabs={availableTabs}
            activeTab={tab}
            onSelect={(id) => navigate(`/app/${id}`)}
            screen={screen}
            user={user}
            roleLabel={libelleRole}
            showManageOptions={verificateurRestrictions.peut('modules_actifs', 'modifier')}
            onManageOptions={() => { setIsOnboarding(false); goToScreen('modules'); }}
            onSearch={() => setSearchOpen(true)}
            onLogout={() => { clearToken(); navigate('/login'); setUser(null); setIsPlatformAdmin(false); }}
            isOnline={isOnline}
            pendingSyncCount={pendingSyncCount}
            lastSync={lastSync}
          />
          {billing?.mode === 'trial' && !trialBannerDismissed && (
            <div style={{ margin: '8px 22px 0', padding: '8px 14px', borderRadius: RADIUS.card, background: COLORS.greenSoft, color: COLORS.green, fontSize: TEXT.sm, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.sm }}>
              <span>{t('billing.trialBanner', { count: billing.daysLeft })}</span>
              <button onClick={() => setTrialBannerDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.green, fontWeight: 700, fontSize: TEXT.base }}>×</button>
            </div>
          )}
          {billing?.mode === 'readonly' && (
            <div style={{ margin: '8px 22px 0', padding: '8px 14px', borderRadius: RADIUS.card, background: COLORS.ochreSoft, color: COLORS.ochre, fontSize: TEXT.sm, fontWeight: 600, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
              <AlertTriangle size={14} /> {t('billing.readonlyBanner', { count: billing.daysLeft })}
            </div>
          )}
        </div>
      )}

      {screen !== 'login' && billing?.mode === 'locked' && (
        <AbonnementBloque
          billing={billing}
          onLogout={() => { clearToken(); navigate('/login'); setUser(null); setIsPlatformAdmin(false); setBilling(null); }}
        />
      )}

      {screen === 'login' && <LoginScreen onAuth={handleAuth} onConfirmerInscription={handleConfirmerInscription} onRenvoyerCodeInscription={handleRenvoyerCodeInscription} />}

      {screen === 'modules' && initLoaded && (
  <ModulesScreen activated={activated} onToggle={toggleModule} onContinue={isOnboarding ? goToOnboardingChoice : goToDashboard} />
      )}

      {/* Écran de transition : propose de configurer l'entreprise maintenant ou plus tard */}
{screen === 'onboarding-choice' && (
  <div style={{ maxWidth: 480, margin: '0 auto', padding: '60px 16px', textAlign: 'center' }}>
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: TEXT.title, marginBottom: SPACE.sm }}>
      {t('onboarding.configTitle')}
    </div>
    <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.xxl }}>
      {t('onboarding.configDesc')}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      <Button variant="green" onClick={goToOnboardingBanques} style={{ justifyContent: 'center' }}>
        {t('onboarding.now')}
      </Button>
      <Button variant="ghost" onClick={goToDashboard} style={{ justifyContent: 'center' }}>
        {t('onboarding.later')}
      </Button>
    </div>
  </div>
)}

{/* Étape 1 du wizard : comptes bancaires */}
{screen === 'onboarding-banques' && (
  <div style={{ maxWidth: 700, margin: '0 auto', padding: '36px 16px' }}>
    <div style={{ textAlign: 'center', marginBottom: SPACE.xl }}>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: TEXT.title, marginBottom: SPACE.sm }}>
        {t('onboarding.banquesTitle')}
      </div>
      <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>
        {t('onboarding.banquesDesc')}
      </div>
    </div>
    <BanquesModule />
    <div style={{ display: 'flex', justifyContent: 'center', gap: SPACE.sm, marginTop: SPACE.xl }}>
      <Button variant="ghost" onClick={confirmerPasDeBanque}>
        {t('onboarding.noBanque')}
      </Button>
      <Button variant="default" onClick={goToOnboardingSalaries}>
        {t('common.next')} <ChevronRight size={16} />
      </Button>
    </div>
  </div>
)}

{/* Étape 2 du wizard : salariés */}
{screen === 'onboarding-salaries' && (
  <div style={{ maxWidth: 900, margin: '0 auto', padding: '36px 16px' }}>
    <div style={{ textAlign: 'center', marginBottom: SPACE.xl }}>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: TEXT.title, marginBottom: SPACE.sm }}>
        {t('onboarding.salariesTitle')}
      </div>
      <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>
        {t('onboarding.salariesDesc')}
      </div>
    </div>
    <EmployeesModule farmId={user} />
    <div style={{ display: 'flex', justifyContent: 'center', gap: SPACE.sm, marginTop: SPACE.xl }}>
      <Button variant="ghost" onClick={confirmerPasDeSalarie}>
        {t('onboarding.noSalarie')}
      </Button>
      <Button variant="default" onClick={goToDashboard}>
        {t('common.finish')} <Check size={16} />
      </Button>
    </div>
  </div>
)}

      {screen === 'dashboard' && enAttenteRestrictions && (
        // Contenu retenu le temps de lire les restrictions (une requête) : sinon un écran masqué
        // ouvert par URL directe s'affichait un instant et ses appels partaient en 403.
        <div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}><Loader2 size={16} className="spin" /></div>
      )}

      {/* Seul un onglet présent dans availableTabs est rendu : un écran masqué demandé par URL
          directe ne monte plus (ses appels partaient en 403) avant la redirection vers l'accueil. */}
      {screen === 'dashboard' && !enAttenteRestrictions && availableTabs.some(o => o.id === tab) && (
        <div className="dashboard-shell" style={{ padding: '20px 22px 34px' }}>
          {/* Les modules d onglets sont chargés à la demande : un seul Suspense ici suffit,
              chaque onglet n en rend qu un à la fois. */}
          <Suspense fallback={<div style={{ color: COLORS.inkSoft, padding: SPACE.xl }}><Loader2 size={16} className="spin" /></div>}>
            {tab === 'accueil' && (
              <HomeGrid
                tabs={availableTabs} activated={activated}
                onToggle={toggleModule} onSelect={(id) => navigate(`/app/${id}`)}
              />
            )}
            {tab === 'tableaubord' && <HomeOverview farmId={user} activated={activated} />}
            {tab === 'calendar' && <AgriculturalCalendarModule farmId={user} />}
            {tab === 'recoltes' && <HarvestsModule farmId={user} />}
            {tab === 'assistant' && <AIAssistantModule farmId={user} activated={activated} />}
            {tab === 'forecasting' && <ForecastingModule farmId={user} activated={activated} />}
            {tab === 'reports' && <ReportsModule farmId={user} activated={activated} />}
            {tab === 'cultures' && (
              <CulturesModule
                farmId={user}
                highlightProduitId={highlightProduit?.module === 'Cultures' ? highlightProduit.id : null}
              />
            )}
            {tab === 'poulailler' && (
              <PoulaillerModule
                farmId={user}
                highlightProduitId={highlightProduit?.module === 'Poulailler' ? highlightProduit.id : null}
              />
            )}
            {tab === 'pisciculture' && (
              <PiscicultureModule
                farmId={user}
                highlightProduitId={highlightProduit?.module === 'Pisciculture' ? highlightProduit.id : null}
              />
            )}
            {tab === 'clients' && <ContactsTab type="client" highlightId={highlightContactId || highlightFromUrl} />}
            {tab === 'fournisseurs' && <ContactsTab type="fournisseur" highlightId={highlightContactId || highlightFromUrl} />}
            {tab === 'employees' && <EmployeesModule farmId={user} />}
            {tab === 'monrh' && <MonEspaceRh />}
            {tab === 'finances' && <FinancesModule farmId={user} />}
            {tab === 'factures' && <FacturesModule />}
            {tab === 'notifications' && <NotificationsModule farmId={user} activated={activated} />}
            {tab === 'observations' && <ObservationListView />}
            {tab === 'meteo' && <MeteoModule />}
            {tab === 'surveillance' && <SurveillanceModule canManage={verificateurRestrictions.peut('cameras', 'creer')} />}
            {tab === 'equipements' && <EquipementsModule canManage={verificateurRestrictions.peut('equipements', 'creer')} />}
            {tab === 'feedback' && <FeedbackModule isPlatformAdmin={isPlatformAdmin} />}
            {tab === 'billing' && isPlatformAdmin && <BillingAdminPanel />}
            {tab === 'aide' && <HelpModule />}
            {tab === 'profil' && <ProfilModule farmId={user} />}
          </Suspense>
        </div>
      )}

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} onSelect={handleSearchSelect} />}

      {screen === 'dashboard' && tab !== 'aide' && (
        <Suspense fallback={null}>
          <AideFlottante tab={tab} onOuvrirAide={() => navigate('/app/aide')} />
        </Suspense>
      )}
    </div>
    </RestrictionsContext.Provider>
  );
}

function ProfilModule() {
 // Fiche entreprise, devise/locale/fuseau et localisation météo sont des données de l'entreprise :
 // modifiables par qui en a le droit (restriction entreprise/modifier), plus par le rôle texte.
 const isAdmin = useRestrictions().peut('entreprise', 'modifier');
  const { t, i18n } = useTranslation();
  const { devise, locale, fuseau, setLocaleConfig } = useLocale();
  const [prefDevise, setPrefDevise] = useState(devise);
  const [prefLocale, setPrefLocale] = useState(locale);
  const [prefFuseau, setPrefFuseau] = useState(fuseau);
  const [prefBusy, setPrefBusy] = useState(false);
  const [prefMsg, setPrefMsg] = useState('');
  useEffect(() => { setPrefDevise(devise); setPrefLocale(locale); setPrefFuseau(fuseau); }, [devise, locale, fuseau]);

  const savePreferences = async () => {
    setPrefBusy(true);
    setPrefMsg('');
    try {
      if (isAdmin && (prefDevise !== devise || prefLocale !== locale || prefFuseau !== fuseau)) {
        await updateEntreprise({ devise: prefDevise, locale: prefLocale, fuseau: prefFuseau });
        setLocaleConfig({ devise: prefDevise, locale: prefLocale, fuseau: prefFuseau });
      }
      setPrefMsg(t('profil.preferencesSaved'));
    } catch (err) {
      setPrefMsg(err.message);
    } finally {
      setPrefBusy(false);
    }
  };

  // Informations de l'entreprise (nom/SIRET/TVA/adresse/téléphone/pays — voir
  // routes/entreprise.js) : champs devenus obligatoires à l'inscription pour un compte
  // 'entreprise' (voir routes/auth.js:register), donc réutilisables ici pour corriger une
  // erreur de saisie. Chargés par le même effet que la localisation météo ci-dessous
  // (un seul GET /api/entreprise pour les deux).
  const [infoEntreprise, setInfoEntreprise] = useState({ nom: '', siret: '', numeroTva: '', adresse: '', telephone: '', pays: '' });
  const [infoBusy, setInfoBusy] = useState(false);
  const [infoMsg, setInfoMsg] = useState('');

  const saveInfoEntreprise = async () => {
    setInfoBusy(true);
    setInfoMsg('');
    try {
      await updateEntreprise(infoEntreprise);
      setInfoMsg(t('profil.companyInfoSaved'));
    } catch (err) {
      setInfoMsg(err.message);
    } finally {
      setInfoBusy(false);
    }
  };

  // Localisation météo de l'entreprise (voir routes/meteo.js) — recherche « au fil de la
  // frappe » façon GlobalSearch (timer 250 ms + garde reqIdRef contre les réponses obsolètes).
  const [villeActuelle, setVilleActuelle] = useState(null);
  const [villeQuery, setVilleQuery] = useState('');
  const [villeResultats, setVilleResultats] = useState([]);
  const [villeLoading, setVilleLoading] = useState(false);
  const [villeSelection, setVilleSelection] = useState(null);
  const [villeBusy, setVilleBusy] = useState(false);
  const [villeMsg, setVilleMsg] = useState('');
  const villeTimerRef = useRef(null);
  const villeReqIdRef = useRef(0);

  useEffect(() => {
    getEntreprise().then(({ entreprise }) => {
      if (entreprise?.ville) setVilleActuelle({ ville: entreprise.ville, latitude: entreprise.latitude, longitude: entreprise.longitude });
      if (entreprise) {
        setInfoEntreprise({
          nom: entreprise.nom || '', siret: entreprise.siret || '', numeroTva: entreprise.numeroTva || '',
          adresse: entreprise.adresse || '', telephone: entreprise.telephone || '', pays: entreprise.pays || '',
        });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    clearTimeout(villeTimerRef.current);
    if (villeQuery.trim().length < 2) { setVilleResultats([]); return undefined; }
    villeTimerRef.current = setTimeout(async () => {
      const myId = ++villeReqIdRef.current;
      setVilleLoading(true);
      try {
        const { villes } = await rechercherVilleMeteo(villeQuery.trim());
        if (villeReqIdRef.current === myId) setVilleResultats(villes || []);
      } catch (err) {
        console.error('[ProfilModule ville]', err);
      } finally {
        if (villeReqIdRef.current === myId) setVilleLoading(false);
      }
    }, 250);
    return () => clearTimeout(villeTimerRef.current);
  }, [villeQuery]);

  const choisirVille = (v) => {
    setVilleSelection(v);
    setVilleResultats([]);
    setVilleQuery(`${v.nom}${v.pays ? ', ' + v.pays : ''}`);
  };

  const enregistrerVille = async () => {
    if (!villeSelection) return;
    setVilleBusy(true);
    setVilleMsg('');
    try {
      await updateEntreprise({ ville: villeSelection.nom, latitude: villeSelection.latitude, longitude: villeSelection.longitude });
      setVilleActuelle({ ville: villeSelection.nom, latitude: villeSelection.latitude, longitude: villeSelection.longitude });
      setVilleSelection(null);
      setVilleMsg(t('profil.locationSaved'));
    } catch (err) {
      setVilleMsg(err.message);
    } finally {
      setVilleBusy(false);
    }
  };

  const [qrCode, setQrCode] = useState(null);
  const [code, setCode] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaMethod, setMfaMethod] = useState('totp');       // méthode active une fois la 2FA en place
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [mfaMode, setMfaMode] = useState(null);             // étape d'activation en cours : 'totp' | 'email'
  const [chosenMethod, setChosenMethod] = useState('totp'); // méthode retenue avant de lancer l'activation
  const [disablePassword, setDisablePassword] = useState(''); // exigé par le serveur pour désactiver la 2FA

  useEffect(() => {
    getMe().then(data => {
      if (data.user?.mfaEnabled) setMfaEnabled(true);
      if (data.user?.mfaMethod) setMfaMethod(data.user.mfaMethod);
    }).catch(() => {});
  }, []);

  const startSetup = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const data = await setupMfa(chosenMethod);
      setMfaMode(data.method);
      if (data.method === 'totp') {
        setQrCode(data.qrCode);
      } else {
        setSentTo(data.sentTo);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const resendEmailCode = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await resendMfaEmail();
      if (data?.sentTo) setSentTo(data.sentTo);
      setSuccess(t('profil.mfaResent'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await verifyMfa(code, mfaMode);
      setMfaEnabled(true);
      setMfaMethod(mfaMode);
      setQrCode(null);
      setMfaMode(null);
      setCode('');
      setSuccess(t('profil.mfaEnabled'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async (e) => {
    e?.preventDefault();
    if (!disablePassword) {
      setError(t('profil.mfaDisablePasswordRequired'));
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await disableMfa(disablePassword);
      setDisablePassword('');
      setMfaEnabled(false);
      setMfaMethod('totp');
      setChosenMethod('totp');
      setSuccess(t('profil.mfaDisabled'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const methodLabels = {
    totp: t('profil.methodTotp'),
    email: t('profil.methodEmail'),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.lg }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: SPACE.lg, alignItems: 'start' }}>

      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: 3 }}>
          {t('profil.companyInfoTitle')}
        </div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.lg }}>
          {t('profil.companyInfoHint')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <Field label={t('auth.companyName')} value={infoEntreprise.nom} onChange={e => setInfoEntreprise(v => ({ ...v, nom: e.target.value }))} disabled={!isAdmin} />
          <div style={{ display: 'flex', gap: SPACE.sm }}>
            <Field label={t('auth.siret')} value={infoEntreprise.siret} onChange={e => setInfoEntreprise(v => ({ ...v, siret: e.target.value }))} disabled={!isAdmin} style={{ flex: 1 }} />
            <Field label={t('auth.vatNumber')} value={infoEntreprise.numeroTva} onChange={e => setInfoEntreprise(v => ({ ...v, numeroTva: e.target.value }))} disabled={!isAdmin} style={{ flex: 1 }} />
          </div>
          <Field label={t('auth.address')} value={infoEntreprise.adresse} onChange={e => setInfoEntreprise(v => ({ ...v, adresse: e.target.value }))} disabled={!isAdmin} />
          <div style={{ display: 'flex', gap: SPACE.sm }}>
            <Field label={t('auth.phone')} value={infoEntreprise.telephone} onChange={e => setInfoEntreprise(v => ({ ...v, telephone: e.target.value }))} disabled={!isAdmin} style={{ flex: 1 }} />
            <Select label={t('auth.country')} value={infoEntreprise.pays} onChange={e => setInfoEntreprise(v => ({ ...v, pays: e.target.value }))} disabled={!isAdmin} style={{ flex: 1 }}>
              <option value="">{t('auth.countryPlaceholder')}</option>
              {PAYS.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
            </Select>
          </div>
          {isAdmin && (
            <Button variant="green" onClick={saveInfoEntreprise} disabled={infoBusy} style={{ alignSelf: 'flex-start' }}>
              {infoBusy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {t('profil.saveCompanyInfo')}
            </Button>
          )}
          {infoMsg && <div style={{ fontSize: TEXT.base, color: COLORS.green }}>{infoMsg}</div>}
        </div>
      </Card>

      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
          {t('profil.sectionPreferences')}
        </div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.lg }}>
          {t('profil.sectionPreferencesHint')}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
          <Select
            label={t('language.label')}
            value={i18n.resolvedLanguage || i18n.language}
            onChange={e => setLanguage(e.target.value)}
          >
            {SUPPORTED_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </Select>
          <Select label={t('profil.currency')} value={prefDevise} onChange={e => setPrefDevise(e.target.value)} disabled={!isAdmin}>
            {DEVISES.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </Select>
          <Select label={t('profil.locale')} value={prefLocale} onChange={e => setPrefLocale(e.target.value)} disabled={!isAdmin}>
            {LOCALES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </Select>
          <Select label={t('profil.fuseau')} value={prefFuseau} onChange={e => setPrefFuseau(e.target.value)} disabled={!isAdmin} aide={t('profil.fuseauAide')}>
            {FUSEAUX.map(f => <option key={f} value={f}>{f}</option>)}
          </Select>
          <div style={{ display: 'flex', gap: SPACE.lg, fontSize: TEXT.sm, color: COLORS.inkSoft }}>
            <span>{t('profil.previewMoney')} : <b style={{ color: COLORS.ink }}>{previewMoney(prefLocale, prefDevise, 1234567.5)}</b></span>
            <span>{t('profil.previewDate')} : <b style={{ color: COLORS.ink }}>{previewDate(prefLocale, new Date())}</b></span>
          </div>
          {isAdmin && (
            <Button variant="green" onClick={savePreferences} disabled={prefBusy} style={{ alignSelf: 'flex-start' }}>
              {prefBusy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {t('profil.savePreferences')}
            </Button>
          )}
          {prefMsg && <div style={{ fontSize: TEXT.base, color: COLORS.green }}>{prefMsg}</div>}
        </div>
      </Card>

      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: 3 }}>
          {t('profil.locationTitle')}
        </div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.lg }}>
          {t('profil.locationHint')}
        </div>
        {villeActuelle && (
          <div style={{ fontSize: TEXT.base, color: COLORS.ink, marginBottom: SPACE.md }}>
            {t('profil.locationCurrent')} : <b>{villeActuelle.ville}</b>
          </div>
        )}
        {isAdmin && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            <div style={{ position: 'relative' }}>
              <Field
                label={t('profil.locationSearch')}
                placeholder={t('profil.locationSearchPlaceholder')}
                value={villeQuery}
                onChange={(e) => { setVilleQuery(e.target.value); setVilleSelection(null); }}
              />
              {villeLoading && <div style={{ fontSize: TEXT.sm, color: COLORS.inkSoft, marginTop: SPACE.xs }}>{t('common.loading')}</div>}
              {villeResultats.length > 0 && (
                <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: RADIUS.card, marginTop: SPACE.xs, overflow: 'hidden' }}>
                  {villeResultats.map((v, i) => (
                    <button
                      key={`${v.nom}-${i}`}
                      type="button"
                      onClick={() => choisirVille(v)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                        background: 'none', border: 'none', cursor: 'pointer', fontSize: TEXT.base, color: COLORS.ink,
                        borderBottom: i < villeResultats.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                      }}
                    >
                      {v.nom}{v.region ? `, ${v.region}` : ''}{v.pays ? ` — ${v.pays}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button variant="green" onClick={enregistrerVille} disabled={!villeSelection || villeBusy} style={{ alignSelf: 'flex-start' }}>
              {villeBusy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {t('profil.locationSave')}
            </Button>
            {villeMsg && <div style={{ fontSize: TEXT.base, color: COLORS.green }}>{villeMsg}</div>}
          </div>
        )}
      </Card>

      <Card>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: TEXT.md, marginBottom: SPACE.sm }}>
          {t('profil.securityTitle')}
        </div>
        <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft, marginBottom: SPACE.lg }}>
          {t('profil.securityHint')}
        </div>

        {error && (
          <div style={{ background: COLORS.redSoft, color: COLORS.red, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, marginBottom: SPACE.md }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ background: COLORS.greenSoft || COLORS.greenSoft, color: COLORS.green, borderRadius: RADIUS.card, padding: '9px 12px', fontSize: TEXT.base, marginBottom: SPACE.md }}>
            {success}
          </div>
        )}

        {!mfaMode && !mfaEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            <div style={{ fontSize: TEXT.base, fontWeight: 600 }}>{t('profil.mfaChooseMethod')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              {['totp', 'email'].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setChosenMethod(m)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: RADIUS.control, cursor: 'pointer',
                    border: `1px solid ${chosenMethod === m ? COLORS.ink : COLORS.border}`,
                    background: chosenMethod === m ? COLORS.ink : '#fff',
                    color: chosenMethod === m ? '#fff' : COLORS.ink,
                    fontSize: TEXT.base, fontWeight: 600,
                  }}
                >
                  {methodLabels[m]}
                  {chosenMethod === m && <Check size={15} />}
                </button>
              ))}
            </div>
            <Button variant="green" onClick={startSetup} disabled={busy} style={{ alignSelf: 'flex-start' }}>
              {busy ? <Loader2 size={15} className="spin" /> : <Lock size={14} />} {t('profil.mfaEnable')}
            </Button>
          </div>
        )}

        {mfaMode === 'totp' && qrCode && (
          <div>
            <div style={{ fontSize: TEXT.base, marginBottom: SPACE.sm }}>
              {t('profil.mfaScanHint')}
            </div>
            <img src={qrCode} alt={t("profil.mfaQrAlt")} style={{ width: 180, height: 180, marginBottom: SPACE.md, borderRadius: RADIUS.card, border: `1px solid ${COLORS.border}` }} />
            <form onSubmit={confirmSetup} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              <Field label={t("auth.mfaCode")} placeholder="123456" value={code} onChange={e => setCode(e.target.value)} required maxLength={6} />
              <Button type="submit" variant="green" disabled={busy}>
                {busy ? <Loader2 size={15} className="spin" /> : null} {t('profil.mfaConfirm')}
              </Button>
            </form>
          </div>
        )}

        {mfaMode === 'email' && (
          <div>
            <div style={{ fontSize: TEXT.base, marginBottom: SPACE.sm }}>
              {t('profil.mfaCodeSent', { sentTo })}
            </div>
            <form onSubmit={confirmSetup} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              <Field label={t("auth.mfaCode")} placeholder="123456" value={code} onChange={e => setCode(e.target.value)} required maxLength={6} />
              <Button type="submit" variant="green" disabled={busy}>
                {busy ? <Loader2 size={15} className="spin" /> : null} {t('profil.mfaConfirm')}
              </Button>
            </form>
            <button type="button" onClick={resendEmailCode} disabled={busy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.green, fontWeight: 600, fontSize: TEXT.base, marginTop: SPACE.sm, padding: 0 }}>
              {t('profil.mfaResend')}
            </button>
          </div>
        )}

        {mfaEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
            <div style={{ fontSize: TEXT.base, color: COLORS.inkSoft }}>
              {t('profil.mfaMethodActive', { method: methodLabels[mfaMethod] || mfaMethod })}
            </div>
            <form onSubmit={handleDisable} style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
              <Field
                label={t('profil.mfaDisablePassword')}
                type="password"
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
              />
              <Button type="submit" variant="ghost" disabled={busy || !disablePassword} style={{ alignSelf: 'flex-start' }}>
                {busy ? <Loader2 size={15} className="spin" /> : null} {t('profil.mfaDisable')}
              </Button>
            </form>
          </div>
        )}
      </Card>
    </div>
    </div>
  );
}

// Composant de gestion des comptes bancaires de l'entreprise.
// Props :
// - onCountChange (optionnel) : callback appelé avec le nombre de banques, utile pour le wizard
//   afin de savoir si l'utilisateur a ajouté au moins un compte avant de continuer
