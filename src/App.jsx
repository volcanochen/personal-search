import { useState } from 'react'
import { Box, Container, Grid, Typography, CircularProgress } from '@mui/material'
import SearchBar from './components/SearchBar'
import EverythingResults from './components/EverythingResults'
import OneNoteResults from './components/OneNoteResults'

/**
 * 应用根组件：顶部统一搜索框 + 左右两栏结果区。
 * 负责调用 window.api.search 并分发两路结果给对应展示组件。
 */
export default function App() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [query, setQuery] = useState('')

  const handleSearch = async (keyword) => {
    if (!keyword || !keyword.trim()) {
      return
    }
    setQuery(keyword)
    setLoading(true)
    setResult(null)
    try {
      const res = await window.api.search(keyword.trim())
      setResult(res)
    } catch (err) {
      setResult({
        everything: { items: [], error: null },
        onenote: { items: [], error: null },
        errors: [String(err && err.message ? err.message : err)],
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box className="min-h-screen bg-slate-50">
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography variant="h4" gutterBottom>
          个人集成搜索
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          一次搜索，同时检索本机文件（Everything）与 OneNote 笔记。
        </Typography>

        <SearchBar onSearch={handleSearch} loading={loading} />

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {result && !loading && (
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <EverythingResults data={result.everything} query={query} />
            </Grid>
            <Grid item xs={12} md={6}>
              <OneNoteResults data={result.onenote} query={query} />
            </Grid>
          </Grid>
        )}
      </Container>
    </Box>
  )
}
