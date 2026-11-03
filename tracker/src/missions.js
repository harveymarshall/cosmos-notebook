// The deep-space fleet that Mission Control follows. Shared by the tracker Lambda (which
// fetches positions, Deep Space Network contacts and news for each one) and the /missions/
// page (which draws them). Plain data, no imports, so it runs in Node and the browser.
//
// horizons: the spacecraft's ID in NASA JPL Horizons (the same as its NAIF ID)
// news:     words to look for in news headlines (Spaceflight News API, title search)
// milestones: date is 'YYYY-MM-DD' (or 'YYYY-MM' when only the month is known)
//
// To follow a new mission, add it here: the next tracker run picks it up.

export const MISSIONS = [
  {
    slug: 'voyager-1',
    name: 'Voyager 1',
    short: 'VGR1',
    agency: 'NASA',
    horizons: -31,
    launched: '1977-09-05',
    where: 'Interstellar space',
    about: 'The most distant human-made object. It flew past Jupiter and Saturn, then kept going — out through the edge of the Sun\'s bubble in 2012. Its plutonium power is fading, so instruments are being switched off one by one.',
    news: ['Voyager 1'],
    milestones: [
      { date: '1979-03-05', label: 'Flew past Jupiter' },
      { date: '1980-11-12', label: 'Flew past Saturn and Titan' },
      { date: '2012-08-25', label: 'Crossed the heliopause into interstellar space' },
    ],
  },
  {
    slug: 'voyager-2',
    name: 'Voyager 2',
    short: 'VGR2',
    agency: 'NASA',
    horizons: -32,
    launched: '1977-08-20',
    where: 'Interstellar space',
    about: 'The only spacecraft to visit Uranus and Neptune. It left the Sun\'s bubble in 2018, heading south of the planets\' plane — only the big dish in Australia can still talk to it.',
    news: ['Voyager 2'],
    milestones: [
      { date: '1986-01-24', label: 'Flew past Uranus' },
      { date: '1989-08-25', label: 'Flew past Neptune' },
      { date: '2018-11-05', label: 'Entered interstellar space' },
    ],
  },
  {
    slug: 'new-horizons',
    name: 'New Horizons',
    short: 'NHPC',
    agency: 'NASA',
    horizons: -98,
    launched: '2006-01-19',
    where: 'Kuiper Belt',
    about: 'Gave us the first close look at Pluto, then the snowman-shaped Arrokoth. Now crossing the Kuiper Belt — the icy leftovers beyond Neptune.',
    news: ['New Horizons'],
    milestones: [
      { date: '2015-07-14', label: 'Flew past Pluto and Charon' },
      { date: '2019-01-01', label: 'Flew past Arrokoth' },
    ],
  },
  {
    slug: 'parker-solar-probe',
    name: 'Parker Solar Probe',
    short: 'SPP',
    agency: 'NASA',
    horizons: -96,
    launched: '2018-08-12',
    where: 'Diving through the Sun\'s corona',
    about: 'The fastest object ever built. Every 88 days it swoops through the Sun\'s outer atmosphere behind a carbon heat shield, sampling the solar wind where it is born.',
    news: ['Parker Solar Probe'],
    milestones: [{ date: '2024-12-24', label: 'Record pass: 6.1 million km from the Sun\'s surface at 192 km/s' }],
  },
  {
    slug: 'bepicolombo',
    name: 'BepiColombo',
    short: 'BEPI',
    agency: 'ESA / JAXA',
    horizons: -121,
    launched: '2018-10-20',
    where: 'Arriving at Mercury',
    about: 'Two orbiters stacked together, one European and one Japanese. After eight years and nine planetary flybys it is finally slipping into orbit around Mercury.',
    news: ['BepiColombo'],
    milestones: [
      { date: '2026-09-03', label: 'Dropped its transfer module and began arriving' },
      { date: '2026-11-21', label: 'Enters orbit around Mercury' },
      { date: '2026-12-09', label: 'The two orbiters separate' },
      { date: '2027-04', label: 'Science operations begin' },
    ],
  },
  {
    slug: 'hera',
    name: 'Hera',
    short: 'HERA',
    agency: 'ESA',
    horizons: -91,
    launched: '2024-10-07',
    where: 'Arriving at asteroid Didymos',
    about: 'Planetary defence: in 2022 NASA\'s DART crashed into the small moonlet Dimorphos to nudge its orbit. Hera is going back to measure exactly what the impact did.',
    news: ['Hera', 'Didymos', 'Dimorphos'],
    milestones: [
      { date: '2025-03-12', label: 'Flew past Mars and its moon Deimos' },
      { date: '2026-11', label: 'Arrives at Didymos and Dimorphos' },
    ],
  },
  {
    slug: 'europa-clipper',
    name: 'Europa Clipper',
    short: 'EURC',
    agency: 'NASA',
    horizons: -159,
    launched: '2024-10-14',
    where: 'Cruising to Jupiter',
    about: 'NASA\'s biggest planetary spacecraft, heading for Jupiter\'s moon Europa and the salty ocean under its ice — to find out whether it could support life.',
    news: ['Europa Clipper'],
    milestones: [
      { date: '2025-03-01', label: 'Mars gravity assist' },
      { date: '2026-12', label: 'Earth gravity assist' },
      { date: '2030-04', label: 'Arrives at Jupiter' },
    ],
  },
  {
    slug: 'juice',
    name: 'Juice',
    short: 'JUICE',
    agency: 'ESA',
    horizons: -28,
    launched: '2023-04-14',
    where: 'Cruising to Jupiter',
    about: 'JUpiter ICy moons Explorer. It will study Ganymede, Callisto and Europa, then become the first spacecraft to orbit a moon other than our own.',
    news: ['Juice', 'JUICE'],
    milestones: [
      { date: '2024-08-20', label: 'Moon–Earth double flyby' },
      { date: '2025-08-31', label: 'Venus flyby' },
      { date: '2026-09', label: 'Earth flyby' },
      { date: '2029-01', label: 'Final Earth flyby' },
      { date: '2031-07', label: 'Arrives at Jupiter' },
    ],
  },
  {
    slug: 'psyche',
    name: 'Psyche',
    short: 'PSYC',
    agency: 'NASA',
    horizons: -255,
    launched: '2023-10-13',
    where: 'Cruising to asteroid Psyche',
    about: 'Heading for a metal-rich asteroid that may be the exposed core of a shattered baby planet. Pushed gently by electric ion thrusters glowing blue.',
    news: ['Psyche'],
    milestones: [
      { date: '2026-05', label: 'Mars gravity assist' },
      { date: '2029-08', label: 'Arrives at asteroid Psyche' },
    ],
  },
  {
    slug: 'lucy',
    name: 'Lucy',
    short: 'LUCY',
    agency: 'NASA',
    horizons: -49,
    launched: '2021-10-16',
    where: 'Heading for the Trojan asteroids',
    about: 'A 12-year tour of the Trojans — fossils of planet formation that share Jupiter\'s orbit. Named after the fossil skeleton that told us about human origins.',
    news: ['Lucy'],
    milestones: [
      { date: '2023-11-01', label: 'Flew past Dinkinesh (and found a moon)' },
      { date: '2025-04-20', label: 'Flew past Donaldjohanson' },
      { date: '2027-08', label: 'First Trojans: Eurybates and its moon Queta' },
      { date: '2033-03', label: 'The double Trojan Patroclus–Menoetius' },
    ],
  },
  {
    slug: 'osiris-apex',
    name: 'OSIRIS-APEX',
    short: 'ORX',
    agency: 'NASA',
    horizons: -64,
    launched: '2016-09-08',
    where: 'Cruising to asteroid Apophis',
    about: 'The spacecraft that brought asteroid Bennu back to Earth, given a second job: meeting Apophis just after it passes closer to Earth than our TV satellites in 2029.',
    news: ['OSIRIS-APEX', 'Apophis'],
    milestones: [
      { date: '2023-09-24', label: 'Delivered its Bennu sample to Earth (as OSIRIS-REx)' },
      { date: '2029-04', label: 'Arrives at asteroid Apophis' },
    ],
  },
];

export const bySlug = (slug) => MISSIONS.find((m) => m.slug === slug);
export const byHorizonsId = (id) => MISSIONS.find((m) => m.horizons === Number(id));

/** A milestone date as a time (ms) — month-only dates count from the 15th — plus whether it's exact. */
export function milestoneTime({ date }) {
  const [y, m, d] = String(date).split('-').map(Number);
  return { t: Date.UTC(y, m - 1, d || 15), exact: Boolean(d) };
}
