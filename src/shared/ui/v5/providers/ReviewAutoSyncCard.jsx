"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@/shared/ui/components/Button.jsx';
import Toggle from '@/shared/ui/components/Toggle.jsx';
import './providers.css';
import { isBoolean } from "@/shared/utils/typeChecks.js";
import MotionIcon from '../motion/MotionIcon.jsx';

/** Uses the incumbent auto-sync API, preserving other provider settings on PATCH. */
export default function ReviewAutoSyncCard({ providerId, hasConnection, onModelsChange }) {
  const [status, setStatus] = useState(null);
  const [intervalHours, setIntervalHours] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [message, setMessage] = useState('');
  const mounted = useRef(false), generation = useRef(0), controller = useRef(null);
  const callback = useRef(onModelsChange);
  useEffect(() => { callback.current = onModelsChange; }, [onModelsChange]);
  const load = useCallback(async ({ keepMessage = false } = {}) => {
    const token = ++generation.current;
     controller.current?.abort(); controller.current = new AbortController();
    try {
      const res = await fetch(`/api/models/auto-sync?provider=${encodeURIComponent(providerId)}`, { cache:'no-store', signal:controller.current.signal });
      if (!res.ok) throw new Error('Model sync status is unavailable.');
      const data = await res.json(); const next = data?.providers?.[providerId];
      if (!next || !isBoolean(next.eligible) || !isBoolean(next.enabled)) throw new Error('Model sync status is unavailable.');
      if (!mounted.current || token !== generation.current) return;
      setStatus(next); setIntervalHours(data.intervalHours || null); setPhase('ready');
      if (!keepMessage) setMessage('');
      callback.current?.(next.eligible && next.enabled && Array.isArray(next.models) ? next.models : null);
    } catch (error) {
      if (error.name === 'AbortError' || !mounted.current || token !== generation.current) return;
      setPhase('error'); setMessage(error.message || 'Model sync status is unavailable.');
    }
  },[providerId]);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setStatus(null); setPhase('loading'); setMessage(''); load();
    });
    return () => { active = false; mounted.current = false; controller.current?.abort(); };
  }, [load]);

  const save = async (enabled) => {
    const token = ++generation.current;
        const isCurrent = () => mounted.current && generation.current === token;
    setPhase('saving'); setMessage('');
    try {
      const settingsRes = await fetch('/api/settings',{cache:'no-store'});
      if (!settingsRes.ok) throw new Error('Could not read settings. Your setting was not changed.');
      const settings = await settingsRes.json();
      const res = await fetch('/api/settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelAutoSyncProviders:{...(settings.modelAutoSyncProviders || {}),[providerId]:enabled === true}})});
      if (!res.ok) throw new Error('Could not save the auto-update setting.');
      if (!isCurrent()) return;
      setMessage(enabled ? 'Automatic updates enabled.' : 'Automatic updates paused.'); await load({keepMessage:true});
    } catch (error) { if(isCurrent()){setMessage(error.message);setPhase('error');} }
  };
  const sync = async () => {
    const token = ++generation.current;
        const isCurrent = () => mounted.current && generation.current === token;
    setPhase('syncing'); setMessage('Syncing models…');
    try {
      const res = await fetch('/api/models/auto-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:providerId})});
      const data = await res.json().catch(()=>({})); const result=data.results?.[0];
      if (!res.ok || result?.status === 'failed' || result?.error) throw new Error(data.error || result?.error || 'Sync failed.');
      if (!isCurrent()) return;
      setMessage(result?.status === 'synced' ? `Synced ${result.modelCount} models.` : 'Nothing to sync.'); await load({keepMessage:true});
    } catch(error) { if(isCurrent()){setMessage(`${error.message} The previous model list is kept.`);setPhase('error');} }
  };
  const busy=['loading','saving','syncing'].includes(phase);
  const eligible=status?.eligible === true;
  const unsupported=status?.eligible === false;
  const newIds=status?.newModelIds || [], removedIds=status?.removedModelIds || [];
  return <section className="v5-provider-sync" aria-labelledby="v5-provider-sync-title" aria-busy={busy}>
    <div className="v5-provider-sync-heading"><div><h2 id="v5-provider-sync-title"><MotionIcon name="sync" />Model auto-sync</h2><p>Custom models kept</p></div><span className="v5-provider-sync-state"><MotionIcon name={unsupported ? "block" : status?.enabled ? "check" : "pause"} size={16} />{phase==='syncing'?'Syncing':phase==='saving'?'Saving':phase==='loading'?'Loading':unsupported?'Unavailable':status?.enabled?'Enabled':'Paused'}</span></div>
    {phase==='loading' ? <div className="v5-provider-sync-loading" role="status">Loading model sync status…</div> : unsupported ? <p>This provider has no model-list API. Manage its catalog in Available Models.</p> : <>
      {status ? <Toggle label="Auto-update models" checked={status.enabled} onChange={save} disabled={busy} description={intervalHours ? `Every ${intervalHours} hours` : undefined} /> : null}
      {status ? <dl className="v5-provider-sync-metrics">
        <div><dt>Last sync</dt><dd>{status.syncedAt ? new Date(status.syncedAt).toLocaleString() : 'Not synced'}</dd></div>
        <div><dt>Models</dt><dd>{status.models?.length || 0}</dd></div>
        <div><dt>Added</dt><dd>{newIds.length}</dd></div>
        <div><dt>Removed</dt><dd>{removedIds.length}</dd></div>
      </dl> : null}
      {newIds.length || removedIds.length ? <details className="v5-provider-sync-changes"><summary>Catalog changes</summary><div>{newIds.length ? <div><h3>Added</h3><ul>{newIds.map((id) => <li key={id}><MotionIcon name="add" size={16} /><code>{id}</code></li>)}</ul></div> : null}{removedIds.length ? <div><h3>Removed</h3><ul>{removedIds.map((id) => <li key={id}><MotionIcon name="remove" size={16} /><code>{id}</code></li>)}</ul></div> : null}</div></details> : null}
      {status?.error ? <p className="v5-provider-sync-error">Last attempt failed: {status.error}</p> : null}
      {!hasConnection && eligible ? <p>Add an active connection to sync this provider’s catalog.</p> : null}
      {message ? <p role={phase==='error'?'alert':'status'} className={phase==='error'?'v5-provider-sync-error':'v5-provider-sync-message'}>{message}</p> : null}
      <div className="v5-provider-sync-actions">{phase==='error' ? <Button variant="secondary" size="sm" onClick={()=>{setPhase('loading');load();}}>Retry status</Button> : null}<Button size="sm" variant="secondary" icon="sync" onClick={sync} disabled={busy || !hasConnection || !status?.enabled || !eligible}>{phase==='syncing'?'Syncing…':'Sync now'}</Button></div>
    </>}
  </section>;
}
