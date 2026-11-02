import {
  Paper,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Alert,
  Box,
} from '@mui/material'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import SearchOffIcon from '@mui/icons-material/SearchOff'

/**
 * Everything 文件搜索结果展示。
 * 点击条目时通过 window.api.openPath 用系统默认程序打开对应文件/文件夹。
 * @param {{data?: {items: string[], error: string|null}, query: string}} props
 */
export default function EverythingResults({ data, query }) {
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
        <SearchOffIcon /> 在 Everything 中未找到与“{query}”匹配的文件。
      </Box>
    )
  } else {
    content = (
      <List dense>
        {items.map((filePath, index) => (
          <ListItemButton
            key={index}
            onClick={() => window.api?.openPath?.(filePath)}
            title="点击用系统默认程序打开"
          >
            <ListItemIcon>
              <InsertDriveFileIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={filePath}
              primaryTypographyProps={{ noWrap: true, title: filePath }}
            />
          </ListItemButton>
        ))}
      </List>
    )
  }

  return (
    <Paper elevation={2} className="p-4 h-full">
      <Typography variant="h6" gutterBottom>
        本机文件（Everything）
      </Typography>
      <Typography variant="caption" color="text.secondary">
        共 {items.length} 条结果
      </Typography>
      {content}
    </Paper>
  )
}
