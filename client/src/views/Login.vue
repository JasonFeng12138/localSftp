<template>
  <main class="login-page auth-page">
    <section class="login-card auth-card" aria-labelledby="login-title">
      <div class="login-brand"><span class="brand-icon"><el-icon><Connection /></el-icon></span><span>Local SFTP</span></div>
      <div class="auth-eyebrow">你的本地文件工作空间</div>
      <h1 id="login-title">欢迎回来</h1>
      <p class="auth-caption">登录账号，安全访问与管理你的文件。</p>
      <el-form :model="form" :rules="rules" ref="formRef" label-position="top" @submit.prevent="handleLogin">
        <el-form-item prop="username" label="用户名">
          <el-input v-model="form.username" placeholder="请输入用户名" autocomplete="username" :prefix-icon="User" size="large" />
        </el-form-item>
        <el-form-item prop="password" label="密码">
          <el-input v-model="form.password" placeholder="请输入密码" type="password" autocomplete="current-password" show-password :prefix-icon="Lock" size="large" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit" :loading="loading" size="large" style="width: 100%">
            登录工作空间 <el-icon><Right /></el-icon>
          </el-button>
        </el-form-item>
      </el-form>
      <div class="login-footer"><el-icon><Lock /></el-icon><span>本地部署，让文件留在你的掌控之中</span></div>
    </section>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { User, Lock, Connection, Right } from '@element-plus/icons-vue'
import { login } from '../api/auth.js'
import { useAuthStore } from '../stores/auth.js'

const router = useRouter()
const auth = useAuthStore()
const formRef = ref(null)
const loading = ref(false)

const form = ref({ username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleLogin() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const res = await login(form.value.username, form.value.password)
    auth.setAuth(res.data.token, res.data.user)
    ElMessage.success('登录成功')
    router.push('/')
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-card {
  width: 440px;
  max-width: 100%;
  padding: 40px;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 36px;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -.5px;
}
.login-brand .brand-icon { width: 38px; height: 38px; color: #fff; background: var(--app-primary); }
h1 { margin: 14px 0 12px; font-size: 29px; font-weight: 650; letter-spacing: -.8px; }
.login-card .el-form { margin-top: 28px; }
.login-card .el-form-item:last-child { margin-bottom: 0; margin-top: 28px; }
.login-footer { display: flex; align-items: center; justify-content: center; gap: 7px; margin-top: 28px; padding-top: 24px; border-top: 1px solid var(--app-border); color: var(--app-muted); font-size: 11px; line-height: 1.6; }
@media (max-width: 480px) { .login-card { padding: 30px 24px; } .login-brand { margin-bottom: 28px; } }
</style>
