import { api } from '../api.js';
import { session, setUser, signOut } from '../session.js';
import { gameCard } from '../cards.js';
import { currentPosition } from '../map.js';
import { h, icon, money, field, bindForm, formError, toast, emptyState, whenLabel, formatBadge, SKILL_LABELS } from '../ui.js';

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Anywhere'];

export async function renderProfile(view, ctx) {
  const { games } = await api.get('/games/mine');
  const user = session.user;
  let home = user.homeLat !== null ? { lat: user.homeLat, lng: user.homeLng } : null;

  const homeStatus = h('span', { class: 'muted' });
  function showHome() {
    homeStatus.textContent = home ? 'Saved — games near home show first.' : 'Not set';
  }
  showHome();

  const form = bindForm(
    h(
      'form',
      { class: 'profile-form' },
      field('Name', h('input', { type: 'text', name: 'displayName', required: true, minlength: 2, maxlength: 40, value: user.displayName })),
      h(
        'div',
        { class: 'field-row' },
        field('Skill level', h('select', { name: 'skillLevel', value: user.skillLevel }, session.meta.skillLevels.map((s) => h('option', { value: s }, SKILL_LABELS[s])))),
        field(
          'Position',
          h('select', { name: 'position', value: user.position || '' }, h('option', { value: '' }, '—'), POSITIONS.map((p) => h('option', { value: p }, p))),
        ),
      ),
      h(
        'div',
        { class: 'field-row' },
        field('Date of birth', h('input', { type: 'date', name: 'birthDate', value: user.birthDate || '' })),
        field('State', h('select', { name: 'state', value: user.state || '' }, h('option', { value: '' }, '—'), session.meta.states.map((s) => h('option', { value: s }, s)))),
      ),
      h('p', { class: 'field-hint' }, `Date of birth and state are only used to check you can play wager matches (${session.meta.wagers.minAge}+).`),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Home area'),
        h(
          'div',
          { class: 'home-row' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-light btn-small',
              onClick: async () => {
                try {
                  home = await currentPosition();
                  showHome();
                  homeStatus.textContent = 'Location found — save to keep it.';
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            },
            icon('locate', { size: 16 }),
            'Use my current location',
          ),
          homeStatus,
        ),
      ),
      formError(),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save profile'),
    ),
    async (data) => {
      const { user: updated } = await api.patch('/me', {
        displayName: data.get('displayName'),
        skillLevel: data.get('skillLevel'),
        position: data.get('position'),
        birthDate: data.get('birthDate'),
        state: data.get('state'),
        homeLat: home ? home.lat : null,
        homeLng: home ? home.lng : null,
      });
      setUser(updated);
      showHome();
      toast('Profile saved', 'success');
    },
  );

  const stats = user.stats;
  const upcoming = games.filter((g) => g.phase === 'upcoming' || g.phase === 'live').reverse();
  const past = games.filter((g) => g.phase !== 'upcoming' && g.phase !== 'live');

  const root = h(
    'div',
    { class: 'profile' },
    h('h1', {}, user.displayName),
    h(
      'div',
      { class: 'stat-row' },
      stat(stats.gamesPlayed, 'Games played'),
      stat(`${stats.wins}-${stats.draws}-${stats.losses}`, 'W-D-L'),
      stat(stats.wagerWins, 'Wager wins'),
      stat(money(stats.winningsCents), 'Winnings'),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Your upcoming games'),
      upcoming.length
        ? h('div', { class: 'card-grid' }, upcoming.map(gameCard))
        : emptyState('Nothing scheduled', 'Find a game near you or host your own.', h('a', { class: 'btn btn-primary', href: '#/' }, 'Find games')),
    ),
    past.length
      ? h(
          'section',
          { class: 'card' },
          h('h2', {}, 'Past games'),
          h(
            'ul',
            { class: 'past-games' },
            past.map((g) =>
              h(
                'li',
                {},
                h(
                  'a',
                  { href: `#/game/${g.id}` },
                  formatBadge(g.format),
                  h('span', { class: 'past-title' }, g.title),
                  h('span', { class: 'muted small' }, whenLabel(g.startsAt)),
                  h('span', { class: 'past-result' }, pastResult(g, user.id)),
                ),
              ),
            ),
          ),
        )
      : null,
    h('section', { class: 'card' }, h('h2', {}, 'Profile'), form),
    h('button', { type: 'button', class: 'btn btn-light', onClick: async () => { await signOut(); ctx.navigate('/'); } }, 'Log out'),
  );
  ctx.mount(root);
}

function stat(value, label) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, String(value)), h('span', { class: 'stat-label' }, label));
}

function pastResult(game, userId) {
  if (game.phase === 'cancelled') return 'Cancelled';
  if (!game.result) return 'No score';
  const { scoreA, scoreB, winner, status } = game.result;
  if (status !== 'confirmed') return `${scoreA}–${scoreB} (${status})`;
  const myTeam = game.teams.A.some((p) => p.id === userId) ? 'A' : game.teams.B.some((p) => p.id === userId) ? 'B' : null;
  const outcome = winner === 'draw' ? 'D' : myTeam === winner ? 'W' : myTeam ? 'L' : '';
  return `${outcome} ${scoreA}–${scoreB}`.trim();
}
