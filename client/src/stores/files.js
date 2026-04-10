import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { listFiles } from '../api/files.js'

export const useFilesStore = defineStore('files', () => {
  const currentPath = ref('/')
  const files = ref([])
  const loading = ref(false)

  const breadcrumbs = computed(() => {
    const parts = currentPath.value.split('/').filter(Boolean)
    return ['/', ...parts]
  })

  async function loadDir(dirPath) {
    loading.value = true
    try {
      currentPath.value = dirPath
      const res = await listFiles(dirPath)
      files.value = res.data
    } finally {
      loading.value = false
    }
  }

  function navigateTo(index) {
    if (index === 0) {
      loadDir('/')
    } else {
      const parts = currentPath.value.split('/').filter(Boolean)
      const target = '/' + parts.slice(0, index).join('/')
      loadDir(target)
    }
  }

  return { currentPath, files, loading, breadcrumbs, loadDir, navigateTo }
})
