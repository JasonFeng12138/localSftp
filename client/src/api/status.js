import api from './index.js'

export function getStatus() {
  return api.get('/status')
}
