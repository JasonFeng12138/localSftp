import api from './index.js'

export function getStatus() {
  return api.get('/status')
}

export function updateSettings(data) {
  return api.put('/settings', data)
}

export function getSettingsDirs(path) {
  return api.get('/settings/dirs', { params: { path } })
}

export function getSetupStatus() {
  return api.get('/setup/status')
}

export function completeSetup(data) {
  return api.post('/setup/complete', data)
}

export function getSetupDirs(path) {
  return api.get('/setup/dirs', { params: { path } })
}
