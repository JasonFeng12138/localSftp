<template>
  <div class="file-manager">
    <!-- Toolbar -->
    <div class="toolbar">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item
          v-for="(seg, idx) in filesStore.breadcrumbs"
          :key="idx"
          @click="filesStore.navigateTo(idx)"
          style="cursor: pointer;"
        >
          {{ seg }}
        </el-breadcrumb-item>
      </el-breadcrumb>
      <div class="toolbar-actions">
        <el-input
          v-model="filterText"
          placeholder="过滤文件名"
          clearable
          size="small"
          style="width: 180px;"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button v-if="auth.canWrite" type="primary" @click="showUpload = true">
          <el-icon><Upload /></el-icon> 上传
        </el-button>
        <el-button v-if="auth.canWrite" @click="showMkdir = true">
          <el-icon><FolderAdd /></el-icon> 新建文件夹
        </el-button>
        <el-button :icon="Refresh" circle @click="refresh" />
      </div>
    </div>

    <!-- Outer drop zone (for OS file upload) -->
    <div
      class="drop-zone"
      :class="{ 'drag-over': isDragging }"
      @dragover.prevent="onOuterDragOver"
      @dragleave="isDragging = false"
      @drop.prevent="handleDrop"
    >
      <!-- File table -->
      <el-table
        :data="filteredFiles"
        v-loading="filesStore.loading"
        style="width: 100%"
        :row-class-name="rowClassName"
        @row-dblclick="handleRowDblClick"
        empty-text="空目录"
      >
        <el-table-column label="名称" prop="name" sortable min-width="300">
          <template #default="{ row }">
            <div
              class="file-name"
              :class="{ 'no-drag': !auth.canWrite }"
              :draggable="auth.canWrite"
              @dragstart="auth.canWrite ? onRowDragStart($event, row) : null"
              @dragend="auth.canWrite ? onRowDragEnd() : null"
              @dragover.prevent="auth.canWrite && row.isDirectory ? onFolderDragOver($event, row) : null"
              @dragleave="auth.canWrite && row.isDirectory ? onFolderDragLeave(row) : null"
              @drop.stop.prevent="auth.canWrite && row.isDirectory ? onFolderDrop($event, row) : null"
            >
              <el-icon v-if="row.isDirectory" color="#e6a23c"><Folder /></el-icon>
              <el-icon v-else color="#909399"><Document /></el-icon>
              <span>{{ row.name }}</span>
              <!-- Badge: show supported operations for non-directory files -->
              <el-tooltip v-if="!row.isDirectory && (isPreviewable(row.name) || isEditable(row.name))" placement="top">
                <template #content>
                  <div v-if="isEditable(row.name)">
                    支持在线预览 &amp; 编辑<br />
                    可编辑格式: {{ EDITABLE_EXTS_LABEL }}
                  </div>
                  <div v-else-if="isImage(row.name)">
                    支持图片预览<br />
                    可预览格式: {{ [...IMAGE_EXTS].join(', ') }}
                  </div>
                  <div v-else>
                    支持在线预览<br />
                    可预览格式: {{ PREVIEWABLE_EXTS_LABEL }}
                  </div>
                </template>
                <el-tag size="small" :type="isEditable(row.name) ? 'success' : isImage(row.name) ? 'warning' : 'info'" style="margin-left:6px; cursor:default;">
                  {{ isEditable(row.name) ? '可编辑' : isImage(row.name) ? '图片' : '可预览' }}
                </el-tag>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="120" sortable :sort-method="(a, b) => (a.size || 0) - (b.size || 0)">
          <template #default="{ row }">
            {{ row.isDirectory ? '—' : formatSize(row.size) }}
          </template>
        </el-table-column>
        <el-table-column label="修改时间" width="180">
          <template #default="{ row }">{{ formatDate(row.mtime) }}</template>
        </el-table-column>

        <!-- Unified "..." action column -->
        <el-table-column label="操作" width="72" fixed="right" align="center">
          <template #default="{ row }">
            <el-dropdown trigger="click" @command="cmd => handleCommand(cmd, row)" @click.stop>
              <el-button text size="small" class="action-more-btn" @click.stop>
                <el-icon :size="18"><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <!-- Preview (read, non-directory, previewable) -->
                  <el-dropdown-item v-if="!row.isDirectory && isPreviewable(row.name)" command="preview" :icon="View">
                    预览
                  </el-dropdown-item>
                  <!-- Edit (write, non-directory, editable) -->
                  <el-dropdown-item v-if="auth.canWrite && !row.isDirectory && isEditable(row.name)" command="edit" :icon="EditPen">
                    编辑
                  </el-dropdown-item>
                  <!-- Download (non-directory) -->
                  <el-dropdown-item v-if="!row.isDirectory" command="download" :icon="Download">
                    下载
                  </el-dropdown-item>
                  <!-- Rename (write) -->
                  <el-dropdown-item v-if="auth.canWrite" command="rename" :icon="Edit" divided>
                    重命名
                  </el-dropdown-item>
                  <!-- Move to parent (write, not already at root) -->
                  <el-dropdown-item v-if="auth.canWrite && filesStore.currentPath !== '/'" command="moveup" :icon="Top">
                    移动到上级目录
                  </el-dropdown-item>
                  <!-- Delete (delete) -->
                  <el-dropdown-item v-if="auth.canDelete" command="delete" :icon="Delete" divided class="danger-item">
                    删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="isDragging" class="drag-overlay">
        <el-icon :size="48"><Upload /></el-icon>
        <p>拖拽文件到这里上传</p>
      </div>
    </div>

    <!-- Upload dialog -->
    <el-dialog v-model="showUpload" title="上传文件" width="500">
      <el-upload
        drag
        multiple
        :auto-upload="false"
        :file-list="uploadFiles"
        :on-change="onFileChange"
        :on-remove="onFileRemove"
      >
        <el-icon :size="48"><Upload /></el-icon>
        <div>拖拽文件到此处，或 <em>点击选择</em></div>
      </el-upload>
      <template #footer>
        <el-button @click="showUpload = false">取消</el-button>
        <el-button type="primary" :loading="uploading" @click="doUpload">上传</el-button>
      </template>
    </el-dialog>

    <!-- Mkdir dialog -->
    <el-dialog v-model="showMkdir" title="新建文件夹" width="400">
      <el-input v-model="newDirName" placeholder="文件夹名称" @keyup.enter="doMkdir" />
      <template #footer>
        <el-button @click="showMkdir = false">取消</el-button>
        <el-button type="primary" @click="doMkdir">创建</el-button>
      </template>
    </el-dialog>

    <!-- Rename dialog -->
    <el-dialog v-model="showRename" title="重命名" width="400">
      <el-input v-model="renameName" placeholder="新名称" @keyup.enter="doRename" />
      <template #footer>
        <el-button @click="showRename = false">取消</el-button>
        <el-button type="primary" @click="doRename">确认</el-button>
      </template>
    </el-dialog>

    <!-- Delete confirm dialog -->
    <el-dialog v-model="showDeleteConfirm" title="确认删除" width="380">
      <span>确定要删除 <strong>{{ deleteTarget?.name }}</strong> 吗？此操作不可恢复。</span>
      <template #footer>
        <el-button @click="showDeleteConfirm = false">取消</el-button>
        <el-button type="danger" @click="confirmDelete">删除</el-button>
      </template>
    </el-dialog>

    <!-- Preview / Edit dialog -->
    <el-dialog
      v-model="showEditor"
      :title="editorTitle"
      width="900"
      top="4vh"
      destroy-on-close
      :close-on-click-modal="!editorDirty"
    >
      <div v-loading="editorLoading" class="editor-wrap">
        <!-- Image preview -->
        <template v-if="editorRow && isImage(editorRow.name)">
          <div class="image-preview-wrap">
            <img :src="editorImageUrl" :alt="editorRow.name" class="preview-image" />
          </div>
        </template>
        <!-- Edit mode: plain textarea -->
        <template v-else-if="editorMode === 'edit'">
          <el-input
            v-model="editorContent"
            type="textarea"
            :rows="24"
            class="editor-textarea"
            @input="editorDirty = true"
          />
        </template>
        <!-- Preview mode: markdown or plain text -->
        <template v-else-if="editorMode === 'preview'">
          <div v-if="editorIsMarkdown" class="markdown-body" v-html="renderedMarkdown" />
          <pre v-else class="plain-text">{{ editorContent }}</pre>
        </template>
      </div>
      <template #footer>
        <div class="editor-footer">
          <div class="editor-footer-left">
            <!-- Toggle preview/edit for editable files when user has write -->
            <el-button
              v-if="editorRow && isEditable(editorRow.name) && auth.canWrite"
              @click="toggleEditorMode"
            >
              {{ editorMode === 'edit' ? '切换预览' : '切换编辑' }}
            </el-button>
          </div>
          <div class="editor-footer-right">
            <el-button @click="closeEditor">关闭</el-button>
            <el-button v-if="!editorRow?.isDirectory" @click="handleDownload(editorRow)">下载</el-button>
            <el-button
              v-if="editorRow && !isImage(editorRow.name) && editorMode === 'edit' && auth.canWrite"
              type="primary"
              :loading="editorSaving"
              :disabled="!editorDirty"
              @click="saveEditor"
            >
              保存
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { marked } from 'marked'
import {
  Upload, FolderAdd, Refresh, Folder, Document, Download, Edit, Delete,
  MoreFilled, View, EditPen, Top, Search
} from '@element-plus/icons-vue'
import { useFilesStore } from '../stores/files.js'
import { useAuthStore } from '../stores/auth.js'
import { uploadFile, downloadFile, deleteFile, renameFile, mkdirApi } from '../api/files.js'
import api from '../api/index.js'
import { formatSize, formatDate } from '../utils/format.js'

marked.setOptions({ breaks: true })

// Editable: plain text formats that make sense for textarea editing
const EDITABLE_EXTS = new Set(['txt', 'md', 'json', 'js', 'ts', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'env', 'ini', 'conf'])
const EDITABLE_EXTS_LABEL = [...EDITABLE_EXTS].join(', ')
// Previewable-only: read-only view (complex / large formats)
const PREVIEWABLE_ONLY_EXTS = new Set(['log'])
// Image preview
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'])
const PREVIEWABLE_EXTS_LABEL = [...EDITABLE_EXTS, ...PREVIEWABLE_ONLY_EXTS, ...IMAGE_EXTS].join(', ')

const filesStore = useFilesStore()
const auth = useAuthStore()

// --- Filter ---
const filterText = ref('')
const filteredFiles = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  if (!q) return filesStore.files
  return filesStore.files.filter(f => f.name.toLowerCase().includes(q))
})

// --- Upload ---
const showUpload = ref(false)
const uploading = ref(false)
const uploadFiles = ref([])
const isDragging = ref(false)

// --- Mkdir / Rename ---
const showMkdir = ref(false)
const showRename = ref(false)
const newDirName = ref('')
const renameName = ref('')
const renameTarget = ref(null)

// --- Delete ---
const showDeleteConfirm = ref(false)
const deleteTarget = ref(null)

// --- Drag-to-move ---
const draggingRow = ref(null)
const dragOverFolderName = ref(null)

// --- Editor / Preview ---
const showEditor = ref(false)
const editorMode = ref('preview') // 'preview' | 'edit'
const editorRow = ref(null)
const editorTitle = ref('')
const editorContent = ref('')
const editorLoading = ref(false)
const editorSaving = ref(false)
const editorDirty = ref(false)
const editorIsMarkdown = computed(() => editorRow.value && getExt(editorRow.value.name) === 'md')
const renderedMarkdown = computed(() => editorIsMarkdown.value ? marked.parse(editorContent.value) : '')
const editorImageUrl = ref('')

// ===================== Helpers =====================

function buildPath(name) {
  return filesStore.currentPath === '/' ? '/' + name : filesStore.currentPath + '/' + name
}

function parentPath() {
  const parts = filesStore.currentPath.split('/').filter(Boolean)
  parts.pop()
  return parts.length === 0 ? '/' : '/' + parts.join('/')
}

function getExt(name) {
  return ((name || '').split('.').pop() || '').toLowerCase()
}

function isEditable(name) {
  return EDITABLE_EXTS.has(getExt(name))
}

function isImage(name) {
  return IMAGE_EXTS.has(getExt(name))
}

function isPreviewable(name) {
  return EDITABLE_EXTS.has(getExt(name)) || PREVIEWABLE_ONLY_EXTS.has(getExt(name)) || IMAGE_EXTS.has(getExt(name))
}

function rowClassName({ row }) {
  if (row.isDirectory && dragOverFolderName.value === row.name) return 'folder-drop-target'
  if (draggingRow.value && draggingRow.value.name === row.name) return 'row-dragging'
  return ''
}

onMounted(() => filesStore.loadDir('/'))

function refresh() {
  filesStore.loadDir(filesStore.currentPath)
}

// ===================== Dropdown command dispatcher =====================

function handleCommand(cmd, row) {
  switch (cmd) {
    case 'preview':  openEditor(row, 'preview'); break
    case 'edit':     openEditor(row, 'edit');    break
    case 'download': handleDownload(row);         break
    case 'rename':   openRename(row);             break
    case 'moveup':   handleMoveUp(row);           break
    case 'delete':   openDeleteConfirm(row);      break
  }
}

// ===================== Double click =====================

function handleRowDblClick(row) {
  if (row.isDirectory) {
    filesStore.loadDir(buildPath(row.name))
  } else if (isPreviewable(row.name)) {
    openEditor(row, 'preview')
  }
}

// ===================== Editor / Preview =====================

async function openEditor(row, mode) {
  editorRow.value = row
  editorTitle.value = (mode === 'edit' ? '编辑 — ' : '预览 — ') + row.name
  editorMode.value = mode
  editorContent.value = ''
  editorImageUrl.value = ''
  editorDirty.value = false
  editorLoading.value = true
  showEditor.value = true
  try {
    const res = await downloadFile(buildPath(row.name))
    if (isImage(row.name)) {
      // Release previous object URL if any
      if (editorImageUrl.value) URL.revokeObjectURL(editorImageUrl.value)
      editorImageUrl.value = URL.createObjectURL(res.data)
    } else {
      editorContent.value = await res.data.text()
    }
  } catch {
    ElMessage.error('文件加载失败')
    showEditor.value = false
  } finally {
    editorLoading.value = false
  }
}

function toggleEditorMode() {
  editorMode.value = editorMode.value === 'edit' ? 'preview' : 'edit'
  editorTitle.value = (editorMode.value === 'edit' ? '编辑 — ' : '预览 — ') + editorRow.value.name
}

async function saveEditor() {
  editorSaving.value = true
  try {
    const blob = new Blob([editorContent.value], { type: 'text/plain' })
    const file = new File([blob], editorRow.value.name)
    const dir = filesStore.currentPath
    await uploadFile(file, dir)
    ElMessage.success('已保存')
    editorDirty.value = false
    refresh()
  } catch {
    ElMessage.error('保存失败')
  } finally {
    editorSaving.value = false
  }
}

function closeEditor() {
  if (editorDirty.value) {
    ElMessageBox.confirm('有未保存的修改，确认放弃？', '提示', {
      confirmButtonText: '放弃',
      cancelButtonText: '继续编辑',
      type: 'warning'
    }).then(() => {
      showEditor.value = false
      editorDirty.value = false
      if (editorImageUrl.value) { URL.revokeObjectURL(editorImageUrl.value); editorImageUrl.value = '' }
    }).catch(() => {})
  } else {
    showEditor.value = false
    if (editorImageUrl.value) { URL.revokeObjectURL(editorImageUrl.value); editorImageUrl.value = '' }
  }
}

// ===================== Download =====================

async function handleDownload(row) {
  try {
    const res = await downloadFile(buildPath(row.name))
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = row.name
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    ElMessage.error('下载失败')
  }
}

// ===================== Delete =====================

function openDeleteConfirm(row) {
  deleteTarget.value = row
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  showDeleteConfirm.value = false
  try {
    await deleteFile(buildPath(deleteTarget.value.name))
    ElMessage.success('已删除')
    refresh()
  } catch {
    ElMessage.error('删除失败')
  }
}

// ===================== Rename =====================

function openRename(row) {
  renameTarget.value = row
  renameName.value = row.name
  showRename.value = true
}

async function doRename() {
  if (!renameName.value.trim()) return
  try {
    const base = filesStore.currentPath === '/' ? '/' : filesStore.currentPath + '/'
    await renameFile(base + renameTarget.value.name, base + renameName.value.trim())
    ElMessage.success('已重命名')
    showRename.value = false
    refresh()
  } catch {
    ElMessage.error('重命名失败')
  }
}

// ===================== Move to parent =====================

async function handleMoveUp(row) {
  const parent = parentPath()
  const base = filesStore.currentPath === '/' ? '' : filesStore.currentPath
  const oldPath = base + '/' + row.name
  // parent === '/' → newPath = '/' + name, else parent + '/' + name
  const newPath = parent === '/' ? '/' + row.name : parent + '/' + row.name
  try {
    await renameFile(oldPath, newPath)
    ElMessage.success(`已移动到上级目录`)
    refresh()
  } catch {
    ElMessage.error('移动失败')
  }
}

// ===================== Mkdir =====================

async function doMkdir() {
  if (!newDirName.value.trim()) return
  try {
    await mkdirApi(buildPath(newDirName.value.trim()))
    ElMessage.success('文件夹已创建')
    showMkdir.value = false
    newDirName.value = ''
    refresh()
  } catch {
    ElMessage.error('创建失败')
  }
}

// ===================== Upload =====================

function onFileChange(file, fileList) { uploadFiles.value = fileList }
function onFileRemove(file, fileList) { uploadFiles.value = fileList }

async function doUpload() {
  if (!uploadFiles.value.length) return
  uploading.value = true
  try {
    for (const f of uploadFiles.value) {
      await uploadFile(f.raw, filesStore.currentPath)
    }
    ElMessage.success('上传成功')
    showUpload.value = false
    uploadFiles.value = []
    refresh()
  } catch {
    ElMessage.error('上传失败')
  } finally {
    uploading.value = false
  }
}

// ===================== OS File Drop =====================

function onOuterDragOver(e) {
  if (!e.dataTransfer.types.includes('application/sftp-move')) {
    isDragging.value = true
  }
}

async function handleDrop(e) {
  isDragging.value = false
  if (e.dataTransfer.types.includes('application/sftp-move')) return
  const droppedFiles = e.dataTransfer.files
  if (!droppedFiles.length) return
  uploading.value = true
  try {
    for (const file of droppedFiles) {
      await uploadFile(file, filesStore.currentPath)
    }
    ElMessage.success('上传成功')
    refresh()
  } catch {
    ElMessage.error('上传失败')
  } finally {
    uploading.value = false
  }
}

// ===================== Row drag-to-move =====================

function onRowDragStart(e, row) {
  draggingRow.value = row
  e.dataTransfer.setData('application/sftp-move', row.name)
  e.dataTransfer.effectAllowed = 'move'
}

function onRowDragEnd() {
  draggingRow.value = null
  dragOverFolderName.value = null
}

function onFolderDragOver(e, row) {
  if (!draggingRow.value || draggingRow.value.name === row.name) return
  e.dataTransfer.dropEffect = 'move'
  dragOverFolderName.value = row.name
}

function onFolderDragLeave(row) {
  if (dragOverFolderName.value === row.name) {
    dragOverFolderName.value = null
  }
}

async function onFolderDrop(e, targetFolder) {
  dragOverFolderName.value = null
  const src = draggingRow.value
  draggingRow.value = null
  if (!src || src.name === targetFolder.name) return

  const base = filesStore.currentPath === '/' ? '' : filesStore.currentPath
  const oldPath = base + '/' + src.name
  const newPath = base + '/' + targetFolder.name + '/' + src.name
  try {
    await renameFile(oldPath, newPath)
    ElMessage.success(`已移动到文件夹 "${targetFolder.name}"`)
    refresh()
  } catch {
    ElMessage.error('移动失败')
  }
}
</script>

<style scoped>
.file-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}
.toolbar-actions {
  display: flex;
  gap: 8px;
}
.drop-zone {
  position: relative;
  flex: 1;
}
.drop-zone.drag-over {
  outline: 2px dashed #409eff;
  outline-offset: -4px;
  border-radius: 8px;
}
.drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(64, 158, 255, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #409eff;
  pointer-events: none;
  border-radius: 8px;
  z-index: 10;
}
.file-name {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: grab;
  user-select: none;
}
.file-name.no-drag {
  cursor: default;
}
.file-name:not(.no-drag):active {
  cursor: grabbing;
}

.action-more-btn {
  color: #909399;
  padding: 4px !important;
}
.action-more-btn:hover {
  color: #409eff;
}
/* Hide any extra arrow/indicator that el-dropdown appends beside icon-only buttons */
:deep(.el-dropdown .el-dropdown__caret-button),
:deep(.el-dropdown > span.el-dropdown__indicator) {
  display: none !important;
}
:global(.danger-item) {
  color: #f56c6c !important;
}

/* Drag-to-move target highlight */
:global(.folder-drop-target td) {
  background: #ecf5ff !important;
  outline: 2px dashed #409eff;
}
:global(.row-dragging td) {
  opacity: 0.4;
}

/* Image preview */
.image-preview-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 6px;
  min-height: 200px;
}
.preview-image {
  max-width: 100%;
  max-height: 65vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
}

/* Editor / Preview */
.editor-wrap {
  max-height: 72vh;
  overflow-y: auto;
}
.editor-textarea :deep(.el-textarea__inner) {
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
}
.plain-text {
  white-space: pre-wrap;
  word-break: break-all;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  background: #f8f9fa;
  padding: 16px;
  border-radius: 6px;
  margin: 0;
}
.editor-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}
.editor-footer-right {
  display: flex;
  gap: 8px;
}

/* Markdown */
.markdown-body {
  font-size: 15px;
  line-height: 1.75;
  padding: 8px 16px;
}
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin: 16px 0 8px;
  font-weight: 600;
}
.markdown-body :deep(h1) { font-size: 1.6em; border-bottom: 1px solid #ebeef5; padding-bottom: 6px; }
.markdown-body :deep(h2) { font-size: 1.3em; border-bottom: 1px solid #ebeef5; padding-bottom: 4px; }
.markdown-body :deep(code) {
  background: #f0f0f0;
  padding: 2px 5px;
  border-radius: 4px;
  font-family: Consolas, monospace;
  font-size: 0.9em;
}
.markdown-body :deep(pre) {
  background: #f6f8fa;
  padding: 14px;
  border-radius: 6px;
  overflow-x: auto;
}
.markdown-body :deep(pre code) { background: none; padding: 0; }
.markdown-body :deep(blockquote) {
  border-left: 4px solid #dfe2e5;
  color: #6a737d;
  padding: 0 16px;
  margin: 0 0 16px;
}
.markdown-body :deep(table) { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
.markdown-body :deep(th),
.markdown-body :deep(td) { border: 1px solid #dfe2e5; padding: 6px 12px; }
.markdown-body :deep(th) { background: #f6f8fa; }
.markdown-body :deep(a) { color: #409eff; }
.markdown-body :deep(ul),
.markdown-body :deep(ol) { padding-left: 24px; margin-bottom: 12px; }
</style>
