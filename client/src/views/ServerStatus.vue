<template>
  <div class="server-status">
    <h3 style="margin-bottom: 16px;">系统状态</h3>

    <el-descriptions :column="2" border v-loading="loading">
      <el-descriptions-item label="主机名">{{ status.hostname }}</el-descriptions-item>
      <el-descriptions-item label="平台">{{ status.platform }}</el-descriptions-item>
      <el-descriptions-item label="SFTP 端口">{{ status.sftpPort }}</el-descriptions-item>
      <el-descriptions-item label="Web API 端口">{{ status.webPort }}</el-descriptions-item>
      <el-descriptions-item label="SFTP 连接数">
        <el-tag type="success">{{ status.sftpConnections }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="运行时间">{{ formatUptime(status.uptime || 0) }}</el-descriptions-item>
      <el-descriptions-item label="内存占用">{{ formatSize(status.memoryUsage || 0) }}</el-descriptions-item>
    </el-descriptions>

    <h4 style="margin: 24px 0 12px;">网络接口</h4>
    <el-table :data="status.networkInterfaces || []" style="width: 100%">
      <el-table-column prop="name" label="接口名称" width="200" />
      <el-table-column prop="address" label="IP 地址">
        <template #default="{ row }">
          <el-tag>{{ row.address }}</el-tag>
          <el-button text size="small" style="margin-left: 8px;" @click.stop.prevent="copySftpCmd(row.address)">
            复制 SFTP 命令
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getStatus } from '../api/status.js'
import { formatSize, formatUptime } from '../utils/format.js'
import { useAuthStore } from '../stores/auth.js'

const status = ref({})
const loading = ref(false)
const auth = useAuthStore()

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
