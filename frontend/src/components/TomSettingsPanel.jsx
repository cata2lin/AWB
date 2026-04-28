/**
 * TomSettingsPanel — Configurable TOM API credentials + PO categories.
 * Reads/writes to /api/settings/tom and /api/settings/po-categories.
 */
import { useState, useEffect } from 'react'
import { settingsApi } from '../services/api/analytics'
import { Save, Check, RefreshCw, AlertCircle, Wifi, WifiOff, Plus, Trash2, X, Settings2, Tag, Store } from 'lucide-react'

export default function TomSettingsPanel() {
  // TOM credentials
  const [tom, setTom] = useState({ base_url: '', api_key_id: '', hmac_secret: '', source_code: '' })
  const [tomMeta, setTomMeta] = useState({}) // source info (env vs db)
  const [tomLoading, setTomLoading] = useState(true)
  const [tomSaving, setTomSaving] = useState(false)
  const [tomSaved, setTomSaved] = useState(false)
  const [tomError, setTomError] = useState(null)
  const [showSecret, setShowSecret] = useState(false)
  const [newSecret, setNewSecret] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  // PO categories
  const [categories, setCategories] = useState([])
  const [catLoading, setCatLoading] = useState(true)
  const [catSaving, setCatSaving] = useState(false)
  const [catSaved, setCatSaved] = useState(false)
  const [editingCat, setEditingCat] = useState(null)
  const [newCat, setNewCat] = useState({ key: '', label: '', stores: [], tom_enabled: true })

  useEffect(() => {
    loadTom()
    loadCategories()
  }, [])

  const loadTom = async () => {
    setTomLoading(true)
    try {
      const d = await settingsApi.getTom()
      setTom({ base_url: d.base_url || '', api_key_id: d.api_key_id_display || '', hmac_secret: d.hmac_secret || '', source_code: d.source_code || '' })
      setTomMeta(d)
    } catch (e) { setTomError('Failed to load TOM config') }
    finally { setTomLoading(false) }
  }

  const saveTom = async () => {
    setTomSaving(true); setTomError(null)
    try {
      const body = {}
      if (tom.base_url) body.base_url = tom.base_url
      if (tom.api_key_id) body.api_key_id = tom.api_key_id
      if (newSecret) body.hmac_secret = newSecret
      if (tom.source_code) body.source_code = tom.source_code
      await settingsApi.updateTom(body)
      setTomSaved(true); setNewSecret('')
      setTimeout(() => setTomSaved(false), 3000)
      loadTom()
    } catch (e) { setTomError(e?.response?.data?.detail || 'Save failed') }
    finally { setTomSaving(false) }
  }

  const testConnection = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await settingsApi.testTom()
      setTestResult(r)
    } catch (e) { setTestResult({ ok: false, error: 'Request failed' }) }
    finally { setTesting(false) }
  }

  const loadCategories = async () => {
    setCatLoading(true)
    try {
      const d = await settingsApi.getPoCategories()
      setCategories(d.categories || [])
    } catch (_) {}
    finally { setCatLoading(false) }
  }

  const saveCategories = async () => {
    setCatSaving(true)
    try {
      const r = await settingsApi.updatePoCategories(categories)
      setCategories(r.categories || categories)
      setCatSaved(true)
      setTimeout(() => setCatSaved(false), 3000)
    } catch (_) {}
    finally { setCatSaving(false) }
  }

  const addCategory = () => {
    if (!newCat.key || !newCat.label) return
    setCategories(prev => [...prev, { ...newCat }])
    setNewCat({ key: '', label: '', stores: [], tom_enabled: true })
  }

  const removeCategory = (key) => setCategories(prev => prev.filter(c => c.key !== key))

  const updateCategory = (key, field, value) => {
    setCategories(prev => prev.map(c => c.key === key ? { ...c, [field]: value } : c))
  }

  const SourceBadge = ({ src }) => (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${src === 'database' ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300' : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'}`}>
      {src === 'database' ? '💾 DB' : '📁 .env'}
    </span>
  )

  return (
    <div className="space-y-6">
      {/* ═══ TOM API Configuration ═══ */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-sky-500" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">TOM API Configuration</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={testConnection} disabled={testing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg transition-colors disabled:opacity-40">
              {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />} Test Connection
            </button>
            <button onClick={saveTom} disabled={tomSaving || tomLoading}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-medium text-sm transition-all ${tomSaved
                ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                : 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-lg shadow-sky-500/20'
              } disabled:opacity-50`}>
              {tomSaved ? <><Check className="w-4 h-4" /> Saved</> : <><Save className="w-4 h-4" /> {tomSaving ? 'Saving...' : 'Save'}</>}
            </button>
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-4 text-xs ${testResult.ok ? 'bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300'}`}>
            {testResult.ok ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {testResult.ok ? `Connection OK (HTTP ${testResult.status})` : `Connection failed: ${testResult.error || 'unknown'}`}
          </div>
        )}

        {tomError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4 text-xs bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300">
            <AlertCircle className="w-4 h-4" /> {tomError}
          </div>
        )}

        {tomLoading ? (
          <div className="flex items-center justify-center py-8"><RefreshCw className="w-6 h-6 text-zinc-400 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Base URL</label>
                <SourceBadge src={tomMeta.base_url_source} />
              </div>
              <input value={tom.base_url} onChange={e => setTom(p => ({ ...p, base_url: e.target.value }))}
                placeholder="https://tom.arona.ro"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white font-mono" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">API Key (X-Tom-Key)</label>
                <SourceBadge src={tomMeta.api_key_id_source} />
              </div>
              <input value={tom.api_key_id} onChange={e => setTom(p => ({ ...p, api_key_id: e.target.value }))}
                placeholder="tom_live_vigo_..."
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white font-mono" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">HMAC Secret</label>
                <SourceBadge src={tomMeta.hmac_secret_source} />
                {tomMeta.hmac_secret_set && <span className="text-[10px] text-green-500">✓ configured</span>}
              </div>
              <p className="text-xs text-zinc-400 mb-1">Current: {tom.hmac_secret || '(not set)'}</p>
              <input value={newSecret} onChange={e => setNewSecret(e.target.value)}
                placeholder="Paste new secret to update..."
                type={showSecret ? 'text' : 'password'}
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white font-mono" />
              <button onClick={() => setShowSecret(!showSecret)} className="text-[10px] text-zinc-400 hover:text-zinc-600 mt-1">{showSecret ? 'Hide' : 'Show'}</button>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Source Code</label>
                <SourceBadge src={tomMeta.source_code_source} />
              </div>
              <input value={tom.source_code} onChange={e => setTom(p => ({ ...p, source_code: e.target.value }))}
                placeholder="VIGO"
                className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-white font-mono" />
              <p className="text-xs text-zinc-400 mt-1">Identifies this app to TOM. TOM uses this to group POs by source (e.g. VIGO, GRANDIA, SCENTUM).</p>
            </div>
          </div>
        )}
      </div>

      {/* ═══ PO Categories ═══ */}
      <div className="bg-white dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700/50 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-violet-500" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white tracking-tight">PO Categories</h2>
          </div>
          <button onClick={saveCategories} disabled={catSaving}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg font-medium text-sm transition-all ${catSaved
              ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-500/20'
            } disabled:opacity-50`}>
            {catSaved ? <><Check className="w-4 h-4" /> Saved</> : <><Save className="w-4 h-4" /> {catSaving ? 'Saving...' : 'Save Categories'}</>}
          </button>
        </div>

        <p className="text-xs text-zinc-400 mb-4">
          Define PO categories based on store groupings. Categories with <strong>TOM enabled</strong> can sync to TOM for sourcing.
        </p>

        {catLoading ? (
          <div className="flex items-center justify-center py-8"><RefreshCw className="w-6 h-6 text-zinc-400 animate-spin" /></div>
        ) : (
          <div className="space-y-3">
            {categories.map(cat => (
              <div key={cat.key} className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={cat.label} onChange={e => updateCategory(cat.key, 'label', e.target.value)}
                      className="px-2 py-1 text-sm font-medium rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white w-48" />
                    <span className="text-[10px] font-mono text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-1.5 py-0.5 rounded">{cat.key}</span>
                    <label className="flex items-center gap-1 text-xs text-zinc-500 cursor-pointer ml-auto">
                      <input type="checkbox" checked={cat.tom_enabled} onChange={e => updateCategory(cat.key, 'tom_enabled', e.target.checked)}
                        className="rounded border-zinc-300 dark:border-zinc-600 text-sky-600 focus:ring-sky-500" />
                      TOM sync
                    </label>
                    <button onClick={() => removeCategory(cat.key)} className="p-1 text-zinc-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <Store className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                    {(cat.stores || []).map(s => (
                      <span key={s} className="inline-flex items-center gap-0.5 text-[10px] bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">
                        {s}
                        <button onClick={() => updateCategory(cat.key, 'stores', cat.stores.filter(x => x !== s))} className="hover:text-red-500">×</button>
                      </span>
                    ))}
                    <input placeholder="+ store" onKeyDown={e => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        updateCategory(cat.key, 'stores', [...(cat.stores || []), e.target.value.trim()])
                        e.target.value = ''
                      }
                    }} className="text-[10px] w-24 px-1.5 py-0.5 border border-dashed border-zinc-300 dark:border-zinc-600 rounded bg-transparent text-zinc-600 dark:text-zinc-400" />
                  </div>
                </div>
              </div>
            ))}

            {/* Add new category */}
            <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-600">
              <input value={newCat.key} onChange={e => setNewCat(p => ({ ...p, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                placeholder="key" className="w-28 px-2 py-1 text-xs font-mono rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white" />
              <input value={newCat.label} onChange={e => setNewCat(p => ({ ...p, label: e.target.value }))}
                placeholder="🏷️ Label" className="w-40 px-2 py-1 text-xs rounded border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white" />
              <label className="flex items-center gap-1 text-xs text-zinc-500">
                <input type="checkbox" checked={newCat.tom_enabled} onChange={e => setNewCat(p => ({ ...p, tom_enabled: e.target.checked }))} className="rounded" /> TOM
              </label>
              <button onClick={addCategory} disabled={!newCat.key || !newCat.label}
                className="flex items-center gap-1 px-3 py-1 text-xs font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-40">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
