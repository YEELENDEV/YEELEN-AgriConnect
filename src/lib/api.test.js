import {
  sessionOuverte, marquerSession, oublierSession, deconnexion,
  getMe, createContactTag,
  flushOfflineQueue,
} from './api.js';

const okResponse = (data = {}, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(data),
});

const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  global.fetch = jest.fn();
  setOnline(true);
});

describe('session (lot 2b : cookie HttpOnly, aucun jeton côté navigateur)', () => {
  test('marqueur de session sans valeur secrète', () => {
    expect(sessionOuverte()).toBe(false);
    marquerSession();
    expect(sessionOuverte()).toBe(true);
    expect(localStorage.getItem('agri-session')).toBe('1');
    oublierSession();
    expect(sessionOuverte()).toBe(false);
  });

  test('deconnexion appelle le serveur et oublie la session, même hors ligne', async () => {
    marquerSession();
    fetch.mockResolvedValue(okResponse({ ok: true }));
    await deconnexion();
    expect(fetch.mock.calls[0][0]).toMatch(/\/auth\/deconnexion$/);
    expect(fetch.mock.calls[0][1].method).toBe('POST');
    expect(sessionOuverte()).toBe(false);

    marquerSession();
    fetch.mockRejectedValue(new TypeError('offline'));
    await deconnexion();
    expect(sessionOuverte()).toBe(false);
  });
});

describe('request (via getMe)', () => {
  test('envoie le cookie (credentials) et l’en-tête CSRF, jamais d’en-tête Authorization', async () => {
    marquerSession();
    fetch.mockResolvedValue(okResponse({ user: { id: 1 } }));
    await getMe();
    const [, opts] = fetch.mock.calls[0];
    expect(opts.credentials).toBe('include');
    expect(opts.headers['X-Requested-With']).toBe('AgriConnect');
    expect(opts.headers.Authorization).toBeUndefined();
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  test('échec réseau → message convivial', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(getMe()).rejects.toThrow(/Impossible de contacter le serveur/);
  });

  test('401 → oublie la session, émet agri-auth-expired et jette', async () => {
    marquerSession();
    fetch.mockResolvedValue(okResponse({ error: 'Session expirée.' }, 401));
    const listener = jest.fn();
    window.addEventListener('agri-auth-expired', listener);

    await expect(getMe()).rejects.toThrow(/expirée/i);
    expect(sessionOuverte()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('agri-auth-expired', listener);
  });

  test('réponse non-ok (4xx/5xx) → jette le message d\'erreur du serveur', async () => {
    fetch.mockResolvedValue(okResponse({ error: 'Champ requis manquant.' }, 400));
    await expect(getMe()).rejects.toThrow('Champ requis manquant.');
  });

  test('402 (abonnement) → émet agri-subscription-blocked avec le detail, jette, NE ferme PAS la session', async () => {
    marquerSession();
    fetch.mockResolvedValue(okResponse({ reason: 'expired', mode: 'locked' }, 402));
    const listener = jest.fn();
    window.addEventListener('agri-subscription-blocked', listener);

    await expect(getMe()).rejects.toThrow(/expiré/i);
    expect(sessionOuverte()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ reason: 'expired', mode: 'locked' });
    window.removeEventListener('agri-subscription-blocked', listener);
  });

  test('402 suspended → message dédié', async () => {
    marquerSession();
    fetch.mockResolvedValue(okResponse({ reason: 'suspended', mode: 'locked' }, 402));
    await expect(getMe()).rejects.toThrow(/suspendu/i);
  });

  test('erreur serveur (5xx) → le message porte la référence de la requête', async () => {
    marquerSession();
    fetch.mockResolvedValue(okResponse({ error: 'Erreur interne du serveur.', requestId: 'a1b2c3d4e5f6' }, 500));
    await expect(getMe()).rejects.toThrow('Erreur interne du serveur. (réf. a1b2c3d4e5f6)');
  });

  test('erreur client (4xx) → message seul, sans référence', async () => {
    marquerSession();
    fetch.mockResolvedValue(okResponse({ error: 'Champ manquant.', requestId: 'a1b2c3d4e5f6' }, 400));
    await expect(getMe()).rejects.toThrow(/^Champ manquant\.$/);
  });
});

describe('safeRequest (via createContactTag)', () => {
  test('erreur réseau → opération mise en file agri-offline-queue, renvoie null', async () => {
    fetch.mockRejectedValue(new TypeError('offline'));
    const evt = jest.fn();
    window.addEventListener('agri-sync-status-changed', evt);

    const res = await createContactTag({ nom: 'VIP' });
    expect(res).toBeNull();

    const queue = JSON.parse(localStorage.getItem('agri-offline-queue'));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ path: '/contact-tags', method: 'POST', body: { nom: 'VIP' } });
    expect(evt).toHaveBeenCalled();
    window.removeEventListener('agri-sync-status-changed', evt);
  });

  test('vraie erreur serveur (400) → rethrow, RIEN mis en file', async () => {
    fetch.mockResolvedValue(okResponse({ error: 'Ce tag existe déjà.' }, 409));
    await expect(createContactTag({ nom: 'VIP' })).rejects.toThrow('Ce tag existe déjà.');
    expect(localStorage.getItem('agri-offline-queue')).toBeNull();
  });
});

describe('flushOfflineQueue', () => {
  const seed = (ops) => localStorage.setItem('agri-offline-queue', JSON.stringify(ops));

  test('hors ligne → no-op { flushed: 0 }', async () => {
    setOnline(false);
    seed([{ path: '/x', method: 'POST', body: { a: 1 } }]);
    expect(await flushOfflineQueue()).toEqual({ flushed: 0 });
    expect(localStorage.getItem('agri-offline-queue')).not.toBeNull(); // rien consommé
  });

  test('en ligne, tout réussit → file vidée, agri-last-sync posé', async () => {
    seed([
      { path: '/contact-tags', method: 'POST', body: { nom: 'A' } },
      { path: '/contact-tags', method: 'POST', body: { nom: 'B' } },
    ]);
    fetch.mockResolvedValue(okResponse({ ok: true }, 201));

    const res = await flushOfflineQueue();
    expect(res).toEqual({ flushed: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('agri-offline-queue')).toBeNull();
    expect(localStorage.getItem('agri-last-sync')).toBeTruthy();
  });

  test('un échec est conservé pour la prochaine passe', async () => {
    seed([
      { path: '/ok', method: 'POST', body: { n: 1 } },
      { path: '/ko', method: 'POST', body: { n: 2 } },
    ]);
    fetch
      .mockResolvedValueOnce(okResponse({}, 200))       // /ok
      .mockRejectedValueOnce(new TypeError('offline')); // /ko

    const res = await flushOfflineQueue();
    expect(res).toEqual({ flushed: 1 });
    const remaining = JSON.parse(localStorage.getItem('agri-offline-queue'));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].path).toBe('/ko');
  });

  test('file absente ou JSON corrompu → { flushed: 0 } sans jeter', async () => {
    expect(await flushOfflineQueue()).toEqual({ flushed: 0 });
    localStorage.setItem('agri-offline-queue', '{pas du json');
    expect(await flushOfflineQueue()).toEqual({ flushed: 0 });
    expect(localStorage.getItem('agri-offline-queue')).toBeNull(); // nettoyé
  });
});
