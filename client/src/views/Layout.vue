<template>
  <el-container class="layout">
    <el-aside width="210px" class="sidebar">
      <div class="logo">SFTP 管理</div>
      <el-menu :default-active="route.path" router>
        <el-menu-item index="/">
          <el-icon><FolderOpened /></el-icon>
          <span>文件管理</span>
        </el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/users">
          <el-icon><UserFilled /></el-icon>
          <span>用户管理</span>
        </el-menu-item>
        <el-menu-item index="/status">
          <el-icon><Monitor /></el-icon>
          <span>系统状态</span>
        </el-menu-item>
        <el-menu-item index="/connect" v-if="auth.isAdmin">
          <el-icon><Connection /></el-icon>
          <span>快速连接</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <span></span>
        <div class="header-right">
          <el-tag type="info">{{ auth.user?.username }}</el-tag>
          <el-button text @click="handleLogout">
            <el-icon><SwitchButton /></el-icon>
            退出
          </el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import { FolderOpened, UserFilled, Monitor, SwitchButton, Connection } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<style scoped>
.layout {
  height: 100vh;
}
.sidebar {
  background: rgba(18, 26, 48, 0.88);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.logo {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e2e8f0;
  font-size: 19px;
  font-weight: 700;
  background: rgba(10, 16, 32, 0.45);
  /* 为 macOS hiddenInset 红绿灯腾出垂直空间 */
  padding-top: 28px;
  height: 92px;
  -webkit-app-region: drag;
  letter-spacing: 0.5px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.sidebar .el-menu {
  border-right: none;
  background: transparent;
  padding: 8px 0;
}
.sidebar .el-menu-item {
  color: rgba(203, 213, 225, 0.85);
  margin: 3px 10px;
  border-radius: 9px;
}
.sidebar .el-menu-item:hover,
.sidebar .el-menu-item.is-active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 20px;
  height: 52px;
  background: transparent;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  -webkit-app-region: drag;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  -webkit-app-region: no-drag;
}
.main {
  padding: 20px 24px;
  overflow-y: auto;
}
</style>
