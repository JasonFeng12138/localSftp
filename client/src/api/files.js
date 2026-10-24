import api from './index.js'

export function listFiles(dirPath) {
  return api.get('/files', { params: { path: dirPath } })
}

export function fileStat(filePath) {
  return api.get('/files/stat', { params: { path: filePath } })
}

// 文件传输耗时取决于文件大小，不能沿用全局 30s 超时（timeout: 0 表示不限时）
export function downloadFile(filePath) {
  return api.get('/files/download', {
    params: { path: filePath },
    responseType: 'blob',
    timeout: 0
  })
}

export function uploadFile(file, dirPath, onProgress) {
  const form = new FormData()
  form.append('file', file)
  form.append('path', dirPath)
  return api.post('/files/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    onUploadProgress: onProgress
  })
}

export function mkdirApi(dirPath) {
  return api.post('/files/mkdir', { path: dirPath })
}

export function deleteFile(filePath) {
  return api.delete('/files', { params: { path: filePath } })
}

export function renameFile(oldPath, newPath) {
  return api.put('/files/rename', { oldPath, newPath })
}
