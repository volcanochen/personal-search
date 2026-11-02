import {
  Paper,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Alert,
  Box,
  Chip,
} from '@mui/material'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import SearchOffIcon from '@mui/icons-material/SearchOff'

/**
 * OneNote 笔记搜索结果展示：页面标题 + 所属 Notebook/Section 层级路径。
 * @param {{data?: {items: Array<{title: string, id: string, path: string}>, error: string|null}, query: string}} props
 */
export default function OneNoteResults({ data, query }) {
  const items = data?.items ?? []
  const error = data?.error ?? null

  let content
  if (error) {
    content = (
      <Alert severity="warning" sx={{ mt: 2 }}>
        {error}
      </Alert>
    )
  } else if (items.length === 0) {
    content = (
      <Box className="text-gray-500 mt-4 flex items-center gap-2">
        <SearchOffIcon /> 在 OneNote 中未找到与“{query}”匹配的页面。
      </Box>
    )
  } else {
    content = (
      <List dense>
        {items.map((page, index) => (
          <ListItem key={index} alignItems="flex-start">
            <ListItemIcon>
              <MenuBookIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={page.title}
              secondary={
                <Chip
                  size="small"
                  label={page.path || '(未归类)'}
                  variant="outlined"
                  sx={{ mt: 0.5 }}
                />
              }
            />
          </ListItem>
        ))}
      </List>
    )
  }

  return (
    <Paper elevation={2} className="p-4 h-full">
      <Typography variant="h6" gutterBottom>
        OneNote 笔记
      </Typography>
      <Typography variant="caption" color="text.secondary">
        共 {items.length} 条结果
      </Typography>
      {content}
    </Paper>
  )
}
