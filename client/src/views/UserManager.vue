<template>
  <div class="user-manager">
    <div class="toolbar">
      <h3>用户管理</h3>
      <el-button type="primary" @click="showAdd = true">
        <el-icon><Plus /></el-icon> 新增用户
      </el-button>
    </div>

    <el-table :data="users" v-loading="loading" style="width: 100%">
      <el-table-column prop="username" label="用户名" width="160" />
      <el-table-column prop="role" label="角色" width="100">
        <template #default="{ row }">
          <el-tag :type="row.role === 'admin' ? 'danger' : 'info'" size="small">{{ row.role }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="homeDir" label="主目录" min-width="120" />
      <el-table-column label="权限" min-width="200">
        <template #default="{ row }">
          <div class="perm-tags">
            <el-tag v-for="p in row.permissions" :key="p" size="small">{{ p }}</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80">
        <template #default="{ row }">
          <el-tag :type="row.enabled ? 'success' : 'warning'" size="small">{{ row.enabled ? '启用' : '禁用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="180">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <div class="action-row">
            <el-button text size="small" @click="openEdit(row)">编辑</el-button>
            <el-button text size="small" :type="row.enabled ? 'warning' : 'success'" @click="toggleEnabled(row)">{{ row.enabled ? '禁用' : '启用' }}</el-button>
            <el-popconfirm title="确认删除该用户？" @confirm="handleDelete(row.username)">
              <template #reference>
                <el-button text size="small" type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- Add user dialog -->
    <el-dialog v-model="showAdd" title="新增用户" width="500">
      <el-form :model="addForm" label-width="80px">
        <el-form-item label="用户名">
          <el-input v-model="addForm.username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="addForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="addForm.role" @change="onRoleChange(addForm)">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="主目录">
          <div class="dir-input-row">
            <el-input v-model="addForm.homeDir" placeholder="/" readonly />
            <el-button @click="openDirPicker(addForm)">浏览</el-button>
          </div>
        </el-form-item>
        <el-form-item label="权限">
          <el-checkbox-group v-model="addForm.permissions" @change="enforcePermDeps(addForm)">
            <el-checkbox value="read">读取</el-checkbox>
            <el-checkbox value="write" :disabled="!addForm.permissions.includes('read')">写入</el-checkbox>
            <el-checkbox value="delete" :disabled="!addForm.permissions.includes('read')">删除</el-checkbox>
            <el-checkbox value="admin">管理</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="doAdd">创建</el-button>
      </template>
    </el-dialog>

    <!-- Edit user dialog -->
    <el-dialog v-model="showEdit" title="编辑用户" width="500">
      <el-form :model="editForm" label-width="80px">
        <el-form-item label="用户名">
          <el-input :model-value="editForm.username" disabled />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="editForm.password" type="password" show-password placeholder="留空则不修改" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="editForm.role" @change="onRoleChange(editForm)">
            <el-option label="普通用户" value="user" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="主目录">
          <div class="dir-input-row">
            <el-input v-model="editForm.homeDir" readonly />
            <el-button @click="openDirPicker(editForm)">浏览</el-button>
          </div>
        </el-form-item>
        <el-form-item label="权限">
          <el-checkbox-group v-model="editForm.permissions" @change="enforcePermDeps(editForm)">
            <el-checkbox value="read">读取</el-checkbox>
            <el-checkbox value="write" :disabled="!editForm.permissions.includes('read')">写入</el-checkbox>
            <el-checkbox value="delete" :disabled="!editForm.permissions.includes('read')">删除</el-checkbox>
            <el-checkbox value="admin">管理</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="doEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- Directory Picker dialog -->
    <el-dialog v-model="showDirPicker" title="选择主目录" width="500" append-to-body>
      <!-- Path breadcrumb -->
      <div class="picker-breadcrumb">
        <span
          v-for="(seg, idx) in pickerBreadcrumbs"
          :key="idx"
          class="picker-seg"
          @click="pickerNavigateTo(idx)"
        >
          <template v-if="idx > 0"> / </template>
          {{ seg }}
        </span>
      </div>

      <!-- Directory list -->
      <div class="picker-list" v-loading="pickerLoading">
        <div
          v-if="pickerPath !== '/'"
          class="picker-item picker-up"
          @click="pickerGoUp"
        >
          <el-icon><ArrowLeft /></el-icon>
          <span>.. 返回上级</span>
        </div>
        <div
          v-for="dir in pickerDirs"
          :key="dir.name"
          class="picker-item"
          :class="{ 'picker-selected': pickerPath + (pickerPath === '/' ? '' : '/') + dir.name === pickerTarget?.homeDir }"
          @dblclick="pickerEnter(dir.name)"
        >
          <el-icon color="#e6a23c"><Folder /></el-icon>
          <span>{{ dir.name }}</span>
          <el-button class="picker-enter-btn" text size="small" @click.stop="pickerEnter(dir.name)">
            <el-icon><ArrowRight /></el-icon>
          </el-button>
        </div>
        <div v-if="pickerDirs.length === 0 && !pickerLoading" class="picker-empty">
          该目录下无子目录
        </div>
      </div>

      <!-- Current selection indicator -->
      <div class="picker-current">
        已选目录：<strong>{{ pickerPath }}</strong>
      </div>

      <template #footer>
        <el-button @click="showDirPicker = false">取消</el-button>
        <el-button type="primary" @click="confirmDirPicker">选择此目录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Folder, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'
import { getUsers, createUser, updateUser, deleteUser } from '../api/users.js'
import { listFiles } from '../api/files.js'
import { formatDate } from '../utils/format.js'

const users = ref([])
const loading = ref(false)
const showAdd = ref(false)
const showEdit = ref(false)

const addForm = ref({ username: '', password: '', role: 'user', homeDir: '/', permissions: ['read', 'write'] })
const editForm = ref({ username: '', password: '', role: 'user', homeDir: '/', permissions: [] })

// ---- Directory Picker state ----
const showDirPicker = ref(false)
const pickerLoading = ref(false)
const pickerPath = ref('/')
const pickerDirs = ref([])
const pickerTarget = ref(null) // the form object to write homeDir back to

const pickerBreadcrumbs = ref(['/'])

async function loadPickerDir(dirPath) {
  pickerLoading.value = true
  pickerPath.value = dirPath
  // Build breadcrumbs
  const parts = dirPath.split('/').filter(Boolean)
  pickerBreadcrumbs.value = ['/', ...parts]
  try {
    // Admin calls API with absolute path; server maps via admin homeDir=/
    const res = await listFiles(dirPath)
    pickerDirs.value = res.data.filter(f => f.isDirectory)
  } catch {
    ElMessage.error('加载目录失败')
    pickerDirs.value = []
  } finally {
    pickerLoading.value = false
  }
}

function openDirPicker(formObj) {
  pickerTarget.value = formObj
  loadPickerDir(formObj.homeDir || '/')
  showDirPicker.value = true
}

function pickerEnter(name) {
  const next = pickerPath.value === '/' ? '/' + name : pickerPath.value + '/' + name
  loadPickerDir(next)
}

function pickerGoUp() {
  const parts = pickerPath.value.split('/').filter(Boolean)
  parts.pop()
  loadPickerDir(parts.length === 0 ? '/' : '/' + parts.join('/'))
}

function pickerNavigateTo(idx) {
  if (idx === 0) {
    loadPickerDir('/')
  } else {
    const parts = pickerPath.value.split('/').filter(Boolean)
    loadPickerDir('/' + parts.slice(0, idx).join('/'))
  }
}

function confirmDirPicker() {
  if (pickerTarget.value) {
    pickerTarget.value.homeDir = pickerPath.value
  }
  showDirPicker.value = false
}

// If read is unchecked, also remove write and delete
function enforcePermDeps(form) {
  if (!form.permissions.includes('read')) {
    form.permissions = form.permissions.filter(p => p !== 'write' && p !== 'delete')
  }
}

// When role switches to admin, auto-check all permissions
function onRoleChange(form) {
  if (form.role === 'admin') {
    form.permissions = ['read', 'write', 'delete', 'admin']
  }
}

// ---- Users CRUD ----

async function loadUsers() {
  loading.value = true
  try {
    const res = await getUsers()
    users.value = res.data
  } finally {
    loading.value = false
  }
}

onMounted(loadUsers)

async function doAdd() {
  if (!addForm.value.username || !addForm.value.password) {
    return ElMessage.warning('用户名和密码不能为空')
  }
  try {
    await createUser(addForm.value)
    ElMessage.success('用户已创建')
    showAdd.value = false
    addForm.value = { username: '', password: '', role: 'user', homeDir: '/', permissions: ['read', 'write'] }
    loadUsers()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '创建失败')
  }
}

function openEdit(row) {
  editForm.value = { username: row.username, password: '', role: row.role, homeDir: row.homeDir, permissions: [...row.permissions] }
  showEdit.value = true
}

async function doEdit() {
  try {
    const data = { role: editForm.value.role, homeDir: editForm.value.homeDir, permissions: editForm.value.permissions }
    if (editForm.value.password) data.password = editForm.value.password
    await updateUser(editForm.value.username, data)
    ElMessage.success('已更新')
    showEdit.value = false
    loadUsers()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '更新失败')
  }
}

async function toggleEnabled(row) {
  try {
    await updateUser(row.username, { enabled: !row.enabled })
    ElMessage.success(row.enabled ? '已禁用' : '已启用')
    loadUsers()
  } catch {
    ElMessage.error('操作失败')
  }
}

async function handleDelete(username) {
  try {
    await deleteUser(username)
    ElMessage.success('已删除')
    loadUsers()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '删除失败')
  }
}
</script>

<style scoped>
.user-manager {
  padding: 4px 0;
}
.perm-tags {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  overflow: visible;
}
.action-row {
  display: flex;
  align-items: center;
  white-space: nowrap;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.toolbar h3 {
  font-size: 18px;
  color: #0f172a;
}
.dir-input-row {
  display: flex;
  gap: 8px;
  width: 100%;
}
.dir-input-row .el-input {
  flex: 1;
}

/* Dir Picker */
.picker-breadcrumb {
  font-size: 13px;
  color: #475569;
  margin-bottom: 10px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.35);
}
.picker-seg {
  cursor: pointer;
  color: #409eff;
}
.picker-seg:hover {
  text-decoration: underline;
}
.picker-list {
  min-height: 200px;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.6);
}
.picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}
.picker-item:hover {
  background: rgba(59, 130, 246, 0.08);
}
.picker-selected {
  background: rgba(59, 130, 246, 0.14);
}
.picker-up {
  color: #909399;
  font-size: 13px;
}
.picker-enter-btn {
  margin-left: auto;
  opacity: 0;
}
.picker-item:hover .picker-enter-btn {
  opacity: 1;
}
.picker-empty {
  text-align: center;
  color: #94a3b8;
  padding: 40px 0;
  font-size: 13px;
}
.picker-current {
  margin-top: 10px;
  font-size: 13px;
  color: #475569;
}
</style>
