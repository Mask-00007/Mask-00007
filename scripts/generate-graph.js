#!/usr/bin/env node
/**
 * Renders a contribution heatmap SVG from the GitHub GraphQL API.
 * No dependencies — Node 18+ (global fetch).
 *
 * Env:
 *   GH_USER   GitHub login to render
 *   GH_TOKEN  token with read access (Actions' github.token works for public data)
 *   OUT_PATH  output file (default: assets/activity-graph.svg)
 */

const fs = require('node:fs');
const path = require('node:path');

const USER = process.env.GH_USER;
const TOKEN = process.env.GH_TOKEN;
const OUT = process.env.OUT_PATH || 'assets/activity-graph.svg';

if (!USER || !TOKEN) {
  console.error('GH_USER and GH_TOKEN are required.');
  process.exit(1);
}

// ---------------------------------------------------------------- design tokens
const T = {
  bg: '#0D1117',
  panel: '#0D1117',
  border: '#241C3D',
  chrome: '#161125',
  text: '#C9D1D9',
  dim: '#6E7681',
  accent: '#A78BFA',
  ramp: ['#161B22', '#2E2359', '#553BAC', '#8B5CF6', '#C4B5FD'],
  mono: "ui-monospace, 'SF Mono', SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace",
};

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const PAD = 22;
const DAY_GUTTER = 30;
const CHROME_H = 40;
const MONTH_H = 18;
const FOOTER_H = 34;

// ---------------------------------------------------------------- data
const QUERY = `query($login:String!){
  user(login:$login){
    contributionsCollection{
      contributionCalendar{
        totalContributions
        weeks{ contributionDays{ date contributionCount weekday } }
      }
    }
  }
}`;

async function fetchCalendar() {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'activity-graph-generator',
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);

  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  if (!json.data?.user) throw new Error(`No such user: ${USER}`);

  return json.data.user.contributionsCollection.contributionCalendar;
}

// ---------------------------------------------------------------- helpers
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])
  );

function levelFor(count, cap) {
  if (count <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / cap) * 4)));
}

function streaks(days) {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    if (run > longest) longest = run;
  }

  // Today may still be in progress, so an empty final day doesn't break the run.
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i -= 1;
  let current = 0;
  while (i >= 0 && days[i].contributionCount > 0) {
    current += 1;
    i -= 1;
  }

  return { current, longest };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (iso) => Number(iso.slice(5, 7)) - 1;

// ---------------------------------------------------------------- render
function render(cal) {
  const weeks = cal.weeks;
  const days = weeks.flatMap((w) => w.contributionDays);

  const busy = days.filter((d) => d.contributionCount > 0).map((d) => d.contributionCount).sort((a, b) => a - b);
  const cap = Math.max(4, busy.length ? busy[Math.floor(busy.length * 0.9)] : 4);

  const { current, longest } = streaks(days);
  const activeDays = busy.length;

  const gridW = weeks.length * STEP - GAP;
  const gridH = 7 * STEP - GAP;
  const gridX = PAD + DAY_GUTTER;
  const gridY = CHROME_H + 14 + MONTH_H;

  const W = gridX + gridW + PAD;
  const H = gridY + gridH + 18 + FOOTER_H;

  // cells
  const cells = [];
  weeks.forEach((week, wi) => {
    week.contributionDays.forEach((day) => {
      const x = gridX + wi * STEP;
      const y = gridY + day.weekday * STEP;
      const lvl = levelFor(day.contributionCount, cap);
      cells.push(
        `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${T.ramp[lvl]}">` +
          `<title>${esc(day.date)} — ${day.contributionCount} contribution${day.contributionCount === 1 ? '' : 's'}</title>` +
          `</rect>`
      );
    });
  });

  // month labels
  const monthLabels = [];
  let seen = -1;
  weeks.forEach((week, wi) => {
    const first = week.contributionDays[0];
    if (!first) return;
    const m = monthOf(first.date);
    if (m !== seen && wi < weeks.length - 1) {
      seen = m;
      monthLabels.push(
        `<text x="${gridX + wi * STEP}" y="${gridY - 8}" class="tick">${MONTHS[m]}</text>`
      );
    }
  });

  const dayLabels = [
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ]
    .map(
      ([wd, label]) =>
        `<text x="${PAD + DAY_GUTTER - 8}" y="${gridY + wd * STEP + CELL - 2}" class="tick" text-anchor="end">${label}</text>`
    )
    .join('');

  // footer stats
  const stat = (x, value, label) =>
    `<text x="${x}" y="${H - FOOTER_H + 18}" class="figure">${esc(value)}</text>` +
    `<text x="${x}" y="${H - FOOTER_H + 30}" class="label">${esc(label)}</text>`;

  const legend = T.ramp
    .map(
      (c, i) =>
        `<rect x="${W - PAD - 24 - (5 - i) * (CELL + 2)}" y="${H - FOOTER_H + 10}" width="${CELL}" height="${CELL}" rx="2.5" fill="${c}"/>`
    )
    .join('');

  const stamp = new Date().toISOString().slice(0, 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(USER)} contribution graph">
  <style>
    text { font-family: ${T.mono}; }
    .prompt { font-size: 12px; fill: ${T.dim}; }
    .cmd    { font-size: 12px; fill: ${T.accent}; }
    .tick   { font-size: 9px;  fill: ${T.dim}; }
    .figure { font-size: 13px; fill: ${T.text}; }
    .label  { font-size: 8.5px; fill: ${T.dim}; letter-spacing: .04em; }
  </style>

  <rect width="${W}" height="${H}" rx="10" fill="${T.bg}" stroke="${T.border}"/>
  <path d="M0 10a10 10 0 0 1 10-10h${W - 20}a10 10 0 0 1 10 10v${CHROME_H - 10}H0Z" fill="${T.chrome}"/>
  <line x1="0" y1="${CHROME_H}" x2="${W}" y2="${CHROME_H}" stroke="${T.border}"/>
  <circle cx="20" cy="${CHROME_H / 2}" r="4.5" fill="#3D3356"/>
  <circle cx="36" cy="${CHROME_H / 2}" r="4.5" fill="#4C3E77"/>
  <circle cx="52" cy="${CHROME_H / 2}" r="4.5" fill="${T.accent}" opacity=".7"/>
  <text x="70" y="${CHROME_H / 2 + 4}" class="prompt">${esc(USER)} ~ <tspan class="cmd">contributions --last 365d</tspan></text>

  ${monthLabels.join('\n  ')}
  ${dayLabels}
  ${cells.join('\n  ')}

  <line x1="${PAD}" y1="${H - FOOTER_H - 2}" x2="${W - PAD}" y2="${H - FOOTER_H - 2}" stroke="${T.border}"/>
  ${stat(PAD, cal.totalContributions.toLocaleString('en-US'), 'contributions')}
  ${stat(PAD + 120, String(current), 'day streak')}
  ${stat(PAD + 220, String(longest), 'longest run')}
  ${stat(PAD + 330, String(activeDays), 'active days')}
  <text x="${W - PAD - 24 - 5 * (CELL + 2) - 8}" y="${H - FOOTER_H + 19}" class="label" text-anchor="end">less</text>
  ${legend}
  <text x="${W - PAD}" y="${H - FOOTER_H + 19}" class="label" text-anchor="end">more</text>
  <text x="${W - PAD}" y="${H - FOOTER_H + 31}" class="label" text-anchor="end">updated ${stamp}</text>
</svg>
`;
}

// ---------------------------------------------------------------- main
(async () => {
  const cal = await fetchCalendar();
  const svg = render(cal);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, svg);
  console.log(`Wrote ${OUT} — ${cal.totalContributions} contributions.`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
