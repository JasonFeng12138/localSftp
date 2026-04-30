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
      { path: 'status', name: 'ServerStatus', component: () => import('../views/ServerStatus.vue') }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // 已在 setup 页，不再检查
  if (to.name === 'Setup') return

  // 检查是否需要初始化（只在非 setup 页面检查一次）
  try {
    const res = await api.get('/setup/status')
    if (res.data.needSetup) {
      return { name: 'Setup' }
    }
  } catch {
    // 服务端未就绪时忽略，不跳转
  }

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'Login' }
  }
  if (to.meta.requiresAdmin && auth.user?.role !== 'admin') {
    return { path: '/' }
  }
})

export default router
