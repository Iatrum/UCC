'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Note = { clinicalNotes: string; diagnosis: string };
const empty = { clinicalNotes: '', diagnosis: '' };
export function useConsultationDraft(patientId: string) {
  const [{ note, touched }, setDraft] = useState({ note: empty, touched: false });
  const [status, setStatus] = useState<'checking' | 'saved' | 'pending' | 'saving' | 'failed' | 'cleanup-failed'>('checking');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const state = useRef({ note: empty, saved: JSON.stringify(empty), version: null as string | null,
    hydrated: false, touched: false, signing: false });
  const writing = useRef<Promise<void> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let active = true;
    (async () => {
      setStatus('checking');
      try {
        const response = await fetch(`/api/consultations/draft?patientId=${encodeURIComponent(patientId)}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.success) throw Error('Could not load saved draft. Retry before leaving.');
        if (!active) return;
        state.current.version = data.version;
        state.current.saved = JSON.stringify(data.draft);
        state.current.hydrated = true;
        if (!state.current.touched) {
          state.current.note = data.draft;
          setDraft({ note: data.draft, touched: false });
        }
        setError('');
        setStatus(JSON.stringify(state.current.note) === state.current.saved ? 'saved' : 'pending');
      } catch (error) {
        if (active) { setStatus('failed'); setError((error as Error).message); }
      }
    })();
    return () => { active = false; alive.current = false; };
  }, [patientId, attempt]);
  const change = useCallback((field: keyof Note, value: string) => {
    if (state.current.signing) return;
    if (status === 'cleanup-failed') return;
    // Tiptap emits an empty paragraph after programmatic clearing. Keep it empty.
    if (field === 'clinicalNotes' && !value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()) value = '';
    state.current.touched = true;
    state.current.note = { ...state.current.note, [field]: value };
    setDraft({ note: state.current.note, touched: true });
    setStatus(!state.current.hydrated ? 'checking' :
      JSON.stringify(state.current.note) === state.current.saved ? 'saved' : 'pending');
  }, [status]);
  const save = useCallback(async (): Promise<void> => {
    if (writing.current) await writing.current;
    if (!state.current.hydrated) throw Error('Saved draft has not been loaded. Retry first.');
    if (state.current.saved === JSON.stringify(state.current.note)) { setStatus('saved'); return; }
    const task = (async () => {
      setStatus('saving');
      try {
        // Drain edits made during an in-flight request without sending stale versions.
        while (state.current.saved !== JSON.stringify(state.current.note)) {
          const snapshot = JSON.stringify(state.current.note);
          const response = await fetch('/api/consultations/draft', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId, ...JSON.parse(snapshot), version: state.current.version }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) throw Error(data.error || 'Draft could not be saved.');
          state.current.version = data.version;
          state.current.saved = snapshot;
        }
        if (alive.current) { setStatus('saved'); setError(''); }
      } catch (error) {
        if (alive.current) { setStatus('failed'); setError((error as Error).message); }
        throw error;
      }
    })();
    writing.current = task;
    try { await task; } finally { if (writing.current === task) writing.current = null; }
  }, [patientId]);
  useEffect(() => {
    if (status !== 'pending' || state.current.signing) return;
    const timer = setTimeout(() => { void save().catch(() => {}); }, 500);
    return () => clearTimeout(timer);
  }, [note, status, save]);
  const clear = useCallback(async () => {
    // Only called after confirmed signing. A cleanup failure must never invite a second Sign.
    try {
      if (state.current.version) {
        const response = await fetch('/api/consultations/draft', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patientId, version: state.current.version }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw Error('Consult signed, but the saved draft could not be cleared.');
        state.current.version = data.version;
      }
    } catch (error) {
      setStatus('cleanup-failed'); setError((error as Error).message); throw error;
    }
    state.current.note = empty; state.current.saved = JSON.stringify(empty); state.current.touched = false;
    setDraft({ note: empty, touched: false }); setStatus('saved');
  }, [patientId]);
  return { ...note, status, error, change, save, clear,
    setSigning: (signing: boolean) => { state.current.signing = signing; },
    retry: () => { if (state.current.hydrated) void save().catch(() => {}); else setAttempt(a => a + 1); },
    unsaved: status === 'cleanup-failed' || status === 'pending' || status === 'saving' || status === 'failed' || (status === 'checking' && touched),
  };
}
