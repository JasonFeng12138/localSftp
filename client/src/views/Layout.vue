<template>
  <el-container class="layout">
    <el-aside width="232px" class="sidebar">
      <div class="brand">
        <span class="brand-icon"><el-icon><Connection /></el-icon></span>
        <div><strong>Local SFTP</strong><span>本地文件 · 安全连接</span></div>
      </div>
      <div class="nav-label">工作空间</div>
      <el-menu :default-active="route.path" router aria-label="主导航">
        <el-menu-item v-for="item in navigation" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon><span>{{ item.title }}</span>
        </el-menu-item>
      </el-menu>
      <div class="sidebar-footer">
        <el-icon><Lock /></el-icon>
        <div><strong>简单连接，安心传输</strong><span>你的局域网文件工作空间</span></div>
      </div>
    </el-aside>
    <el-container class="workspace">
      <el-header class="header" height="76px">
        <div class="header-location"><span class="header-app">工作空间</span><span class="header-separator">/</span><strong>{{ currentTitle }}</strong></div>
        <div class="header-right">
          <div class="user-identity">
            <span class="user-avatar">{{ userInitial }}</span>
            <div class="user-copy"><strong>{{ auth.user?.username }}</strong><span>{{ auth.isAdmin ? '管理员' : '普通用户' }}</span></div>
          </div>
          <el-tooltip content="退出登录" placement="bottom">
            <el-button text :icon="SwitchButton" aria-label="退出登录" @click="handleLogout" />
          </el-tooltip>
        </div>
      </el-header>
      <nav class="mobile-nav" aria-label="移动端主导航">
        <router-link v-for="item in navigation" :key="item.path" :to="item.path" :class="{ active: route.path === item.path }" :aria-current="route.path === item.path ? 'page' : undefined">
          <el-icon><component :is="item.icon" /></el-icon><span>{{ item.title }}</span>
        </router-link>
      </nav>
      <el-main class="main-content"><div class="content-inner"><router-view /></div></el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { logout as logoutApi } from '../api/auth.js'
import { FolderOpened, UserFilled, Monitor, SwitchButton, Connection, Lock } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const navigation = computed(() => [
  { path: '/', title: '文件管理', icon: FolderOpened },
  ...(auth.isAdmin ? [{ path: '/users', title: '用户管理', icon: UserFilled }] : []),
  { path: '/status', title: '系统状态', icon: Monitor },
  ...(auth.isAdmin ? [{ path: '/connect', title: '快速连接', icon: Connection }] : [])
])
const currentTitle = computed(() => navigation.value.find(item => item.path === route.path)?.title || '工作空间')
const userInitial = computed(() => auth.user?.username?.slice(0, 1).toUpperCase() || 'U')

async function handleLogout() {
  // 通知服务端作废当前 Token；失败（如已过期）也继续本地退出
  await logoutApi().catch(() => {})
  auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.layout { height: 100vh; height: 100dvh; overflow: hidden; }
.sidebar { display: flex; flex-direction: column; border-right: 1px solid var(--app-border); background: #fff; padding: 0 16px 22px; }
.brand { display: flex; align-items: center; gap: 11px; flex-shrink: 0; padding: 42px 8px 30px; -webkit-app-region: drag; }
.brand-icon { background: var(--app-primary); color: #fff; width: 38px; height: 38px; border-radius: 11px; }
.brand strong { display: block; font-size: 18px; letter-spacing: -.6px; }
.brand span:not(.brand-icon) { display: block; margin-top: 5px; font-size: 10px; letter-spacing: .5px; color: var(--app-muted); }
.nav-label { padding: 0 16px 12px; font-size: 11px; font-weight: 600; color: #8d99aa; letter-spacing: 2px; }
.sidebar .el-menu { border: 0; background: transparent; flex: 1; min-height: 0; overflow-y: auto; }
.sidebar .el-menu-item { height: 46px; line-height: 46px; margin-bottom: 6px; border-radius: 9px; color: var(--app-muted); font-size: 13px; }
.sidebar .el-menu-item .el-icon { font-size: 19px; margin-right: 12px; }
.sidebar .el-menu-item:hover { background: #f6f8fc; }
.sidebar .el-menu-item.is-active { background: var(--el-color-primary-light-9); color: var(--app-primary); font-weight: 600; }
.sidebar-footer { display: flex; align-items: center; gap: 10px; flex-shrink: 0; padding: 18px 9px 0; border-top: 1px solid var(--app-border); color: var(--app-muted); }
.sidebar-footer .el-icon { color: var(--app-primary); font-size: 18px; }
.sidebar-footer strong { display: block; font-size: 11px; font-weight: 500; }
.sidebar-footer span { display: block; margin-top: 6px; font-size: 10px; }
.workspace { flex-direction: column; min-width: 0; }
.header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-shrink: 0; padding: 0 clamp(24px, 3vw, 48px); background: #fff; border-bottom: 1px solid var(--app-border); -webkit-app-region: drag; }
.header-location { display: flex; align-items: center; gap: 14px; font-size: 12px; }
.header-app, .header-separator { color: #8d99aa; }
.header-location strong { font-weight: 500; }
.header-right { display: flex; align-items: center; gap: 18px; -webkit-app-region: no-drag; }
.user-identity { display: flex; align-items: center; gap: 10px; min-width: 0; }
.user-avatar { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex-shrink: 0; border-radius: 50%; background: #edf0f8; color: var(--app-primary); font-size: 13px; font-weight: 650; }
.user-copy { min-width: 0; }
.user-copy strong { display: block; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
.user-copy span { display: block; margin-top: 4px; font-size: 10px; color: var(--app-muted); }
.main-content { padding: 32px clamp(24px, 3vw, 48px) 40px; min-width: 0; overflow-x: hidden; overflow-y: auto; }
.content-inner { max-width: 1600px; margin: 0 auto; min-width: 0; }
.mobile-nav { display: none; }
@media (max-width: 1100px) and (min-width: 768px) {
  .sidebar { width: 200px; padding-inline: 12px; }
  .brand { gap: 9px; padding-inline: 5px; }
  .brand strong { font-size: 16px; }
  .brand span:not(.brand-icon) { font-size: 9px; }
}
@media (max-width: 767px) {
  .sidebar { display: none; }
  .header { height: 76px; padding: 24px 18px 0; }
  .header-location { gap: 8px; }
  .header-right { gap: 8px; }
  .user-copy { display: none; }
  .mobile-nav { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 4px; flex-shrink: 0; padding: 10px 12px; background: #fff; border-bottom: 1px solid var(--app-border); }
  .mobile-nav a { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; border-radius: 8px; text-decoration: none; color: var(--app-muted); font-size: 12px; }
  .mobile-nav a.active { color: var(--app-primary); background: var(--el-color-primary-light-9); font-weight: 600; }
  .mobile-nav .el-icon { font-size: 16px; }
  .main-content { padding: 24px 16px; }
}
@media (max-height: 540px) and (min-width: 768px) { .brand { padding-block: 30px 16px; } .sidebar-footer { display: none; } }
</style>
