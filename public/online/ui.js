// Online-only connection feedback; the LAN page never imports this module.
const labels = {
  fr: { title: 'EN LIGNE · 1–4 JOUEURS', subtitle: 'Joue sur Internet, seul ou avec tes amis.', connecting: 'Connexion…', ready: 'En ligne', retry: 'Connexion interrompue · reconnexion…', stale: 'Échanges réseau retardés · commandes suspendues', restored: 'Connexion rétablie · reprends avec le bouton du menu', lost: 'Reconnexion impossible · rejoins à nouveau le refuge', note: 'Partage le lien de ta salle avec tes amis. L’hôte peut mettre toute l’équipe en pause avec P.', warning: 'Le serveur redémarre · cette partie ne pourra pas être récupérée.', waiting: 'En attente', ms: 'ms' },
  en: { title: 'ONLINE · 1–4 PLAYERS', subtitle: 'Play online, on your own or with friends.', connecting: 'Connecting…', ready: 'Online', retry: 'Connection lost · reconnecting…', stale: 'Network updates delayed · controls suspended', restored: 'Connection restored · resume from the menu', lost: 'Unable to reconnect · join the shelter again', note: 'Share your room link with your friends. The host can pause the whole team with P.', warning: 'Server restarting · this match cannot be recovered.', waiting: 'Waiting', ms: 'ms' },
};

export function createOnlineUI({ document = globalThis.document, language = () => 'fr' } = {}) {
  const badge = document.createElement('aside'); badge.id = 'online-status'; badge.setAttribute('role', 'status'); badge.setAttribute('aria-live', 'polite');
  const status = document.createElement('span'), ping = document.createElement('small'); badge.append(status, ping);
  document.body.append(badge);
  const note = document.createElement('p'); note.className = 'online-note';
  document.querySelector('#menu .setup-panel')?.append(note);
  let phase = 'waiting', rtt = null;
  const text = key => (labels[language()] ?? labels.fr)[key] ?? key;
  const render = () => {
    status.textContent = text(phase); ping.textContent = rtt === null ? '' : `${Math.round(rtt)} ${text('ms')}`;
    badge.dataset.state = phase; note.textContent = text('note');
    const subtitle = document.querySelector('#online-subtitle');
    if (subtitle) subtitle.textContent = text('subtitle');
    const idle = document.querySelector('#connection-label');
    if (idle && !document.body.classList.contains('playing') && document.querySelector('#lobby')?.hidden) idle.textContent = text('title');
  };
  globalThis.addEventListener?.('deadwood-language-change', render);
  render();
  return { set(state, latency = rtt) { phase = state; rtt = Number.isFinite(latency) ? latency : null; render(); }, text, render };
}
