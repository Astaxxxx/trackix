import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Search, RefreshCw, Trash2, ShieldCheck, Settings as SettingsIcon, Megaphone, Eye, Orbit } from 'lucide-react';
import type { DB, Project, ScanResult, Status, Settings, AiConfig } from './types';
import { DEFAULT_SETTINGS } from './types';

/** Build the AI backend config from settings (null = AI off). */
function aiConfig(s: Settings): AiConfig | null {
  if (!s.aiEnabled) return null;
  return s.aiProvider === 'claude'
    ? { provider: 'claude', model: s.claudeModel, apiKey: s.claudeApiKey }
    : { provider: 'ollama', model: s.aiModel };
}
import { api } from './api';
import { uid, normPath } from './util';
import ProjectCard from './components/ProjectCard';
import ProjectDetail from './components/ProjectDetail';
import AddProjectModal from './components/AddProjectModal';
import SettingsModal from './components/SettingsModal';
import ShareCard from './components/ShareCard';
import RevivalModal from './components/RevivalModal';
import OracleModal from './components/OracleModal';
import CosmosModal from './components/CosmosModal';
import HeroMascot from './components/HeroMascot';
import { TrackixMark, BgSpiral } from './components/Marks';
import { Mascot, AstaxLogo } from './components/Assets';

const COLUMNS: { key: Status; title: string }[] = [
  { key: 'unfinished', title: 'In Progress' },
  { key: 'finished', title: 'Finished' },
  { key: 'dropped', title: 'Dropped' },
];

/** Small animated count-up for the stat numbers. */
function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const dur = 600;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(from + (value - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [lastRoot, setLastRoot] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [oracleOpen, setOracleOpen] = useState(false);
  const [cosmosOpen, setCosmosOpen] = useState(false);
  const [revivingId, setRevivingId] = useState<string | null>(null);

  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const trashRef = useRef<HTMLDivElement | null>(null);
  const [trashHot, setTrashHot] = useState(false);
  const [hoverCol, setHoverCol] = useState<Status | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  /* ---- keyboard: Esc closes, Ctrl/Cmd+K focuses search ---- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenId(null); setAdding(false); setSettingsOpen(false); setShareOpen(false);
        setOracleOpen(false); setRevivingId(null); setCosmosOpen(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---- load once ---- */
  useEffect(() => {
    (async () => {
      const db = await api.loadDB();
      if (db) {
        setProjects(db.projects || []);
        setLastRoot(db.lastRoot);
        // Buddy is strictly opt-in — no migration ever flips it on.
        setSettings({ ...DEFAULT_SETTINGS, ...(db.settings || {}) });
      }
      setLoaded(true);
    })();
  }, []);

  /* ---- persist on change (after first load) ---- */
  useEffect(() => {
    if (!loaded) return;
    const db: DB = { version: 2, projects, lastRoot, settings };
    api.saveDB(db);
  }, [projects, lastRoot, settings, loaded]);

  /* ---- desktop buddy: mirror the setting to the floating window ---- */
  useEffect(() => {
    if (!loaded) return;
    api.setBuddy(settings.buddyEnabled);
  }, [settings.buddyEnabled, loaded]);

  /* ---- launch-on-startup: register/clear the OS login item ---- */
  useEffect(() => {
    if (!loaded) return;
    // Startup only makes sense while the buddy is enabled.
    api.setBuddyStartup(settings.buddyEnabled && settings.buddyStartup);
  }, [settings.buddyEnabled, settings.buddyStartup, loaded]);

  /* ---- if the buddy is dismissed from its own × button, reflect it here ---- */
  useEffect(() => api.onBuddyDismissed(() => setSettings((s) => ({ ...s, buddyEnabled: false, buddyStartup: false }))), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.tools.some((t) => t.toLowerCase().includes(q)) ||
      p.why.toLowerCase().includes(q));
  }, [projects, query]);

  const byStatus = (s: Status) => filtered.filter((p) => p.status === s);
  const counts = {
    unfinished: projects.filter((p) => p.status === 'unfinished').length,
    finished: projects.filter((p) => p.status === 'finished').length,
    dropped: projects.filter((p) => p.status === 'dropped').length,
  };

  /* ---- mutations ---- */
  function patch(id: string, p: Partial<Project>) {
    setProjects((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }
  function remove(id: string) {
    setProjects((prev) => prev.filter((x) => x.id !== id));
    if (openId === id) setOpenId(null);
  }
  function clearAll() {
    setProjects([]);
    setOpenId(null);
    setLastRoot(undefined);
  }

  function addScanned(results: (ScanResult & { aiTagged?: boolean })[]) {
    setProjects((prev) => {
      const have = new Set(prev.map((p) => normPath(p.path)));
      const fresh = results
        .filter((r) => !have.has(normPath(r.path)))
        .map<Project>((r) => ({
          ...r,
          id: uid(),
          status: r.suggestedStatus,
          why: '',
          notes: '',
          addedAt: Date.now(),
          aiTagged: !!r.aiTagged,
        }));
      return [...fresh, ...prev];
    });
    setAdding(false);
  }

  async function refreshOne(id: string) {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;
    const fresh = await api.rescanOne(proj.path);
    if (!fresh) return;
    const update: Partial<Project> = {
      tools: fresh.tools, hosting: fresh.hosting, lastModified: fresh.lastModified,
      todos: fresh.todos, hasReadme: fresh.hasReadme, hasTests: fresh.hasTests,
      hasGit: fresh.hasGit, completion: fresh.completion,
      suggestedStatus: fresh.suggestedStatus, suggestedReason: fresh.suggestedReason,
      readmeExcerpt: fresh.readmeExcerpt, aiTagged: false,
    };
    // If AI is on, let the configured model refine the suggestion (falls back silently).
    const cfg = aiConfig(settings);
    if (cfg) {
      const ai = await api.aiRefine(fresh, cfg);
      if (ai) { update.suggestedStatus = ai.status; update.suggestedReason = ai.reason; update.aiTagged = true; }
    }
    patch(id, update);
  }

  async function refreshAll() {
    setRefreshingAll(true);
    for (const p of projects) await refreshOne(p.id);
    setRefreshingAll(false);
  }

  /* ---- drag hit-testing ---- */
  function within(ref: HTMLElement | null, x: number, y: number) {
    if (!ref) return false;
    const r = ref.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function onCardDrag(x: number, y: number) {
    setTrashHot(within(trashRef.current, x, y));
    const over = COLUMNS.find((c) => within(colRefs.current[c.key], x, y));
    setHoverCol(over ? over.key : null);
  }

  function onCardDragEnd(project: Project, x: number, y: number) {
    setDragging(false);
    setTrashHot(false);
    setHoverCol(null);
    if (within(trashRef.current, x, y)) {
      remove(project.id);
      return;
    }
    for (const col of COLUMNS) {
      if (within(colRefs.current[col.key], x, y) && project.status !== col.key) {
        patch(project.id, { status: col.key });
        return;
      }
    }
  }

  const openProject = projects.find((p) => p.id === openId) || null;
  const revivingProject = projects.find((p) => p.id === revivingId) || null;

  return (
    <>
    {/* ambient background art — dreamy drifting light */}
    <div className="bg-art" aria-hidden>
      <div className="bg-sun" />
      <div className="orb o1" />
      <div className="orb o2" />
      <div className="orb o3" />
      <div className="bg-ninja"><Mascot size={360} /></div>
      <BgSpiral />
    </div>

    <div className="app">
      {/* top bar */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-logo"><TrackixMark size={40} /></div>
          <div>
            <div className="brand-name">Track<span>ix</span></div>
            <div className="brand-tag">track everything you build</div>
          </div>
        </div>
        <div className="topbar-spacer" />
        <div className="search">
          <Search size={15} color="var(--text-faint)" />
          <input
            ref={searchRef}
            placeholder="Search projects, tools…  (Ctrl+K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn" onClick={refreshAll} disabled={refreshingAll || projects.length === 0} title="Re-scan every tracked project">
          <RefreshCw size={15} className={refreshingAll ? 'spin' : ''} /> Refresh all
        </button>
        <button className="btn btn-oracle" onClick={() => setCosmosOpen(true)} disabled={projects.length === 0} title="See your projects as a living night sky">
          <Orbit size={15} /> Cosmos
        </button>
        <button className="btn btn-oracle" onClick={() => setOracleOpen(true)} disabled={projects.length === 0} title="Ask the Oracle which project deserves you today">
          <Eye size={15} /> Oracle
        </button>
        <button className="btn" onClick={() => setShareOpen(true)} disabled={projects.length === 0} title="Generate a shareable Ship Card of your board">
          <Megaphone size={15} /> Share
        </button>
        <button
          className={`icon-btn ${settings.aiEnabled ? 'ai-on' : ''}`}
          onClick={() => setSettingsOpen(true)}
          title={settings.aiEnabled ? 'Settings — local AI is ON' : 'Settings'}
        >
          <SettingsIcon size={16} />
          {settings.aiEnabled && <span className="ai-dot" />}
        </button>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add projects
        </button>
      </header>

      {!loaded ? (
        <div className="empty-state" />
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <HeroMascot />
          <h2>Track everything you build</h2>
          <p>
            Trackix scans a folder you choose and finds your projects automatically — detecting the tools you used,
            where each is hosted, and which ones look finished, in progress, or quietly abandoned.
            Drag cards between columns, or to the bin, to keep it all tidy.
          </p>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add your first projects
          </button>
        </div>
      ) : (
        <>
          {/* stats */}
          <div className="statsbar">
            <div className="stat s-total">
              <div className="stat-num"><CountUp value={projects.length} /></div>
              <div className="stat-label">Total tracked</div>
            </div>
            <div className="stat s-unfinished">
              <div className="stat-num"><CountUp value={counts.unfinished} /></div>
              <div className="stat-label">In progress</div>
            </div>
            <div className="stat s-finished">
              <div className="stat-num"><CountUp value={counts.finished} /></div>
              <div className="stat-label">Finished</div>
            </div>
            <div className="stat s-dropped">
              <div className="stat-num"><CountUp value={counts.dropped} /></div>
              <div className="stat-label">Dropped</div>
            </div>
          </div>

          {/* board */}
          <div className={`board ${dragging ? 'is-dragging' : ''}`}>
            {COLUMNS.map((col) => {
              const items = byStatus(col.key);
              return (
                <div className="column" key={col.key}>
                  <div className="column-head">
                    <span className={`column-dot ${col.key}`} />
                    <span className="column-title">{col.title}</span>
                    <span className="column-count">{items.length}</span>
                  </div>
                  <div
                    className={`column-body ${dragging && hoverCol === col.key ? 'drag-over' : ''}`}
                    ref={(el) => { colRefs.current[col.key] = el; }}
                  >
                    <AnimatePresence mode="popLayout">
                      {items.map((p, i) => (
                        <ProjectCard
                          key={p.id}
                          project={p}
                          index={i}
                          onOpen={() => setOpenId(p.id)}
                          onDragStart={() => setDragging(true)}
                          onDrag={onCardDrag}
                          onDragEnd={(x, y) => onCardDragEnd(p, x, y)}
                        />
                      ))}
                    </AnimatePresence>
                    {items.length === 0 && (
                      <div className="empty-col">
                        {col.key === 'unfinished' && 'Nothing in progress. Drag a card here when you pick it back up.'}
                        {col.key === 'finished' && 'No finished projects yet. Drag one here when you ship it. 🚀'}
                        {col.key === 'dropped' && 'No dropped projects. Drag here the ones you’ve let go.'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* footer / Astax Labs branding */}
      <footer className="footer">
        <div className="made">
          <AstaxLogo size={19} />
          Made by <b style={{ color: 'var(--text-dim)' }}>Astax Labs</b>
        </div>
        <span className="privacy-pill"><ShieldCheck size={13} /> 100% local · nothing leaves your device</span>
      </footer>

      {/* trash drop zone (only while dragging) */}
      <AnimatePresence>
        {dragging && (
          <motion.div
            ref={trashRef}
            className={`trash-zone ${trashHot ? 'hot' : ''}`}
            initial={{ opacity: 0, y: 30, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: trashHot ? 1.12 : 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
          >
            <Trash2 size={trashHot ? 26 : 22} />
            <span className="trash-label">{trashHot ? 'Release' : 'Bin'}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* detail drawer */}
      <AnimatePresence>
        {openProject && (
          <ProjectDetail
            project={openProject}
            onClose={() => setOpenId(null)}
            onChange={(p) => patch(openProject.id, p)}
            onRefresh={() => refreshOne(openProject.id)}
            onDelete={() => remove(openProject.id)}
            onRevive={() => setRevivingId(openProject.id)}
          />
        )}
      </AnimatePresence>

      {/* Revival Ritual */}
      <AnimatePresence>
        {revivingProject && (
          <RevivalModal
            project={revivingProject}
            ai={aiConfig(settings)}
            onClose={() => setRevivingId(null)}
            onAccept={(plan) => {
              patch(revivingProject.id, { revival: plan, status: 'unfinished' });
              setRevivingId(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* The Oracle */}
      <AnimatePresence>
        {oracleOpen && (
          <OracleModal
            projects={projects}
            onClose={() => setOracleOpen(false)}
            onOpenProject={(id) => setOpenId(id)}
          />
        )}
      </AnimatePresence>

      {/* The Cosmos */}
      <AnimatePresence>
        {cosmosOpen && (
          <CosmosModal
            projects={projects}
            onClose={() => setCosmosOpen(false)}
            onOpenProject={(id) => setOpenId(id)}
            onRevive={(id) => setRevivingId(id)}
          />
        )}
      </AnimatePresence>

      {/* add modal */}
      <AnimatePresence>
        {adding && (
          <AddProjectModal
            existingPaths={new Set(projects.map((p) => normPath(p.path)))}
            ai={aiConfig(settings)}
            onClose={() => setAdding(false)}
            onAdd={addScanned}
          />
        )}
      </AnimatePresence>

      {/* settings */}
      <AnimatePresence>
        {settingsOpen && (
          <SettingsModal
            settings={settings}
            projectCount={projects.length}
            onChange={(p) => setSettings((s) => ({ ...s, ...p }))}
            onClearAll={clearAll}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ship card */}
      <AnimatePresence>
        {shareOpen && <ShareCard projects={projects} onClose={() => setShareOpen(false)} />}
      </AnimatePresence>
    </div>
    </>
  );
}
