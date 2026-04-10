import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const routes = [
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

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'Login' }
  }
  if (to.meta.requiresAdmin && auth.user?.role !== 'admin') {
    return { path: '/' }
  }
})

export default router
