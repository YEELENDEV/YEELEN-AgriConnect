// Multi-devise réel, étape 1 : lecture de taux de change (voir utils/currencyRates.js).
// Toujours côté serveur (comme meteo.js/precisionAgricole.js), jamais d'appel direct au
// fournisseur de taux depuis le frontend.
import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { convertir, DeviseInconnueError } from '../utils/currencyRates.js';
import { log } from '../utils/journal.js';

const router = express.Router();

router.get('/taux', authRequired, async (req, res) => {
  const { de, vers, date } = req.query;
  if (!de || !vers) return res.status(400).json({ error: 'Les paramètres de et vers sont requis.' });

  try {
    const { taux, date: dateTaux } = await convertir(1, de, vers, date || undefined);
    return res.json({ de, vers, taux, date: dateTaux });
  } catch (err) {
    if (err instanceof DeviseInconnueError) {
      return res.status(400).json({ error: err.message });
    }
    log.error('[GET /devises/taux]', err);
    return res.status(502).json({ error: 'Taux de change indisponible pour le moment.' });
  }
});

export default router;
