import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('sftp_token') || null)
  const user = ref(JSON.parse(localStorage.getItem('sftp_user') || 'null'))

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const canRead = computed(() => user.value?.permissions?.includes('read') ?? false)
  const canWrite = computed(() => user.value?.permissions?.includes('write') ?? false)
  const canDelete = computed(() => user.value?.permissions?.includes('delete') ?? false)

  function setAuth(tokenVal, userVal) {
    token.value = tokenVal
    user.value = userVal
    localStorage.setItem('sftp_token', tokenVal)
    localStorage.setItem('sftp_user', JSON.stringify(userVal))
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem('sftp_token')
    localStorage.removeItem('sftp_user')
  }

  return { token, user, isLoggedIn, isAdmin, canRead, canWrite, canDelete, setAuth, logout }
})
