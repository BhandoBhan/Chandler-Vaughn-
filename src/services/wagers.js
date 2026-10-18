'use strict';

// Splits a wager pot. The platform fee is rounded to the nearest cent and any
// cents that cannot be split evenly between winners also go to the platform,
// so every cent of the pot is accounted for.
function computePayout({ potCents, winnerCount, platformFeePercent }) {
  const feeCents = Math.round((potCents * platformFeePercent) / 100);
  const prizePoolCents = potCents - feeCents;
  const perWinnerCents = winnerCount > 0 ? Math.floor(prizePoolCents / winnerCount) : 0;
  const leftoverCents = prizePoolCents - perWinnerCents * winnerCount;
  return { potCents, prizePoolCents, perWinnerCents, platformCents: feeCents + leftoverCents };
}

function ageOn(birthDate, now) {
  const [year, month, day] = birthDate.split('-').map(Number);
  let age = now.getUTCFullYear() - year;
  const hadBirthday =
    now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  if (!hadBirthday) age -= 1;
  return age;
}

// Returns why a player cannot take part in wager matches, or null if they can.
function wagerEligibility(user, settings, now) {
  const { wagers } = settings;
  if (!wagers.enabled) return 'Wager matches are turned off';
  if (!user.birth_date) return 'Add your date of birth to your profile to play wager matches';
  if (ageOn(user.birth_date, now) < wagers.minAge) {
    return `You must be ${wagers.minAge} or older to play wager matches`;
  }
  if (!user.state) return 'Add your state to your profile to play wager matches';
  if (wagers.blockedStates.includes(user.state)) return 'Wager matches are not available in your state';
  return null;
}

module.exports = { computePayout, wagerEligibility, ageOn };
