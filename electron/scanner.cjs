/*
 * Pure project scanner — no Electron dependency, so it can be unit-tested
 * directly with Node. The main process wires these functions to IPC.
 *
 * Privacy guarantees baked in here:
 *  - Never traverses outside the directory it is given.
 *  - Skips dependency/cache/system dirs (SKIP_DIRS) and hidden dirs.
 *  - Caps how much of any file it reads and how many files it scans.
 */
const path = require('node:path');
const fsp = require('node:fs/promises');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'release',
  '.next', '.nuxt', '.expo', '.cache', '.turbo', '.parcel-cache', 'coverage',
  'vendor', 'venv', '.venv', 'env', '__pycache__', '.idea', '.vscode',
  'target', 'Pods', 'DerivedData', '.gradle', 'bin', 'obj', '.terraform',
  'bower_components', '.pnpm-store', 'tmp', 'temp',
]);

/** Common sub-folder names that are parts of a project, not projects in their
 *  own right. Skipped as top-level candidates unless they carry a real marker. */
const NON_PROJECT_NAMES = new Set([
  'src', 'app', 'lib', 'libs', 'public', 'assets', 'static', 'components',
  'pages', 'styles', 'images', 'img', 'fonts', 'docs', 'doc', 'examples',
  'scripts', 'test', 'tests', '__tests__', 'spec', 'utils', 'hooks', 'api',
]);

const PROJECT_MARKERS = [
  '.git', 'package.json', 'requirements.txt', 'pyproject.toml', 'go.mod',
  'Cargo.toml', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json',
  'pubspec.yaml', 'Package.swift', 'CMakeLists.txt', 'app.json',
];

const MAX_FILE_BYTES = 256 * 1024;
const MAX_TODO_FILES = 400;

/** Source extensions -> human language label. Used both to recognise a folder
 *  as a real (possibly marker-less) coding project and to label its tools. */
const CODE_EXTS = {
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.py': 'Python', '.go': 'Go',
  '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby', '.php': 'PHP',
  '.swift': 'Swift', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++',
  '.cs': 'C#', '.lua': 'Lua', '.vue': 'Vue', '.svelte': 'Svelte', '.dart': 'Dart',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'CSS', '.sh': 'Shell', '.sql': 'SQL',
};

async function readSmall(file) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return '';
    return await fsp.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function safeJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

async function detectTools(dir, files) {
  const tools = new Set();
  const has = (n) => files.includes(n);

  if (has('package.json')) {
    const pkg = safeJson(await readSmall(path.join(dir, 'package.json')));
    if (pkg) {
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const map = {
        react: 'React', next: 'Next.js', vue: 'Vue', svelte: 'Svelte',
        '@angular/core': 'Angular', express: 'Express', fastify: 'Fastify',
        electron: 'Electron', '@tauri-apps/api': 'Tauri', 'react-native': 'React Native',
        expo: 'Expo', vite: 'Vite', tailwindcss: 'Tailwind', typescript: 'TypeScript',
        '@supabase/supabase-js': 'Supabase', firebase: 'Firebase', prisma: 'Prisma',
        stripe: 'Stripe', '@anthropic-ai/sdk': 'Claude API', openai: 'OpenAI',
        mongoose: 'MongoDB', pg: 'Postgres', three: 'Three.js',
      };
      for (const [dep, label] of Object.entries(map)) if (deps[dep]) tools.add(label);
      tools.add('Node.js');
    }
  }
  if (has('requirements.txt') || has('pyproject.toml')) tools.add('Python');
  if (has('go.mod')) tools.add('Go');
  if (has('Cargo.toml')) tools.add('Rust');
  if (has('pom.xml') || has('build.gradle')) tools.add('Java');
  if (has('Gemfile')) tools.add('Ruby');
  if (has('composer.json')) tools.add('PHP');
  if (has('pubspec.yaml')) tools.add('Flutter');
  if (has('Dockerfile') || has('docker-compose.yml')) tools.add('Docker');

  return [...tools];
}

async function detectHosting(dir, files) {
  if (files.includes('vercel.json') || files.includes('.vercel')) return 'Vercel';
  if (files.includes('netlify.toml')) return 'Netlify';
  if (files.includes('fly.toml')) return 'Fly.io';
  if (files.includes('render.yaml')) return 'Render';
  if (files.includes('Dockerfile')) return 'Docker';
  if (files.includes('app.json') && files.includes('eas.json')) return 'Expo EAS';

  const cfg = await readSmall(path.join(dir, '.git', 'config'));
  const m = cfg.match(/url\s*=\s*(\S+)/);
  if (m) {
    const url = m[1];
    if (url.includes('github.com')) return 'GitHub';
    if (url.includes('gitlab.com')) return 'GitLab';
    if (url.includes('bitbucket.org')) return 'Bitbucket';
    return 'Git remote';
  }
  return 'Local only';
}

async function recentMtime(dir, depth = 0) {
  let newest = 0;
  if (depth > 3) return newest;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return newest; }
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.git') continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    try {
      if (ent.isDirectory()) {
        newest = Math.max(newest, await recentMtime(full, depth + 1));
      } else if (ent.isFile()) {
        const st = await fsp.stat(full);
        newest = Math.max(newest, st.mtimeMs);
      }
    } catch { /* ignore */ }
  }
  return newest;
}

/**
 * Single pass over a project's source: counts TODO-style markers, counts code
 * files, and records which languages are present. One walk does all three.
 */
async function scanSource(dir) {
  let todos = 0;
  let codeFiles = 0;
  let scanned = 0;
  const langs = new Set();
  const re = /\b(TODO|FIXME|HACK|XXX|WIP)\b/g;

  async function walk(d, depth) {
    if (depth > 4 || scanned >= MAX_TODO_FILES) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (scanned >= MAX_TODO_FILES) return;
      if (ent.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(ent.name)) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else {
        const ext = path.extname(ent.name).toLowerCase();
        const lang = CODE_EXTS[ext];
        if (!lang) continue;
        codeFiles++;
        if (lang !== 'HTML' && lang !== 'CSS') langs.add(lang);
        else langs.add(lang);
        scanned++;
        const txt = await readSmall(full);
        const matches = txt.match(re);
        if (matches) todos += matches.length;
      }
    }
  }
  await walk(dir, 0);
  return { todos, codeFiles, langs: [...langs] };
}

/** Cheap shallow check: does this folder contain real source code? */
async function hasCode(dir) {
  let found = 0;
  async function walk(d, depth) {
    if (depth > 2 || found >= 2) return;
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (found >= 2) return;
      if (ent.name.startsWith('.') || SKIP_DIRS.has(ent.name)) continue;
      if (ent.isDirectory()) {
        await walk(path.join(d, ent.name), depth + 1);
      } else if (CODE_EXTS[path.extname(ent.name).toLowerCase()]) {
        found++;
      }
    }
  }
  await walk(dir, 0);
  return found >= 2;
}

async function analyseProject(dir) {
  let files;
  try { files = await fsp.readdir(dir, { withFileTypes: true }); } catch { return null; }
  const fileNames = files.filter((f) => f.isFile()).map((f) => f.name);
  const dirNames = files.filter((f) => f.isDirectory()).map((f) => f.name);
  const all = [...fileNames, ...dirNames];

  const hasGit = dirNames.includes('.git');
  const readmeName = fileNames.find((n) => /^readme(\.md|\.txt)?$/i.test(n));
  const readme = readmeName ? await readSmall(path.join(dir, readmeName)) : '';
  let tools = await detectTools(dir, all);
  const hosting = await detectHosting(dir, all);
  const mtime = await recentMtime(dir);
  const { todos, codeFiles, langs } = await scanSource(dir);

  // If no framework/manifest tools were found, fall back to the raw languages
  // so even a marker-less vibe-coded folder shows something meaningful.
  if (tools.length === 0) tools = langs.slice(0, 5);

  const hasDeployConfig =
    all.includes('vercel.json') || all.includes('netlify.toml') ||
    all.includes('Dockerfile') || all.includes('fly.toml') || all.includes('render.yaml');
  const hasReadme = readme.trim().length > 120;
  const hasTests = dirNames.some((d) => /tests?|__tests__|spec/i.test(d)) ||
    fileNames.some((f) => /\.(test|spec)\./i.test(f));

  const daysSince = mtime ? (Date.now() - mtime) / 86400000 : 9999;

  let score = 0;
  if (hasReadme) score += 22;
  if (hasGit) score += 14;
  if (tools.length > 0) score += 12;
  if (hasDeployConfig) score += 22;
  if (hosting !== 'Local only') score += 12;
  if (hasTests) score += 10;
  score -= Math.min(20, todos * 1.5);
  if (daysSince < 7) score -= 6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let suggested = 'unfinished';
  let reason = 'Looks actively in progress.';
  if (score >= 70 && hasDeployConfig && hasReadme) {
    suggested = 'finished';
    reason = 'Has a README, deploy config and a clean setup — looks shipped.';
  } else if (daysSince > 120 && score < 45) {
    suggested = 'dropped';
    reason = `Untouched for ${Math.round(daysSince)} days and looks incomplete.`;
  } else if (todos > 6) {
    reason = `${todos} TODO/FIXME markers — still has open work.`;
  } else if (!hasReadme) {
    reason = 'No real README yet — early stage.';
  }

  return {
    path: dir,
    name: path.basename(dir),
    tools,
    hosting,
    lastModified: mtime || null,
    todos,
    hasReadme,
    hasTests,
    hasGit,
    completion: score,
    suggestedStatus: suggested,
    suggestedReason: reason,
    readmeExcerpt: readme.trim().slice(0, 280),
  };
}

async function isProject(dir) {
  let entries;
  try { entries = await fsp.readdir(dir); } catch { return false; }
  const hasMarker = PROJECT_MARKERS.some((m) => entries.includes(m)) ||
    entries.some((e) => e.endsWith('.csproj') || e.endsWith('.sln'));
  if (hasMarker) return true;
  // No standard marker (common for vibe-coded folders): accept it if it
  // actually contains source code, so we still surface it.
  return hasCode(dir);
}

/** Scan a root for projects, never escaping it. */
async function scanProjects(root) {
  const resolved = path.resolve(root);
  const st = await fsp.stat(resolved); // throws if missing
  if (!st.isDirectory()) throw new Error('Not a directory');

  const results = [];

  if (await isProject(resolved)) {
    const r = await analyseProject(resolved);
    if (r) results.push(r);
  }

  let children;
  try { children = await fsp.readdir(resolved, { withFileTypes: true }); } catch { children = []; }
  for (const ent of children) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.') || SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(resolved, ent.name);
    if (!full.startsWith(resolved)) continue; // hard guard
    // Skip generic sub-folders (src, app, …) unless they have their own marker.
    if (NON_PROJECT_NAMES.has(ent.name.toLowerCase())) {
      const entries = await fsp.readdir(full).catch(() => []);
      const ownMarker = PROJECT_MARKERS.some((m) => entries.includes(m));
      if (!ownMarker) continue;
    }
    if (await isProject(full)) {
      const r = await analyseProject(full);
      if (r) results.push(r);
    }
  }

  return { root: resolved, projects: results };
}

module.exports = { scanProjects, analyseProject, isProject, SKIP_DIRS, PROJECT_MARKERS };
