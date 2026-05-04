import { useState, useEffect } from 'react'
import { Plus, Search, Edit2, Trash2, X, Save, RefreshCw, Package } from 'lucide-react'

export default function CustomProducts() {
  const [products, setProducts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState({
    id: null,
    sku: '',
    product_name: '',
    barcode: '',
    image_url: '',
    default_unit_cost: 0,
    hs_code: '',
    weight_grams: 0,
  })

  const fetchProducts = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('token')
      const q = new URLSearchParams({ limit: 50, offset: 0 })
      if (search) q.set('search', search)
      
      const res = await fetch(`/api/custom-products?${q.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setProducts(data.items || [])
      setTotal(data.total || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const delay = setTimeout(fetchProducts, 300)
    return () => clearTimeout(delay)
  }, [search])

  const openCreate = () => {
    setForm({
      id: null, sku: '', product_name: '', barcode: '', image_url: '', 
      default_unit_cost: 0, hs_code: '', weight_grams: 0
    })
    setIsModalOpen(true)
  }

  const openEdit = (p) => {
    setForm({
      id: p.id,
      sku: p.sku || '',
      product_name: p.product_name || '',
      barcode: p.barcode || '',
      image_url: p.image_url || '',
      default_unit_cost: p.default_unit_cost || 0,
      hs_code: p.hs_code || '',
      weight_grams: p.weight_grams || 0,
    })
    setIsModalOpen(true)
  }

  const saveProduct = async () => {
    if (!form.sku || !form.product_name) {
      alert("SKU and Product Name are required.")
      return
    }
    
    try {
      setIsSaving(true)
      const token = localStorage.getItem('token')
      const method = form.id ? 'PUT' : 'POST'
      const url = form.id ? `/api/custom-products/${form.id}` : '/api/custom-products'
      
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(form)
      })
      
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.detail || 'Failed to save')
      }
      
      setIsModalOpen(false)
      fetchProducts()
    } catch (e) {
      alert(e.message)
    } finally {
      setIsSaving(false)
    }
  }

  const deleteProduct = async (id) => {
    if (!confirm('Are you sure you want to delete this custom product?')) return
    
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/custom-products/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Failed to delete')
      fetchProducts()
    } catch (e) {
      alert(e.message)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Custom Products</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">Manage products not synced from stores</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">
          <Plus className="w-4 h-4" /> Add Product
        </button>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50">
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              placeholder="Search by name, SKU or barcode..." 
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="text-sm text-zinc-500">
            Total: {total} custom products
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 font-medium">
              <tr>
                <th className="px-4 py-3">Image</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Product Name</th>
                <th className="px-4 py-3">Barcode</th>
                <th className="px-4 py-3 text-right">Cost (RON)</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {loading && products.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-12 text-center text-zinc-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    Loading products...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-12 text-center text-zinc-500">
                    No custom products found.
                  </td>
                </tr>
              ) : (
                products.map(p => (
                  <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30">
                    <td className="px-4 py-3">
                      {p.image_url ? (
                        <img src={p.image_url} alt="" className="w-10 h-10 object-cover rounded-lg border border-zinc-200 dark:border-zinc-700" />
                      ) : (
                        <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-200 dark:border-zinc-700">
                          <Package className="w-5 h-5 text-zinc-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-900 dark:text-white">{p.sku}</td>
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-white">{p.product_name}</td>
                    <td className="px-4 py-3 text-zinc-500">{p.barcode || '—'}</td>
                    <td className="px-4 py-3 text-right font-mono">{p.default_unit_cost.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => openEdit(p)} className="p-1.5 text-zinc-400 hover:text-indigo-600 transition-colors mr-2">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteProduct(p.id)} className="p-1.5 text-zinc-400 hover:text-red-600 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE/EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-lg border border-zinc-200 dark:border-zinc-800">
            <div className="p-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
                {form.id ? 'Edit Custom Product' : 'Add Custom Product'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Product Name *</label>
                  <input type="text" value={form.product_name} onChange={e => setForm({...form, product_name: e.target.value})} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">SKU *</label>
                  <input type="text" value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Barcode</label>
                  <input type="text" value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Image URL</label>
                  <input type="text" value={form.image_url} onChange={e => setForm({...form, image_url: e.target.value})} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" placeholder="https://..." />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Default Unit Cost (RON)</label>
                  <input type="number" step="0.01" value={form.default_unit_cost} onChange={e => setForm({...form, default_unit_cost: parseFloat(e.target.value) || 0})} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Weight (grams)</label>
                  <input type="number" value={form.weight_grams} onChange={e => setForm({...form, weight_grams: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">HS Code (Customs)</label>
                  <input type="text" value={form.hs_code} onChange={e => setForm({...form, hs_code: e.target.value})} className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-white" />
                </div>
              </div>
            </div>
            
            <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-xl">
              <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white">Cancel</button>
              <button onClick={saveProduct} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50">
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
