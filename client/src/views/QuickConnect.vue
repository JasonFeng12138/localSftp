<template>
  <div class="quick-connect">
    <div class="page-header">
      <h3>快速连接</h3>
      <el-button :loading="loading" text @click="load">
        <el-icon><RefreshRight /></el-icon>
        刷新
      </el-button>
    </div>

    <!-- 局域网访问地址 -->
    <div class="section-block" v-loading="loading">
      <div class="section-title"><el-icon><Monitor /></el-icon> 局域网访问地址</div>
      <div v-if="data.lanAddresses?.length" class="address-grid">
        <div v-for="ip in data.lanAddresses" :key="ip" class="address-item">
          <div class="addr-url">http://{{ ip }}:{{ data.webPort }}</div>
          <div class="qr-wrap">
            <img v-if="qrMap[ip]" :src="qrMap[ip]" class="qr-img" :alt="`QR: http://${ip}:${data.webPort}`" />
            <div v-else class="qr-placeholder"><el-icon><Loading /></el-icon></div>
          </div>
          <el-button size="small" @click="copyUrl(`http://${ip}:${data.webPort}`)">
            <el-icon><CopyDocument /></el-icon> 复制地址
          </el-button>
        </div>
      </div>
      <el-empty v-else description="未检测到局域网 IP" />
    </div>

    <!-- 设备在线情况：两个小节合并在一个容器里 -->
    <div class="section-block">
      <!-- Web 登录设备 -->
      <div class="subsection-header">
        <span class="section-title"><el-icon><Monitor /></el-icon> 当前 Web 登录设备</span>
        <el-tag :type="data.webSessions?.length ? 'success' : 'info'" size="small">
          {{ data.webSessions?.length || 0 }} 个在线
        </el-tag>
      </div>
      <el-table :data="data.webSessions || []" style="width:100%" empty-text="暂无 Web 登录设备（10 分钟内有操作记录才会显示）">
        <el-table-column label="设备 IP" min-width="140">
          <template #default="{ row }">
            <el-tag type="primary" effect="plain">{{ row.ip || '未知' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="登录账号" min-width="120">
          <template #default="{ row }">
            <el-icon style="vertical-align:-2px"><User /></el-icon>
            {{ row.username }}
            <el-tag v-if="row.role === 'admin'" type="danger" size="small" style="margin-left:4px">管理员</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后活跃" min-width="180">
          <template #default="{ row }">{{ formatTime(row.lastSeen) }}</template>
        </el-table-column>
        <el-table-column label="设备信息" min-width="200">
          <template #default="{ row }">
            <span style="font-size:12px;color:#909399;">{{ parseUa(row.userAgent) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-popconfirm title="确认踢出该设备的 Web 登录？" confirm-button-text="踢出" cancel-button-text="取消" confirm-button-type="danger" @confirm="kickWeb(row.sessionKey)">
              <template #reference>
                <el-button size="small" type="danger" plain>踢出</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <div class="subsection-divider"></div>

      <!-- SFTP 连接设备 -->
      <div class="subsection-header">
        <span class="section-title"><el-icon><Connection /></el-icon> 当前 SFTP 连接设备</span>
        <el-tag :type="data.sftpConnections?.length ? 'success' : 'info'" size="small">
          {{ data.sftpConnections?.length || 0 }} 个在线
        </el-tag>
      </div>
      <el-table :data="data.sftpConnections || []" style="width:100%" empty-text="暂无 SFTP 连接">
        <el-table-column label="设备 IP" min-width="140">
          <template #default="{ row }">
            <el-tag type="primary" effect="plain">{{ row.ip || '未知' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="登录账号" min-width="120">
          <template #default="{ row }">
            <span v-if="row.username"><el-icon style="vertical-align:-2px"><User /></el-icon> {{ row.username }}</span>
            <el-tag v-else type="warning" size="small">认证中…</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="连接时间" min-width="180">
          <template #default="{ row }">{{ formatTime(row.connectedAt) }}</template>
        </el-table-column>
        <el-table-column label="在线时长" min-width="100">
          <template #default="{ row }">{{ elapsed(row.connectedAt) }}</template>
        </el-table-column>
        <el-table-column label="连接 ID" min-width="160">
          <template #default="{ row }">
            <span style="font-family:monospace;font-size:11px;color:#909399;">{{ row.connId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-popconfirm title="确认踢出该设备连接？" confirm-button-text="踢出" cancel-button-text="取消" confirm-button-type="danger" @confirm="kick(row.connId)">
              <template #reference>
                <el-button size="small" type="danger" plain>踢出</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- SFTP 连接说明 -->
    <div class="section-block" v-if="data.lanAddresses?.length">
      <div class="section-title"><el-icon><InfoFilled /></el-icon> SFTP 客户端连接说明</div>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="主机地址">
          <div v-for="ip in data.lanAddresses" :key="ip" style="font-family:monospace;">{{ ip }}</div>
        </el-descriptions-item>
        <el-descriptions-item label="SFTP 端口">
          <el-tag type="primary" effect="plain">{{ data.sftpPort || 2222 }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="用户名">使用 SFTP 账号（见用户管理）</el-descriptions-item>
        <el-descriptions-item label="连接协议">SFTP / SSH2</el-descriptions-item>
      </el-descriptions>
      <div class="sftp-cmds" style="margin-top:14px;">
        <div class="sftp-cmds-label">命令行连接示例：</div>
        <div v-for="ip in data.lanAddresses" :key="'sftp-' + ip" class="cmd-line">
          <code>sftp -P {{ data.sftpPort || 2222 }} &lt;用户名&gt;@{{ ip }}</code>
          <el-button size="small" text @click="copyUrl(`sftp -P ${data.sftpPort || 2222} <用户名>@${ip}`)">复制</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import QRCode from 'qrcode'
import {
  Monitor, Connection, User, CopyDocument,
  RefreshRight, InfoFilled, Loading
} from '@element-plus/icons-vue'
import { getConnections, kickConnection, kickWebSession } from '../api/status.js'

const data = ref({ lanAddresses: [], sftpConnections: [], webSessions: [], webPort: 3000, sftpPort: 2222 })
const loading = ref(false)
const qrMap = ref({})

async function generateQr(ip, port) {
  try {
    const url = `http://${ip}:${port}`
    qrMap.value[ip] = await QRCode.toDataURL(url, {
      width: 160,
      margin: 1,
      color: { dark: '#303133', light: '#ffffff' }
    })
  } catch {}
}

async function load() {
  loading.value = true
  try {
    const res = await getConnections()
    data.value = res.data
    // 生成每个 IP 的二维码
    for (const ip of res.data.lanAddresses || []) {
      generateQr(ip, res.data.webPort)
    }
  } catch (err) {
    ElMessage.error('加载失败：' + (err.response?.data?.error || err.message))
  } finally {
    loading.value = false
  }
}

function formatTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

function elapsed(iso) {
  if (!iso) return '-'
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs} 秒`
  if (secs < 3600) return `${Math.floor(secs / 60)} 分 ${secs % 60} 秒`
  return `${Math.floor(secs / 3600)} 时 ${Math.floor((secs % 3600) / 60)} 分`
}

async function copyUrl(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'; ta.style.left = '-9999px'
      document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

// 每 5 秒自动刷新连接列表（二维码不重复生成）
let timer = null
function startAutoRefresh() {
  timer = setInterval(async () => {
    try {
      const res = await getConnections()
      data.value.sftpConnections = res.data.sftpConnections
      data.value.webSessions = res.data.webSessions || []
    } catch {}
  }, 5000)
}

async function kick(connId) {
  try {
    await kickConnection(connId)
    ElMessage.success('已踢出该 SFTP 连接')
    data.value.sftpConnections = data.value.sftpConnections.filter(c => c.connId !== connId)
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '踢出失败')
  }
}

async function kickWeb(sessionKey) {
  try {
    await kickWebSession(sessionKey)
    ElMessage.success('已踢出该 Web 登录')
    data.value.webSessions = data.value.webSessions.filter(s => s.sessionKey !== sessionKey)
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '踢出失败')
  }
}

// 解析 User-Agent 为可读设备描述
function parseUa(ua) {
  if (!ua) return '未知设备'
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) {
    const m = ua.match(/Android[^;]*;\s*([^)]+)/)
    return m ? m[1].trim() : 'Android 设备'
  }
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/Linux/.test(ua)) return 'Linux'
  return ua.slice(0, 60)
}

onMounted(() => { load(); startAutoRefresh() })
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.quick-connect {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-header h3 {
  margin: 0;
  font-size: 18px;
  color: #0f172a;
}

/* 扁平 section 块：一个玻璃面板，内部不再嵌套卡片 */
.section-block {
  background: rgba(255, 255, 255, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(14px);
  padding: 16px 20px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 14px;
}

.subsection-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.subsection-header .section-title {
  margin-bottom: 0;
}

.subsection-divider {
  height: 1px;
  background: rgba(148, 163, 184, 0.2);
  margin: 20px -20px;
}

.address-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.address-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.6);
  min-width: 190px;
  max-width: 220px;
}

.qr-wrap {
  width: 150px;
  height: 150px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}

.qr-img {
  width: 150px;
  height: 150px;
  display: block;
}

.qr-placeholder {
  font-size: 32px;
  color: #c0c4cc;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

.addr-url {
  font-size: 12px;
  font-weight: 600;
  font-family: monospace;
  color: #2563eb;
  word-break: break-all;
  text-align: center;
  line-height: 1.4;
}

/* SFTP 连接说明：紧凑横排 */
.sftp-info-block {
  padding: 14px 20px;
}

.sftp-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #475569;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.meta-label {
  font-weight: 600;
  color: #94a3b8;
  margin-right: 4px;
  font-size: 12px;
}

.sftp-meta-sep {
  color: #cbd5e1;
}

.sftp-cmds {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sftp-cmds-label {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 4px;
}

.cmd-line {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(241, 245, 249, 0.8);
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
}

.cmd-line code {
  flex: 1;
  font-family: monospace;
  font-size: 13px;
  color: #334155;
}
</style>
