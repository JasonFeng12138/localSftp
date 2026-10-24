<template>
  <div class="server-status page-stack">
    <PageHeading title="系统状态" description="查看服务运行信息、存储位置与网络接口。" eyebrow="服务概览">
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新状态</el-button>
    </PageHeading>
    <div class="metric-grid" v-loading="loading">
      <div class="metric-card"><span class="metric-icon"><el-icon><Connection /></el-icon></span><div><span class="metric-label">SFTP 连接</span><strong class="metric-value">{{ status.sftpConnections ?? '—' }}<small>个连接</small></strong></div></div>
      <div class="metric-card"><span class="metric-icon is-green"><el-icon><Timer /></el-icon></span><div><span class="metric-label">服务运行时间</span><strong class="metric-value uptime-value">{{ formatUptime(status.uptime || 0) }}</strong></div></div>
      <div class="metric-card"><span class="metric-icon is-amber"><el-icon><Monitor /></el-icon></span><div><span class="metric-label">内存占用</span><strong class="metric-value">{{ formatSize(status.memoryUsage || 0) }}</strong></div></div>
    </div>
    <section class="surface-panel" v-loading="loading">
      <div class="panel-heading"><div><h2>服务信息</h2><p>当前主机与文件存储配置</p></div><el-tag type="info" effect="plain">SFTP / Web API</el-tag></div>
      <dl class="system-grid">
        <div><dt>主机名</dt><dd>{{ status.hostname || '—' }}</dd></div>
        <div><dt>操作平台</dt><dd>{{ status.platform || '—' }}</dd></div>
        <div><dt>SFTP 端口</dt><dd><code>{{ status.sftpPort || '—' }}</code></dd></div>
        <div><dt>Web API 端口</dt><dd><code>{{ status.webPort || '—' }}</code></dd></div>
        <div class="storage-setting"><dt>文件存储目录</dt><dd><code>{{ status.sftpRoot || '—' }}</code><el-button v-if="auth.user?.permissions?.includes('admin')" text size="small" type="primary" @click="openRootDialog">修改路径</el-button></dd></div>
      </dl>
    </section>
    <section class="surface-panel">
      <div class="panel-heading"><div><h2>网络接口</h2><p>通过以下地址连接到当前主机</p></div><span class="panel-meta">{{ status.networkInterfaces?.length || 0 }} 个接口</span></div>
    <el-table :data="status.networkInterfaces || []" v-loading="loading" style="width: 100%">
      <el-table-column prop="name" label="接口名称" width="200" />
      <el-table-column prop="address" label="IP 地址" min-width="280">
        <template #default="{ row }">
          <el-tag>{{ row.address }}</el-tag>
          <el-button text size="small" style="margin-left: 8px;" @click.stop.prevent="copySftpCmd(row.address)">
            复制 SFTP 命令
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    </section>

    <!-- 修改存储路径对话框 -->
    <el-dialog v-model="rootDialog" title="修改文件存储目录" width="540px" :close-on-click-modal="false">
      <el-alert type="warning" :closable="false" style="margin-bottom: 16px;">
        修改后立即生效，新路径若不存在会自动创建。已上传的文件不会自动迁移。
      </el-alert>
      <el-form label-width="80px">
        <el-form-item label="当前路径">
          <span style="font-family: monospace; font-size: 12px; color: #909399; word-break: break-all;">
            {{ status.sftpRoot }}
          </span>
        </el-form-item>
        <el-form-item label="新路径" required>
          <el-input v-model="newRoot" placeholder="选择下方目录或手动输入绝对路径" clearable />
        </el-form-item>
      </el-form>

      <!-- 目录浏览器 -->
      <div class="dir-picker" v-loading="browseDirsLoading">
        <div class="dir-current">
          <span class="dir-label">浏览：</span>
          <span class="dir-path">{{ browseCurrentDir }}</span>
          <el-button text size="small" @click="browseGoUp">↑ 上级</el-button>
        </div>
        <div class="dir-list">
          <div
            v-for="dir in browseDirs" :key="dir.path"
            class="dir-item"
            :class="{ selected: newRoot === dir.path }"
            @click="browsePick(dir.path)"
            @dblclick="browseEnter(dir.path)"
          >
            <el-icon><Folder /></el-icon>
            <span>{{ dir.name }}</span>
            <el-tag v-if="newRoot === dir.path" size="small" type="success" style="margin-left: auto;">已选</el-tag>
          </div>
          <div v-if="browseDirs.length === 0" class="dir-empty">此目录没有子文件夹</div>
        </div>
        <div class="dir-actions">
          <el-button size="small" @click="browsePick(browseCurrentDir)">使用当前目录</el-button>
        </div>
      </div>

      <template #footer>
        <el-button @click="rootDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRoot">确认修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.uptime-value { font-size: 18px; line-height: 1.5; }
.system-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; padding: 6px 24px; }
.system-grid > div { padding: 20px 0; min-width: 0; border-bottom: 1px solid var(--app-border); }
.system-grid dt { margin-bottom: 10px; color: var(--app-muted); font-size: 12px; }
.system-grid dd { margin: 0; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.system-grid code { font-family: 'Cascadia Code', Consolas, monospace; font-size: 13px; }
.system-grid .storage-setting { grid-column: 1 / -1; border-bottom: 0; }
.storage-setting dd { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.storage-setting code { min-width: 0; }
@media (max-width: 767px) { .system-grid { padding-inline: 18px; gap: 0 16px; } .uptime-value { font-size: 14px; } }
@media (max-width: 374px) { .system-grid { grid-template-columns: 1fr; } }
.dir-picker {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  overflow: hidden;
  margin-top: 4px;
}
.dir-current {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #e4e7ed;
  font-size: 12px;
}
.dir-label { color: #909399; white-space: nowrap; }
.dir-path { font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dir-list { max-height: 180px; overflow-y: auto; }
.dir-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; cursor: pointer;
  border-bottom: 1px solid #f0f0f0; font-size: 13px;
}
.dir-item:hover { background: #f5f7fa; }
.dir-item.selected { background: #ecf5ff; }
.dir-empty { padding: 16px; text-align: center; color: #c0c4cc; font-size: 13px; }
.dir-actions { padding: 6px 12px; background: #fafafa; border-top: 1px solid #e4e7ed; }
</style>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getStatus, updateSettings, getSettingsDirs } from '../api/status.js'
import { formatSize, formatUptime } from '../utils/format.js'
import { useAuthStore } from '../stores/auth.js'
import { Refresh, Connection, Timer, Monitor, Folder } from '@element-plus/icons-vue'
import PageHeading from '../components/PageHeading.vue'

const status = ref({})
const loading = ref(false)
const auth = useAuthStore()

const rootDialog = ref(false)
const newRoot = ref('')
const saving = ref(false)

// 目录浏览
const browseCurrentDir = ref('')
const browseDirs = ref([])
const browseDirsLoading = ref(false)

async function loadBrowseDirs(p) {
  browseDirsLoading.value = true
  try {
    const res = await getSettingsDirs(p)
    browseCurrentDir.value = res.data.current
    browseDirs.value = res.data.dirs
  } catch {
    browseDirs.value = []
  } finally {
    browseDirsLoading.value = false
  }
}

function getParentDir(currentPath) {
  if (!currentPath) return '/'
  const isWindowsPath = currentPath.includes('\\')
  const separator = isWindowsPath ? '\\' : '/'
  const windowsRootMatch = currentPath.match(/^[A-Za-z]:[\\/]?$/)
  if (currentPath === '/' || windowsRootMatch) {
    return windowsRootMatch ? `${windowsRootMatch[0].slice(0, 2)}\\` : '/'
  }
  const trimmedPath = currentPath.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(trimmedPath.lastIndexOf('/'), trimmedPath.lastIndexOf('\\'))
  if (lastSeparatorIndex < 0) {
    return isWindowsPath ? trimmedPath : '/'
  }
  const parent = trimmedPath.slice(0, lastSeparatorIndex)
  if (!parent) return separator
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`
  return parent
}

function browseGoUp() {
  const parent = getParentDir(browseCurrentDir.value)
  loadBrowseDirs(parent)
}

function browsePick(p) {
  newRoot.value = p
}

function browseEnter(p) {
  loadBrowseDirs(p)
}

async function load() {
  loading.value = true
  try {
    const res = await getStatus()
    status.value = res.data
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openRootDialog() {
  newRoot.value = status.value.sftpRoot || ''
  browseCurrentDir.value = ''
  browseDirs.value = []
  rootDialog.value = true
  loadBrowseDirs(status.value.sftpRoot || '')
}

async function saveRoot() {
  if (!newRoot.value.trim()) {
    ElMessage.warning('请输入路径')
    return
  }
  saving.value = true
  try {
    const res = await updateSettings({ sftpRoot: newRoot.value.trim() })
    status.value.sftpRoot = res.data.sftpRoot
    rootDialog.value = false
    ElMessage.success('存储路径已更新：' + res.data.sftpRoot)
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '修改失败')
  } finally {
    saving.value = false
  }
}

function buildSftpCmd(ip) {
  const port = status.value.sftpPort || 2222
  const username = auth.user?.username || 'admin'
  return `sftp -P ${port} ${username}@${ip}`
}

function copyByExecCommand(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  return ok
}

async function copySftpCmd(ip) {
  const cmd = buildSftpCmd(ip)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(cmd)
    } else {
      const ok = copyByExecCommand(cmd)
      if (!ok) throw new Error('copy failed')
    }
    ElMessage.success('已复制: ' + cmd)
  } catch {
    const ok = copyByExecCommand(cmd)
    if (ok) {
      ElMessage.success('已复制: ' + cmd)
      return
    }
    ElMessage.error('复制失败，请手动复制: ' + cmd)
  }
}
</script>
