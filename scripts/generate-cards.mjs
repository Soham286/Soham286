// Draws the profile's stats cards as SVG files in assets/cards, from public GitHub data.
// Run: GH_TOKEN=<token> node scripts/generate-cards.mjs   Self-check: node scripts/generate-cards.mjs --self-test
// If anything fails it exits before writing, so the previous cards stay in place.

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

const USER = process.env.GH_USER || "Soham286";
const OUT = "assets/cards";
const BG = "#0d1117";
const BORDER = "#30363d";
const TEXT = "#e6edf3";
const MUTED = "#8b949e";
const ACCENT = "#ff4d2e";
const LEVELS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"]; // GitHub's own dark-mode greens
const FONT = "font-family='Segoe UI, Helvetica, Arial, sans-serif'";

const QUERY = `query($login: String!) {
  user(login: $login) {
    repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
      totalCount
      nodes { languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
    }
    contributionsCollection {
      totalCommitContributions
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const card = (w, h, title, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${BG}" stroke="${BORDER}"/>
<text x="24" y="38" ${FONT} font-size="17" font-weight="600" fill="${ACCENT}">${esc(title)}</text>
${body}
</svg>
`;

/** Current and longest runs of days with at least one contribution. Today may still be empty. */
export function streaks(days) {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--; // a quiet today doesn't break the streak yet
  for (; i >= 0 && days[i].count > 0; i--) current++;
  return { current, longest };
}

/** Byte share of each language across repos, largest first, top n plus "Other". */
export function languageShares(repos, n = 6) {
  const totals = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      // shortcut: notebooks are skipped because saved outputs inflate their size; revisit if notebooks become your main work.
      if (node.name === "Jupyter Notebook") continue;
      const prev = totals.get(node.name) ?? { size: 0, color: node.color ?? MUTED };
      totals.set(node.name, { size: prev.size + size, color: prev.color });
    }
  }
  const all = [...totals].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.size - a.size);
  const sum = all.reduce((s, l) => s + l.size, 0) || 1;
  const top = all.slice(0, n);
  const rest = all.slice(n).reduce((s, l) => s + l.size, 0);
  if (rest > 0) top.push({ name: "Other", size: rest, color: MUTED });
  return top.map((l) => ({ ...l, pct: (l.size / sum) * 100 }));
}

/** Colour level 0-4 for a day, from quartiles of the non-zero days. */
export function level(count, nonZero) {
  if (count === 0) return 0;
  const q = (p) => nonZero[Math.floor(p * (nonZero.length - 1))];
  return count <= q(0.25) ? 1 : count <= q(0.5) ? 2 : count <= q(0.75) ? 3 : 4;
}

function statsCard(u) {
  const c = u.contributionsCollection;
  const days = c.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  // Stars, followers and PRs are left out while they're near zero; add them back when they grow.
  const rows = [
    ["Contributions (last year)", c.contributionCalendar.totalContributions],
    ["Commits (last year)", c.totalCommitContributions],
    ["Active days (last year)", days.filter((d) => d.contributionCount > 0).length],
    ["Public repositories", u.repositories.totalCount],
    ["Languages used", languageShares(u.repositories.nodes, Infinity).length],
  ];
  const body = rows
    .map(
      ([label, value], i) =>
        `<text x="24" y="${74 + i * 26}" ${FONT} font-size="14" fill="${MUTED}">${esc(label)}</text>` +
        `<text x="386" y="${74 + i * 26}" ${FONT} font-size="14" font-weight="600" fill="${TEXT}" text-anchor="end">${value}</text>`,
    )
    .join("\n");
  return card(410, 210, "GitHub stats", body);
}

function streakCard(days) {
  const { current, longest } = streaks(days);
  const col = (x, value, label) =>
    `<text x="${x}" y="122" ${FONT} font-size="40" font-weight="700" fill="${TEXT}" text-anchor="middle">${value}</text>` +
    `<text x="${x}" y="152" ${FONT} font-size="13" fill="${MUTED}" text-anchor="middle">${esc(label)}</text>`;
  const total = days.reduce((s, d) => s + d.count, 0);
  const body = [col(78, current, "Current streak"), col(205, longest, "Longest streak"), col(332, total, "Past 12 months")].join("\n") +
    `<text x="205" y="186" ${FONT} font-size="12" fill="${MUTED}" text-anchor="middle">Streaks in days, totals in contributions</text>`;
  return card(410, 210, "Contribution streak", body);
}

function languagesCard(repos) {
  const langs = languageShares(repos);
  let x = 24;
  const bar = langs
    .map((l) => {
      const w = (l.pct / 100) * 362;
      const r = `<rect x="${x.toFixed(1)}" y="56" width="${w.toFixed(1)}" height="10" fill="${esc(l.color)}"/>`;
      x += w;
      return r;
    })
    .join("");
  const legend = langs
    .map((l, i) => {
      const lx = i % 2 === 0 ? 24 : 215;
      const ly = 96 + Math.floor(i / 2) * 26;
      return (
        `<circle cx="${lx + 5}" cy="${ly - 5}" r="5" fill="${esc(l.color)}"/>` +
        `<text x="${lx + 16}" y="${ly}" ${FONT} font-size="13" fill="${TEXT}">${esc(l.name)} <tspan fill="${MUTED}">${l.pct.toFixed(1)}%</tspan></text>`
      );
    })
    .join("\n");
  return card(410, 210, "Most used languages", `<clipPath id="b"><rect x="24" y="56" width="362" height="10" rx="5"/></clipPath><g clip-path="url(#b)">${bar}</g>\n${legend}`);
}

function activityCard(days) {
  const last = days.slice(-30);
  const max = Math.max(1, ...last.map((d) => d.count));
  const bw = 362 / last.length;
  const bars = last
    .map((d, i) => {
      const h = (d.count / max) * 110;
      return `<rect x="${(24 + i * bw + 1).toFixed(1)}" y="${(170 - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="2" fill="${d.count ? ACCENT : BORDER}"><title>${d.date}: ${d.count}</title></rect>`;
    })
    .join("");
  const axis = `<text x="24" y="190" ${FONT} font-size="11" fill="${MUTED}">${last[0].date}</text><text x="386" y="190" ${FONT} font-size="11" fill="${MUTED}" text-anchor="end">${last.at(-1).date}</text>`;
  return card(410, 210, "Daily contributions, last 30 days", bars + axis);
}

function heatmapCard(weeks) {
  const nonZero = weeks.flat().map((d) => d.count).filter(Boolean).sort((a, b) => a - b);
  const s = 13;
  const cells = weeks
    .map((week, wi) =>
      week
        .map((d) => `<rect x="${24 + wi * s}" y="${56 + new Date(d.date).getUTCDay() * s}" width="${s - 3}" height="${s - 3}" rx="2" fill="${LEVELS[level(d.count, nonZero)]}"><title>${d.date}: ${d.count}</title></rect>`)
        .join(""),
    )
    .join("\n");
  const w = 48 + weeks.length * s;
  const legend = LEVELS.map((c, i) => `<rect x="${w - 24 - (5 - i) * s}" y="160" width="${s - 3}" height="${s - 3}" rx="2" fill="${c}"/>`).join("");
  const labels = `<text x="${w - 30 - 5 * s}" y="169" ${FONT} font-size="11" fill="${MUTED}" text-anchor="end">Less</text><text x="${w - 20}" y="169" ${FONT} font-size="11" fill="${MUTED}">More</text>`;
  return card(w + 20, 186, "Contribution calendar, last 12 months", cells + legend + labels);
}

async function fetchUser() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("Set GH_TOKEN to a GitHub token.");
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-cards" },
        body: JSON.stringify({ query: QUERY, variables: { login: USER } }),
      });
      const json = await res.json();
      if (!res.ok || json.errors || !json.data?.user) throw new Error(JSON.stringify(json.errors ?? json).slice(0, 300));
      return json.data.user;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

function selfTest() {
  const d = (...counts) => counts.map((count, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, count }));
  assert.deepEqual(streaks(d(1, 1, 0, 2, 3, 1)), { current: 3, longest: 3 });
  assert.deepEqual(streaks(d(1, 1, 1, 0, 1, 0)), { current: 1, longest: 3 }, "quiet today keeps yesterday's streak");
  assert.deepEqual(streaks(d(1, 0, 0)), { current: 0, longest: 1 });
  assert.deepEqual(streaks([]), { current: 0, longest: 0 });
  const repo = (...langs) => ({ languages: { edges: langs.map(([name, size]) => ({ size, node: { name, color: "#000" } })) } });
  const shares = languageShares([repo(["Python", 60], ["HTML", 20]), repo(["Python", 20])], 1);
  assert.deepEqual(shares.map((l) => [l.name, Math.round(l.pct)]), [["Python", 80], ["Other", 20]]);
  assert.equal(level(0, [1, 2, 3, 4]), 0);
  assert.equal(level(4, [1, 2, 3, 4]), 4);
  assert.match(card(10, 10, "a<b", ""), /a&#60;b/, "titles are escaped");
  console.log("self-test passed");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const u = await fetchUser();
  const weeks = u.contributionsCollection.contributionCalendar.weeks.map((w) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })),
  );
  const days = weeks.flat();
  const files = {
    "stats.svg": statsCard(u),
    "streak.svg": streakCard(days),
    "languages.svg": languagesCard(u.repositories.nodes),
    "activity.svg": activityCard(days),
    "heatmap.svg": heatmapCard(weeks),
  };
  mkdirSync(OUT, { recursive: true });
  for (const [name, svg] of Object.entries(files)) writeFileSync(`${OUT}/${name}`, svg);
  console.log(`Wrote ${Object.keys(files).length} cards to ${OUT}`);
}
