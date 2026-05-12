import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'
import api from '../api/index.js'

const routes = [
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('../views/Setup.vue')
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/',
    component: () => import('../views/Layout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', name: 'FileManager', component: () => import('../views/FileManager.vue') },
      { path: 'users', name: 'UserManager', component: () => import('../views/UserManager.vue'), meta: { requiresAdmin: true } },
      { path: 'status', name: 'ServerStatus', component: () => import('../views/ServerStatus.vue') },
      { path: 'connect', name: 'QuickConnect', component: () => import('../views/QuickConnect.vue'), meta: { requiresAdmin: true } }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 缓存 setup 状态，只在应用启动时请求一次，避免每次路由跳转都发请求
let setupChecked = false
let needSetup = false

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 已在 setup 页，不再检查
  if (to.name === 'Setup') return

  // 只在首次检查 setup 状态
  if (!setupChecked) {
    try {
      const res = await api.get('/setup/status')
      needSetup = res.data.needSetup
      setupChecked = true
    } catch {
      // 服务端未就绪时忽略，不跳转，下次导航重试
    }
    if (needSetup) return { name: 'Setup' }
  }

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'Login' }
  }
  if (to.meta.requiresAdmin && auth.user?.role !== 'admin') {
    return { path: '/' }
  }
})

export function resetSetupCheck() {
  setupChecked = false
  needSetup = false
}
export default router
