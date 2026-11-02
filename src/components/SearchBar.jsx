import { useState } from 'react'
import { Box, TextField, Button, InputAdornment } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'

/**
 * 顶部搜索栏：输入框 + 搜索按钮，支持回车提交。
 * @param {{onSearch: (keyword: string) => void, loading: boolean}} props
 */
export default function SearchBar({ onSearch, loading }) {
  const [value, setValue] = useState('')

  const submit = () => {
    const keyword = value.trim()
    if (keyword) {
      onSearch(keyword)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      submit()
    }
  }

  return (
    <Box className="flex gap-2 items-center">
      <TextField
        fullWidth
        variant="outlined"
        placeholder="输入关键词，同时搜索本机文件与 OneNote 笔记..."
        value={value}
        disabled={loading}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        }}
      />
      <Button
        variant="contained"
        onClick={submit}
        disabled={loading || !value.trim()}
      >
        搜索
      </Button>
    </Box>
  )
}
