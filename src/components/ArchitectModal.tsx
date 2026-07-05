import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, ShieldCheck, Sparkles, FileCode, Check, SkipForward, Square,
  Loader2, Rocket, CheckCircle2, AlertTriangle, Volume2, VolumeX, FilePlus2,
} from 'lucide-react';
import type { AiConfig, AutopilotEvent, AutopilotRun, Project } from '../types';
import { api } from '../api';
import VegaAvatar, { type VegaState } from './VegaAvatar';

/*
 * ARCHITECT — the Autopilot cockpit. Runs the portfolio-aware agent loop and
 * streams its progress: the git snapshot, which of your projects it studied,
 * its plan, the files it reads, and a diff for every proposed write that YOU
 * approve or skip. Vega's holographic core reports in — reacting as it works
 * and speaking the final summary. A Stop is always available.
 */

interface Props {
  project: Project;
  ai: AiConfig;
  others: { name: string; path: string; tools: string[] }[];
  onClose: () => void;
  onComplete: (run: AutopilotRun) => void;
}

type LogKind = 'safety' | 'context' | 'plan' | 'read' | 'wrote' | 'skipped' | 'info';
interface LogEntry { kind: LogKind; text: string; }

interface DiffReq { id: string; path: string; before: string; after: string; isNew: boolean; }

type Phase = 'running' | 'awaiting' | 'done' | 'stopped' | 'error';

/** Cheap line diff: shared prefix/suffix stay as context, the middle is
 *  shown as removed (before) then added (after). Good enough for edited files. */
function lineDiff(before: string, after: string) {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const rows: { t: 'ctx' | 'del' | 'add'; text: string }[] = [];
  for (let i = Math.max(0, s - 2); i < s; i++) rows.push({ t: 'ctx', text: a[i] });
  for (let i = s; i < ea; i++) rows.push({ t: 'del', text: a[i] });
  for (let i = s; i < eb; i++) rows.push({ t: 'add', text: b[i] });
  for (let i = ea; i < Math.min(a.length, ea + 2); i++) rows.push({ t: 'ctx', text: a[i] });
  return rows;
}

const ICON: Record<LogKind, JSX.Element> = {
  safety: <ShieldCheck size={13} />,
  context: <Sparkles size={13} />,
  plan: <Rocket size={13} />,
  read: <FileCode size={13} />,
  wrote: <Check size={13} />,
  skipped: <SkipForward size={13} />,
  info: <Sparkles size={13} />,
};

export default function ArchitectModal({ project, ai, others, onClose, onComplete }: Props) {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [diff, setDiff] = useState<DiffReq | null>(null);
  const [phase, setPhase] = useState<Phase>('running');
  const [report, setReport] = useState<{ summary: string; humanTasks: string[]; filesChanged: string[] } | null>(null);
  const [errMsg, setErrMsg] = useState('');
  const [stopReason, setStopReason] = useState('');
  const [cost, setCost] = useState<{ usd: number; out: number } | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const started = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const add = (kind: LogKind, text: string) => setLog((l) => [...l, { kind, text }]);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [log, diff, report]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  useEffect(() => {
    // Always (re)subscribe — StrictMode's dev double-invoke unsubscribes on the
    // interim cleanup. Only the actual session start is guarded to run once.
    const off = api.onAutopilot((ev: AutopilotEvent) => {
      switch (ev.type) {
        case 'snapshot': add('safety', ev.detail); break;
        case 'context':
          add('context', ev.sources.length
            ? `Studying your style from: ${ev.sources.join(', ')}`
            : 'No sibling projects matched — inferring style from this project itself.');
          break;
        case 'assistant': add('plan', ev.text); break;
        case 'tool': add('read', ev.tool === 'list_dir' ? `Listed ${ev.path}/` : `Read ${ev.path}`); break;
        case 'diff_request': setDiff({ id: ev.id, path: ev.path, before: ev.before, after: ev.after, isNew: ev.isNew }); setPhase('awaiting'); break;
        case 'file_written': add('wrote', `Wrote ${ev.path}`); setDiff(null); setPhase('running'); break;
        case 'file_skipped': add('skipped', `Skipped ${ev.path}`); setDiff(null); setPhase('running'); break;
        case 'usage': setCost({ usd: ev.costUsd, out: ev.outputTokens }); break;
        case 'done':
          setDiff(null);
          setReport({ summary: ev.summary, humanTasks: ev.humanTasks, filesChanged: ev.filesChanged });
          setPhase('done');
          onCompleteRef.current({ at: Date.now(), filesChanged: ev.filesChanged, summary: ev.summary, humanTasks: ev.humanTasks });
          break;
        case 'stopped': setDiff(null); setStopReason(ev.reason || ''); setPhase('stopped'); break;
        case 'error': setDiff(null); setErrMsg(ev.message); setPhase('error'); break;
      }
    });

    if (!started.current) {
      started.current = true;
      api.autopilotStart({
        provider: 'claude', model: ai.model, apiKey: ai.apiKey,
        path: project.path, name: project.name, tools: project.tools, others,
      });
    }

    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Speak the final report — the "reporting in" moment.
  useEffect(() => {
    if (phase !== 'done' || !report || !voiceOn || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(report.summary);
    u.rate = 1.02;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    return () => window.speechSynthesis?.cancel();
  }, [phase, report, voiceOn]);

  function approve() { if (diff) { api.autopilotApprove(diff.id); setPhase('running'); } }
  function skip() { if (diff) { api.autopilotReject(diff.id); setPhase('running'); } }
  function stop() { api.autopilotStop(); }

  const avatarState: VegaState = speaking ? 'speaking' : phase === 'running' ? 'thinking' : 'idle';
  const running = phase === 'running' || phase === 'awaiting';

  const diffRows = useMemo(() => (diff ? lineDiff(diff.before, diff.after) : []), [diff]);
  const added = diffRows.filter((r) => r.t === 'add').length;
  const removed = diffRows.filter((r) => r.t === 'del').length;

  return (
    <motion.div className="architect-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
      <div className="architect-stage">
        <div className="architect-head">
          <div className="architect-avatar"><VegaAvatar state={avatarState} className="architect-canvas" /></div>
          <div style={{ flex: 1 }}>
            <div className="architect-title">Autopilot <span>· {project.name}</span></div>
            <div className="architect-sub">
              {phase === 'running' && 'Building in your style…'}
              {phase === 'awaiting' && 'Waiting on your call — approve or skip the change.'}
              {phase === 'done' && 'Pass complete. Your move.'}
              {phase === 'stopped' && 'Stopped.'}
              {phase === 'error' && 'Something went wrong.'}
            </div>
          </div>
          {cost && (
            <div className="arch-cost" title={`${cost.out.toLocaleString()} output tokens so far · your Anthropic key`}>
              <span className="arch-cost-usd">${cost.usd.toFixed(2)}</span>
              <span className="arch-cost-lbl">spent</span>
            </div>
          )}
          <button className={`icon-btn ${voiceOn ? 'ai-on' : ''}`} onClick={() => { if (voiceOn) window.speechSynthesis?.cancel(); setVoiceOn((v) => !v); }} title={voiceOn ? 'Mute Vega' : 'Let Vega speak'}>
            {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button className="cosmos-close" onClick={onClose} title="Close"><X size={17} /></button>
        </div>

        <div className="architect-privacy">
          <ShieldCheck size={12} /> Autopilot sends this project's code and short snippets of your other projects to Anthropic under your own API key.
        </div>

        <div className="architect-log" ref={logRef}>
          {log.map((e, i) => (
            <div key={i} className={`arch-line ${e.kind}`}>
              <span className="arch-ico">{ICON[e.kind]}</span>
              <span className="arch-text">{e.text}</span>
            </div>
          ))}
          {running && !diff && (
            <div className="arch-line info thinking"><span className="arch-ico"><Loader2 size={13} className="spin" /></span><span className="arch-text">Working…</span></div>
          )}

          {/* the diff-approval gate */}
          {diff && (
            <div className="arch-diff">
              <div className="arch-diff-head">
                {diff.isNew ? <FilePlus2 size={13} /> : <FileCode size={13} />}
                <code>{diff.path}</code>
                <span className="arch-diff-stat">{diff.isNew ? 'new file' : <><em className="add">+{added}</em> <em className="del">−{removed}</em></>}</span>
              </div>
              <div className="arch-diff-body">
                {diffRows.slice(0, 400).map((r, i) => (
                  <div key={i} className={`arch-row ${r.t}`}>
                    <span className="arch-sign">{r.t === 'add' ? '+' : r.t === 'del' ? '−' : ' '}</span>
                    <span className="arch-code">{r.text || ' '}</span>
                  </div>
                ))}
                {diffRows.length > 400 && <div className="arch-row ctx"><span className="arch-sign"> </span><span className="arch-code">… {diffRows.length - 400} more lines</span></div>}
              </div>
              <div className="arch-diff-actions">
                <button className="btn arch-approve" onClick={approve}><Check size={15} /> Approve &amp; write</button>
                <button className="btn arch-skip" onClick={skip}><SkipForward size={15} /> Skip</button>
              </div>
            </div>
          )}

          {/* final report, in Vega's voice */}
          {report && (
            <div className="arch-report">
              <div className="arch-report-head"><CheckCircle2 size={15} /> Reporting in</div>
              <div className="arch-report-body">{report.summary}</div>
              {report.filesChanged.length > 0 && (
                <div className="arch-report-files">
                  {report.filesChanged.map((f) => <code key={f}><Check size={11} /> {f}</code>)}
                </div>
              )}
              {report.humanTasks.length > 0 && (
                <>
                  <div className="arch-report-h">What's left for you</div>
                  <ul className="arch-tasks">{report.humanTasks.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </>
              )}
            </div>
          )}

          {phase === 'error' && (
            <div className="arch-error"><AlertTriangle size={15} /> {errMsg || 'Autopilot failed.'}</div>
          )}
          {phase === 'stopped' && (
            <div className="arch-error stopped"><Square size={14} /> {stopReason || 'Stopped. Nothing further was written — your snapshot is intact.'}</div>
          )}
        </div>

        <div className="architect-foot">
          {running ? (
            <button className="btn arch-stop" onClick={stop}><Square size={14} /> Stop</button>
          ) : (
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
