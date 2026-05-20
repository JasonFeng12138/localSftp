<template>
  <div class="setup-page">
    <div class="setup-card">
      <div class="setup-header">
        <div class="setup-logo">📁</div>
        <h2>欢迎使用 Local SFTP</h2>
        <p class="setup-subtitle">首次使用，请完成初始化设置</p>
      </div>

      <el-steps :active="step" finish-status="success" align-center style="margin-bottom: 32px;">
        <el-step title="管理员账号" />
        <el-step title="文件存储目录" />
        <el-step title="完成" />
      </el-steps>

      <!-- Step 0: 创建管理员 -->
      <div v-if="step === 0">
        <el-form ref="adminForm" :model="form" :rules="adminRules" label-width="100px">
          <el-form-item label="用户名" prop="username">
            <el-input v-model="form.username" placeholder="请输入管理员用户名" clearable />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="form.password" type="password" placeholder="至少 6 位" show-password />
          </el-form-item>
          <el-form-item label="确认密码" prop="confirmPassword">
            <el-input v-model="form.confirmPassword" type="password" placeholder="再次输入密码" show-password />
          </el-form-item>
        </el-form>
        <div class="step-footer">
          <el-button type="primary" size="large" @click="nextStep(0)">下一步</el-button>
        </div>
      </div>

      <!-- Step 1: 选择存储目录 -->
      <div v-if="step === 1">
        <div class="dir-picker">
          <div class="dir-current">
            <span class="dir-label">当前路径：</span>
            <span class="dir-path">{{ currentDir }}</span>
            <el-button text size="small" :disabled="currentDir === homeDir" @click="goUp">
              ↑ 上级
            </el-button>
          </div>

          <div class="dir-list" v-loading="dirsLoading">
            <!-- 新建文件夹输入框 -->
            <div v-if="newFolderMode" class="dir-item dir-new">
              <el-input
                v-model="newFolderName"
                size="small"
                placeholder="输入文件夹名称"
                autofocus
                @keyup.enter="createFolder"
                @keyup.escape="newFolderMode = false"
              >
                <template #append>
                  <el-button @click="createFolder">确认</el-button>
                </template>
              </el-input>
            </div>
            <div
              v-for="dir in dirs"
              :key="dir.path"
              class="dir-item"
              :class="{ selected: form.sftpRoot === dir.path }"
              @click="selectDir(dir.path)"
              @dblclick="enterDir(dir.path)"
            >
              <span class="dir-icon">📂</span>
              <span class="dir-name">{{ dir.name }}</span>
              <el-tag v-if="form.sftpRoot === dir.path" size="small" type="success" style="margin-left: auto;">已选</el-tag>
            </div>
            <div v-if="!dirsLoading && dirs.length === 0" class="dir-empty">
              此目录没有子文件夹
            </div>
          </div>

          <div class="dir-actions">
            <el-button size="small" @click="newFolderMode = true">＋ 新建文件夹</el-button>
            <span class="dir-selected-tip" v-if="form.sftpRoot">
              已选：<code>{{ form.sftpRoot }}</code>
            </span>
          </div>

          <el-alert v-if="!form.sftpRoot" type="info" :closable="false" style="margin-top: 12px;">
            双击进入子目录，单击选中作为存储目录；也可直接点"使用当前目录"
          </el-alert>
          <el-alert v-else type="success" :closable="false" style="margin-top: 12px;">
            上传的文件将存储在此目录下，可在 App 内随时修改
          </el-alert>
        </div>

        <div class="step-footer">
          <el-button size="large" @click="step = 0">上一步</el-button>
          <el-button size="large" @click="useCurrentDir">使用当前目录</el-button>
          <el-button type="primary" size="large" :disabled="!form.sftpRoot" @click="nextStep(1)">下一步</el-button>
        </div>
      </div>

      <!-- Step 2: 完成 -->
      <div v-if="step === 2" class="step-done">
        <el-result
          v-if="!setupError"
          icon="success"
          title="初始化完成！"
          :sub-title="`管理员账号「${form.username}」已创建，可以开始使用了`"
        >
          <template #extra>
            <el-button type="primary" size="large" :loading="submitting" @click="finish">
              进入应用
            </el-button>
          </template>
        </el-result>
        <el-result v-else icon="error" title="初始化失败" :sub-title="setupError">
          <template #extra>
            <el-button @click="step = 0">重新设置</el-button>
          </template>
        </el-result>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { completeSetup, getSetupDirs } from '../api/status.js'
import api from '../api/index.js'
import { resetSetupCheck } from '../router/index.js'

const router = useRouter()
const step = ref(0)
const submitting = ref(false)
const setupError = ref('')
const adminForm = ref(null)

const form = ref({
  username: '',
  password: '',
  confirmPassword: '',
  sftpRoot: ''
})

const adminRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, max: 32, message: '用户名 2-32 位', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_-]+$/, message: '只能包含字母、数字、_ 和 -', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (rule, value, cb) => {
        if (value !== form.value.password) cb(new Error('两次密码不一致'))
        else cb()
      },
      trigger: 'blur'
    }
  ]
}

// 目录浏览
const homeDir = ref('')
const currentDir = ref('')
const dirs = ref([])
const dirsLoading = ref(false)
const newFolderMode = ref(false)
const newFolderName = ref('')

async function loadDirs(p) {
  dirsLoading.value = true
  try {
    const res = await getSetupDirs(p)
    currentDir.value = res.data.current
    dirs.value = res.data.dirs
  } catch {
    dirs.value = []
  } finally {
    dirsLoading.value = false
  }
}

function selectDir(p) {
  form.value.sftpRoot = p
}

function enterDir(p) {
  form.value.sftpRoot = ''
  loadDirs(p)
}

function goUp() {
  const sep = currentDir.value.includes('\\') && !currentDir.value.includes('/') ? '\\' : '/'
  const trimmed = currentDir.value.replace(/[\\/]+$/, '')
  const lastIdx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  let parent
  if (lastIdx < 0) {
    parent = sep === '\\' ? trimmed : '/'
  } else {
    parent = trimmed.slice(0, lastIdx) || sep
    if (/^[A-Za-z]:$/.test(parent)) parent = parent + '\\'
  }
  if (parent === homeDir.value || parent.startsWith(homeDir.value + '/') || parent.startsWith(homeDir.value + '\\')) {
    loadDirs(parent)
  }
}

function useCurrentDir() {
  form.value.sftpRoot = currentDir.value
}

function getPathSeparator(dir) {
  return dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
}

function joinChildPath(parent, child) {
  const separator = getPathSeparator(parent)
  const trailingSeparators = separator === '\\' ? /[\\]+$/ : /\/+$/
  const normalizedParent = parent.replace(trailingSeparators, '')
  return normalizedParent ? `${normalizedParent}${separator}${child}` : child
}

async function createFolder() {
  const folderName = newFolderName.value.trim()
  if (!folderName) return
  // 验证文件夹名：不含路径分隔符或特殊目录名
  if (folderName === '.' || folderName === '..') {
    ElMessage.warning('文件夹名不能为 . 或 ..')
    return
  }
  if (folderName.includes('/') || folderName.includes('\\')) {
    ElMessage.warning('文件夹名不能包含 / 或 \\')
    return
  }
  const newPath = joinChildPath(currentDir.value, folderName)
  // 本地先记录选中（服务端 completeSetup 时会自动 mkdir）
  newFolderMode.value = false
  newFolderName.value = ''
  // 把新路径追加到列表中显示
  dirs.value.push({ name: folderName, path: newPath })
  form.value.sftpRoot = newPath
  ElMessage.success('已选中，初始化完成后将自动创建此文件夹')
}

async function nextStep(current) {
  if (current === 0) {
    await adminForm.value.validate()
    // 加载目录
    if (!currentDir.value) {
      const res = await getSetupDirs()
      homeDir.value = res.data.current
      currentDir.value = res.data.current
      dirs.value = res.data.dirs
    }
    step.value = 1
  } else if (current === 1) {
    step.value = 2
    await doSetup()
  }
}

async function doSetup() {
  submitting.value = true
  setupError.value = ''
  try {
    await completeSetup({
      username: form.value.username,
      password: form.value.password,
      sftpRoot: form.value.sftpRoot
    })
    // setup 完成，重置路由守卫缓存，下次导航会重新检查
    resetSetupCheck()
  } catch (err) {
    setupError.value = err.response?.data?.error || '初始化失败，请重试'
  } finally {
    submitting.value = false
  }
}

async function finish() {
  router.push('/login')
}

onMounted(async () => {
  // 预加载 home 目录（后台）
  try {
    const res = await getSetupDirs()
    homeDir.value = res.data.current
  } catch {}
})
</script>

<style scoped>
.setup-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  padding: 24px;
}

.setup-card {
  background: var(--glass-bg-strong);
  border-radius: 18px;
  padding: 40px;
  width: 100%;
  max-width: 560px;
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(var(--glass-blur));
}

.setup-header {
  text-align: center;
  margin-bottom: 32px;
}

.setup-logo {
  font-size: 48px;
  margin-bottom: 12px;
}

.setup-header h2 {
  margin: 0 0 8px;
  font-size: 24px;
  color: #0f172a;
}

.setup-subtitle {
  color: #909399;
  margin: 0;
}

.step-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.dir-picker {
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 10px;
  overflow: hidden;
}

.dir-current {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.7);
  border-bottom: 1px solid rgba(148, 163, 184, 0.35);
  font-size: 13px;
}

.dir-label {
  color: #909399;
  white-space: nowrap;
}

.dir-path {
  font-family: monospace;
  color: #303133;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-list {
  max-height: 220px;
  overflow-y: auto;
  min-height: 60px;
}

.dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
  transition: background 0.15s;
  font-size: 14px;
}

.dir-item:hover {
  background: #f5f7fa;
}

.dir-item.selected {
  background: #ecf5ff;
}

.dir-new {
  padding: 8px 14px;
  cursor: default;
}

.dir-empty {
  padding: 20px;
  text-align: center;
  color: #c0c4cc;
  font-size: 13px;
}

.dir-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: #fafafa;
  border-top: 1px solid #e4e7ed;
  font-size: 13px;
}

.dir-selected-tip {
  color: #67c23a;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dir-selected-tip code {
  font-family: monospace;
  font-size: 12px;
}

.step-done {
  text-align: center;
  padding: 16px 0;
}
</style>
