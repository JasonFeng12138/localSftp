<template>
  <el-container class="layout">
    <el-aside width="200px" class="sidebar">
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
      <el-main>
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
  background: #304156;
  overflow: hidden;
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 18px;
  font-weight: 700;
  background: #263445;
  /* 为 macOS hiddenInset 红绿灯腾出垂直空间 */
  padding-top: 28px;
  height: 88px;
  -webkit-app-region: drag;
}
.sidebar .el-menu {
  border-right: none;
  background: #304156;
}
.sidebar .el-menu-item {
  color: #bfcbd9;
}
.sidebar .el-menu-item:hover,
.sidebar .el-menu-item.is-active {
  background: #263445;
  color: #409eff;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #ebeef5;
  background: #fff;
  -webkit-app-region: drag;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  /* 按钮区域禁止拖拽，保证点击事件正常 */
  -webkit-app-region: no-drag;
}
</style>
